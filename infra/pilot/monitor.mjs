import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {applicationServices} from './runtime-db.mjs';

const eventServices=applicationServices.filter(s=>s!=='gateway');
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:12000,stdio:['ignore','pipe','pipe']}).trim();
export function inspectPilot(project='storeluma-pilot',edge=true) {
  const problems=[];
  const lookup=name=>docker('ps','-aq','--filter','label=com.docker.compose.project='+project,
    '--filter','label=com.docker.compose.service='+name,'--filter','label=com.docker.compose.oneoff=False');
  const pg=lookup('postgres');
  for(const name of [...applicationServices,'postgres','rabbitmq','keycloak',...(edge?['edge']:[])]) {
    const id=lookup(name);
    if(!id) { problems.push(name+'/missing'); continue; }
    const state=JSON.parse(docker('inspect','--format','{{json .State}}',id));
    if(!state.Running || (state.Health && state.Health.Status!=='healthy'))problems.push(name+'/unavailable');
  }
  const sql=(database,query)=>docker('exec','-u','postgres',pg,'psql','-XAtq','-v','ON_ERROR_STOP=1','-d',database,'-c',query);
  for(const name of eventServices) {
    try {
      // Only status and age leave the service. No document or payload is inspected.
      const [old,pending]=sql(name+'_db',`SELECT EXISTS(SELECT 1 FROM outbox WHERE delivered_at IS NULL AND created_at < now()-interval '60 seconds'),EXISTS(SELECT 1 FROM dead_letters WHERE status='PARKED')`).split('|');
      if(old==='t')problems.push(name+'/outbox-delay');
      if(pending==='t')problems.push(name+'/dead-letter');
    } catch { problems.push(name+'/probe-failed'); }
  }
  try {
    if(sql('postgres',"SELECT last_failed_time > coalesce(last_archived_time,'-infinity') FROM pg_stat_archiver")==='t')problems.push('postgres/wal-archive');
  } catch { problems.push('postgres/archive-probe-failed'); }
  return problems.sort();
}

export async function deliver(problems,journal,send) {
  const old=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):[];
  if(JSON.stringify(problems)===JSON.stringify(old))return false;
  await send({application:'Storeluma',status:problems.length?'alert':'recovered',problems,at:new Date().toISOString()});
  writeFileSync(journal+'.new',JSON.stringify(problems),{mode:0o600});
  renameSync(journal+'.new',journal);
  return true;
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const directory=resolve(process.argv[2]??'/etc/storeluma');
  let problems;
  try { problems=inspectPilot(); } catch { problems=['docker/probe-failed']; }
  const destination=join(directory,'alert-webhook');
  if(existsSync(destination)){
    const url=new URL(readFileSync(destination,'utf8').trim());
    if(url.protocol!=='https:')throw new Error('The alert recipient must use HTTPS');
    await deliver(problems,join(directory,'alert-state.json'),async message=>{
      let response;
      try { response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'content-type':'application/json'},body:JSON.stringify(message)}); }
      catch { throw new Error('Alert delivery failed. Check the private recipient configuration.'); }
      if(!response.ok)throw new Error('Alert recipient returned HTTP '+response.status);
    });
  }
  console.log(JSON.stringify({status:problems.length?'alert':'ok',problems}));
  if(problems.length)process.exitCode=1;
}
