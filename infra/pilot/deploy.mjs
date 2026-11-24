import {verifyManifest} from './verify-manifest.mjs';
import {rollService} from './rollout.mjs';
import {brokerUrl,configureBroker} from "./broker.mjs";
import {allowRuntime,applicationServices,psqlInContainer,runtimeConnection} from './runtime-db.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {randomBytes} from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const [action, releaseFile, configPath, targetService] = process.argv.slice(2);
if (!['validate','deploy','backup-full','backup-diff','check-archive','roll-service','rollback-service','rotate-service'].includes(action) || !releaseFile || !configPath)
  throw new Error('Usage: node infra/pilot/deploy.mjs ACTION RELEASE.json PRIVATE_CONFIG_DIR [APPLICATION_SERVICE]');
const dir = resolve(configPath), dotenv = join(dir,'.env');
const release = JSON.parse(readFileSync(releaseFile,'utf8'));
assert.match(release.commit, /^[a-f0-9]{40}$/);
assert.equal(release.platform,'linux/arm64');
const localCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(release.commit,localCommit,'Check out the release commit before deploying its configuration');
if (['deploy','roll-service','rollback-service','rotate-service'].includes(action))verifyManifest(releaseFile);
const settings = parseEnv(readFileSync(dotenv,'utf8'));
for (const key of Object.keys(parseEnv(readFileSync('.env.example','utf8')))) {
  if (!settings[key] || settings[key] === 'GENERATED_BY_NPM_RUN_SETUP') throw new Error('Missing pilot setting: ' + key);
}
assert.ok(/^[a-f0-9]{64}$/i.test(settings.SESSION_KEY),'Invalid session encryption key');
for (const host of [settings.APP_HOST,settings.IDENTITY_HOST]) {
  assert.match(host ?? '',/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
  assert.ok(!host.endsWith('.localhost'));
}
assert.notEqual(settings.APP_HOST,settings.IDENTITY_HOST);
const realm = JSON.parse(readFileSync(join(dir,'realm.json'),'utf8'));
const app = 'https://' + settings.APP_HOST;
const client = realm.clients?.find(c => c.clientId === 'storeluma-web');
assert.equal(realm.realm,'storeluma');
assert.equal(realm.sslRequired?.toLowerCase(),'all');
assert.deepEqual(client?.redirectUris,[app + '/auth/callback']);
assert.deepEqual(client?.webOrigins,[app]);
assert.equal(client?.attributes?.['post.logout.redirect.uris'],app + '/');
assert.equal(client?.attributes?.['pkce.code.challenge.method'],'S256');
assert.ok(settings.OIDC_SECRET && client.secret === settings.OIDC_SECRET,'Client configuration mismatch');
assert.ok(existsSync(join(dir,'init.sql')) && existsSync(join(dir,'pgbackrest/pgbackrest.conf')));
const seedFile=join(dir,'service-seeds.json');
const seeds=existsSync(seedFile)?JSON.parse(readFileSync(seedFile,'utf8')):{};
const persistSeeds=()=>{writeFileSync(seedFile+'.new',JSON.stringify(seeds),{mode:0o600});renameSync(seedFile+'.new',seedFile);};
const brokerSeeds=()=>Object.fromEntries(Object.entries(seeds).map(([name,value])=>[name,value.seed]));
const env = { ...process.env, ...settings, PILOT_CONFIG_DIR:dir };
for(const service of applicationServices){const key=service.toUpperCase();env[key+'_RUNTIME_URL']=runtimeConnection(service,seeds[service]?.seed??settings[key+'_DB_PASSWORD']).url;}
for(const service of applicationServices.filter(s=>s!=='gateway'))env[service.toUpperCase()+'_BROKER_URL']=brokerUrl(service,seeds[service]?.seed??settings.RABBIT_PASSWORD);
const services = ['edge','postgres','keycloak','rabbitmq','business','catalog','inventory','finance','sales','gateway','reporting','notification'];
for (const service of services) {
  const ref = release.images?.[service];
  assert.match(ref ?? '', /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
  env[service.toUpperCase() + '_IMAGE'] = ref;
}
const compose = ['compose','-p','storeluma-pilot','--env-file',dotenv,'-f','compose.yaml','-f','infra/pilot/compose.yaml'];
const run = (...args) => execFileSync('docker',[...compose,...args],{env,stdio:'inherit'});
const config = JSON.parse(execFileSync('docker',[...compose,'config','--format','json'],{env,encoding:'utf8'}));
for (const service of services) {
  const s = config.services[service];
  assert.equal(s.image,release.images[service]);
  assert.equal(s.restart,'unless-stopped','Missing restart policy for '+service);
  assert.ok(!s.build);
  if (service !== 'edge') assert.ok(!s.ports?.length);
}
assert.deepEqual(config.services.edge.ports.map(p => String(p.published)).sort(), ['443','80']);
const backup = (...cmd) => run('exec','-T','-u','postgres','postgres','pgbackrest','--stanza=storeluma',...cmd);
if (action === 'check-archive') backup('check');
if (action === 'backup-full' || action === 'backup-diff') {
  backup('check');
  backup('--type=' + action.slice(7),'backup');
}
if(action==='rotate-service'){
  assert.ok(applicationServices.includes(targetService),'Select an application service');
  const read=(...args)=>execFileSync('docker',args,{env,encoding:'utf8'}).trim();
  const container=read(...compose,'ps','--all','-q',targetService);
  assert.equal(read('inspect','--format','{{.Config.Image}}',container),release.images[targetService],'Use the running service release');
  // Persist the pending seed first. Retrying after interruption finishes the same rotation.
  if(!seeds[targetService]?.pending){
    seeds[targetService]={seed:randomBytes(32).toString('hex'),pending:true};
    persistSeeds();
  }
  const seed=seeds[targetService].seed,key=targetService.toUpperCase();
  env[key+'_RUNTIME_URL']=runtimeConnection(targetService,seed).url;
  run('stop',targetService);
  const sql=psqlInContainer(compose,env);
  allowRuntime(targetService,seed,sql);
  sql(targetService+'_db',"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='"+targetService+"_runtime' AND pid<>pg_backend_pid()");
  if(targetService!=='gateway'){
    env[key+'_BROKER_URL']=brokerUrl(targetService,seed);
    configureBroker(compose,env,settings.RABBIT_PASSWORD,brokerSeeds());
    run('exec','-T','-u','rabbitmq','rabbitmq','rabbitmqctl','close_all_user_connections','sl_'+targetService,'service credential rotation');
  }
  run('up','-d','--no-deps','--no-build','--wait','--wait-timeout','180',targetService);
  seeds[targetService].pending=false;
  persistSeeds();
}
if (['roll-service','rollback-service'].includes(action)) {
  assert.ok(applicationServices.includes(targetService),'Select an application service');
  const imageVariable = targetService.toUpperCase() + '_IMAGE';
  const read = (...args) => execFileSync('docker',args,{env,encoding:'utf8'}).trim();
  const current = () => read('inspect','--format','{{.Config.Image}}',read(...compose,'ps','--all','-q',targetService));
  const check = ref => {
    env[imageVariable] = ref;
    run('pull',targetService);
    // Verification mode only reads the migration ledger, before stopping the old container.
    run('run','--rm','--no-deps','-T','--entrypoint','node',targetService,'--input-type=module','-e',
      "import {migrate,db} from './dist/packages/platform/db.js'; try{await migrate('"+targetService+"')}finally{await db.end()}");
  };
  const replace = ref => {
    env[imageVariable] = ref;
    run('up','-d','--no-deps','--no-build','--wait','--wait-timeout','180',targetService);
  };
  rollService({action,candidate:release.images[targetService],journal:join(dir,'rollout-'+targetService+'.json'),current,check,replace});
}
if (action === 'deploy') {
  run('pull');
  run('up','-d','--no-build','--wait','postgres','rabbitmq');
  configureBroker(compose,env,settings.RABBIT_PASSWORD,brokerSeeds());
  backup('stanza-create');
  backup('check');
  backup('--type=full','backup');
  for(const service of applicationServices){
    const password=settings[service.toUpperCase()+'_DB_PASSWORD'];
    const migrator={...env,DATABASE_URL:'postgres://'+service+':'+encodeURIComponent(password)+'@postgres:5432/'+service+'_db'};
    execFileSync('docker',[...compose,'run','--rm','--no-deps','-T','-e','DATABASE_URL','-e','STORELUMA_SCHEMA_MODE=migrate',
      '--entrypoint','node',service,'--input-type=module','-e',"import {migrate,db} from './dist/packages/platform/db.js'; try{await migrate('"+service+"')}finally{await db.end()}"],{env:migrator,stdio:'inherit'});
    allowRuntime(service,seeds[service]?.seed??password,psqlInContainer(compose,env));
  }
  run('up','-d','--no-build','--wait','--wait-timeout','300');
  const issuer = 'https://' + settings.IDENTITY_HOST + '/realms/storeluma';
  for (const [url,field,expected] of [[issuer+'/.well-known/openid-configuration','issuer',issuer],[app+'/health','status','ok']]) {
    let verified = false;
    for (let n=0;n<30;n++) {
      try {
        const r = await fetch(url,{signal:AbortSignal.timeout(8000)});
        verified = r.ok && (await r.json())[field] === expected;
      } catch {}
      if (verified) break;
      await new Promise(done => setTimeout(done,2000));
    }
    assert.ok(verified,'Public HTTPS readiness failed: '+url);
  }
}
console.log('Pilot ' + action + ' succeeded for ' + release.commit);
