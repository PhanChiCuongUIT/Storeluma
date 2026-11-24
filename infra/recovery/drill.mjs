import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { seal, unseal } from "./transfer.mjs";
import { join,dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { root, stagingContext } from '../staging/context.mjs';

const receiverStarted = performance.now();
const mode=process.argv[2]??'local';
if(!['local','send','receive'].includes(mode))throw new Error('Expected local, send or receive');
const bundle=mode==='receive'?JSON.parse(unseal(readFileSync(process.argv[3]),readFileSync(process.argv[4]))):null;
if(bundle){assert.match(bundle.id,/^[a-f0-9]{12}$/);assert.match(bundle.event,/^[a-f0-9-]{36}$/);}
const id = randomBytes(6).toString('hex');
const { project, state, revision, env, args } = stagingContext(id);
const image = 'storeluma-recovery-postgres:pg17';
const stanza = '--stanza=storeluma';
const source = args;
const restored = [...args, '-f', 'infra/recovery/restore.yaml'];
const producers = ['business', 'catalog', 'inventory', 'finance', 'sales', 'reporting', 'notification'];
const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, env, stdio: 'inherit' });
const docker = (...argv) => run('docker', argv);
const output = (...argv) => execFileSync('docker', argv, { cwd: root, env, encoding: 'utf8' }).trim();
const sql = (stack, db, query) => output(...stack, 'exec', '-T', '-u', 'postgres', 'postgres',
  'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', query);
const backrest = (stack, ...cmd) => [...stack, 'exec', '-T', '-u', 'postgres', 'postgres', 'pgbackrest', stanza, ...cmd];
const smoke = () => run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'infra/staging/playwright.config.ts']);
const readSale = () => {
  const sale = JSON.parse(readFileSync(join(state, 'sale.json')));
  for (const key of ['order','tenant','sku','payment']) assert.match(sale[key], /^[a-f0-9-]{36}$/);
  return sale;
};
async function waitFor(read, expected, name) {
  const deadline = Date.now() + 90000;
  do {
    if (read() === expected) return;
    await sleep(400);
  } while (Date.now() < deadline);
  throw new Error('Timed out: ' + name);
}
function reconcile(stack, sale) {
  const { order, tenant, payment, sku } = sale;
  assert.equal(sql(stack,'sales_db',`SELECT status||'|'||payable_vnd FROM orders WHERE id='${order}'`), 'COMPLETED|100000');
  assert.equal(sql(stack,'sales_db',`SELECT stage FROM checkout_sagas WHERE order_id='${order}'`), 'DONE');
  assert.equal(sql(stack,'finance_db',`SELECT count(*)||'|'||sum(amount_vnd) FROM cash_ledger WHERE payment_id='${payment}'`), '1|100000');
  assert.equal(sql(stack,'inventory_db',`SELECT count(*)||'|'||sum(qty_base)||'|'||sum(value_vnd) FROM stock_movements WHERE document_id='${order}'`), '1|-1.000|-40000');
  assert.equal(sql(stack,'inventory_db',`SELECT on_hand||'|'||reserved||'|'||inventory_value FROM stock_balances WHERE tenant_id='${tenant}' AND sku_id='${sku}'`), '1.000|0.000|40000');
  assert.equal(sql(stack,'reporting_db',`SELECT data->>'status' FROM read_records WHERE producer='sales' AND kind='ORDER' AND id='${order}'`), 'COMPLETED');
}
const now = stack => sql(stack, 'postgres', 'SELECT clock_timestamp()');
const marker = 'sale_' + (bundle?.id??id);
let active = source;
let result;
console.log('Recovery drill:', project);
const volumeNames=['archive_keys','repository_keys','repository_data','caddy_data'];
const files=['.env','root.crt','infra/generated/init.sql','infra/generated/storeluma-realm.json','infra/generated/accounts.json','sale.json'];
const volumeArchive=(name,data)=>execFileSync('docker',['run','--rm',...(data?['-i']:[]),'-v',project+'_'+name+':/vault'+(data?'':':ro'),
  '--entrypoint','sh',image,'-ec',data?'test -z "$(ls -A /vault)"; tar -xzpf - -C /vault':'tar -czpf - -C /vault .'],
  {cwd:root,env,maxBuffer:256*1024*1024,input:data});
function exportBundle(meta){
  const fileData=Object.fromEntries(files.map(f=>[f,readFileSync(join(state,f)).toString('base64')]));
  const volumes=Object.fromEntries(volumeNames.map(n=>[n,volumeArchive(n).toString('base64')]));
  writeFileSync(join(root,'tmp/recovery/offhost.bin'),seal(Buffer.from(JSON.stringify({...meta,files:fileData,volumes})),process.env.OFFHOST_RECIPIENT));
}
try {
  docker('build', '--target','database','-t', image, 'infra/recovery');
  docker('build', '--target','drill-repository','-t','storeluma-drill-repository:pg17','infra/recovery');
  let original,event,lastRecord,incidentAt,startedAt,backupLabel,cipher;
  const inbox = stack => sql(stack,'reporting_db',`SELECT count(*) FROM inbox WHERE id='${event}'`);
  if(!bundle){
  for (const name of ['archive_keys', 'repository_keys']) docker('volume', 'create', project + '_' + name);
  docker('run', '--rm', '-v', project + '_archive_keys:/client', '-v', project + '_repository_keys:/server',
    '--entrypoint', 'sh', 'storeluma-drill-repository:pg17', '/usr/local/bin/init-drill.sh');
  run(process.execPath, ['infra/staging/stage.mjs', 'up']);
  docker(...backrest(source, 'stanza-create'));
  docker(...backrest(source, 'check'));
  docker(...backrest(source, '--type=full', 'backup'));
  const [repo] = JSON.parse(output(...backrest(source, '--output=json', 'info')));
  assert.equal(repo.cipher, 'aes-256-cbc');
  const backup = repo.backup.at(-1);
  assert.equal(backup.type, 'full');
  // This sale is written after the base backup. Its recovery requires archived WAL.
  smoke();
  original = readSale();
  reconcile(source, original);
  event = sql(source,'sales_db',`SELECT id FROM outbox WHERE type='sales.projection-updated.v1' AND payload->>'aggregateId'='${original.order}' ORDER BY created_at DESC LIMIT 1`);
  assert.match(event,/^[a-f0-9-]{36}$/);
  await waitFor(() => inbox(source),'1','source reporting inbox');
  sql(source,'postgres','CREATE TABLE recovery_probe(label text PRIMARY KEY, recorded_at timestamptz DEFAULT clock_timestamp())');
  lastRecord = sql(source,'postgres',"INSERT INTO recovery_probe(label) VALUES ('keep') RETURNING recorded_at");
  sql(source,'postgres',`SELECT pg_create_restore_point('${marker}')`);
  sql(source,'postgres',"INSERT INTO recovery_probe(label) VALUES ('exclude')");
  const wal = sql(source,'postgres','SELECT pg_walfile_name(pg_current_wal_lsn())');
  sql(source,'postgres','SELECT pg_switch_wal()');
  await waitFor(() => sql(source,'postgres',`SELECT coalesce(last_archived_wal >= '${wal}',false) FROM pg_stat_archiver`),'t','target WAL archived');
  incidentAt = now(source);
  startedAt=Date.now();backupLabel=backup.label;cipher=repo.cipher;
  docker(...source, 'stop', 'edge','gateway', ...producers, 'keycloak','rabbitmq','postgres');
  if(mode==='send'){
    docker(...source,'stop','repository');
    exportBundle({id,revision,event,lastRecord,incidentAt,startedAt,backupLabel,cipher});
    console.log('Encrypted off-host rehearsal prepared. Source stopped.');
  }
  }else{
    assert.equal(bundle.revision,revision,'Use a clean checkout of the exact source commit');
    ({event,lastRecord,incidentAt,startedAt,backupLabel,cipher}=bundle);
    for(const name of files){const file=join(state,name);mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,Buffer.from(bundle.files[name],'base64'),{mode:['root.crt','infra/generated/init.sql','infra/generated/storeluma-realm.json'].includes(name)?0o644:0o600,flag:'wx'});}
    for(const name of volumeNames){
      docker('volume','create','--label','com.docker.compose.project='+project,'--label','com.docker.compose.volume='+name,project+'_'+name);
      volumeArchive(name,Buffer.from(bundle.volumes[name],'base64'));
    }
    original=readSale();
    docker(...restored,'build');
    docker(...restored,'up','-d','--wait','repository');
  }
  if(mode!=='send'){
  active = restored;
  // Entrypoint ownership setup runs as root, while pgBackRest restores as postgres.
  docker(...restored,'run','--rm','--no-deps','--entrypoint','sh','postgres','-ec',
    'test -z "$(ls -A "$PGDATA")"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"; exec gosu postgres pgbackrest "$@"',
    'restore', stanza, '--set=' + backupLabel, '--type=name', '--target=' + marker, '--target-action=promote','restore');
  docker(...restored,'up','-d','--wait','postgres','rabbitmq');
  await waitFor(() => sql(restored,'postgres','SELECT pg_is_in_recovery()'),'f','PITR promotion');
  assert.equal(sql(restored,'postgres','SELECT string_agg(label,\',\' ORDER BY label) FROM recovery_probe'),'keep');
  assert.equal(sql(restored,'postgres',"SELECT recorded_at FROM recovery_probe WHERE label='keep'"),lastRecord);
  reconcile(restored, original);
  assert.equal(inbox(restored),'1');
  // Requeue retained events only on this isolated restored cluster, with consumers stopped.
  let replayed = 0;
  for (const service of producers) replayed += Number(sql(restored, service + '_db',
    'WITH replay AS (UPDATE outbox SET delivered_at=NULL,lease_until=NULL RETURNING id) SELECT count(*) FROM replay'));
  docker(...restored,'up','-d','--wait','--wait-timeout','300');
  for (const service of producers) await waitFor(() => sql(restored, service + '_db',
    'SELECT count(*) FROM outbox WHERE delivered_at IS NULL'),'0',service + ' outbox');
  smoke();
  const second = readSale();
  assert.notEqual(second.order,original.order);
  reconcile(restored, original);
  reconcile(restored, second);
  assert.equal(inbox(restored),'1');
  const rtoSeconds = (Date.now() - startedAt) / 1000;
  const rpoSeconds = (Date.parse(incidentAt) - Date.parse(lastRecord)) / 1000;
  // A single-use receiver key exists before the source dispatch. This same-host
  // interval includes dispatch, backup and transit, bounding the actual outage.
  const clockFile = bundle && join(dirname(process.argv[4]), 'receiver-start.json');
  const upperBound = clockFile && existsSync(clockFile)
    ? (Date.now() - JSON.parse(readFileSync(clockFile,'utf8')).startedAt) / 1000 : undefined;
  const elapsed = upperBound ?? rtoSeconds;
  const withinObjectives = rpoSeconds >= 0 && rpoSeconds <= 900 && elapsed >= 0 && elapsed <= 14400;
  const images = {};
  for (const service of ['edge','postgres','rabbitmq','keycloak','gateway', ...producers]) {
    const container = output(...restored, 'ps', '-q', service);
    images[service] = output('inspect', '--format', '{{.Image}}', container);
  }
  result = { revision, images, platform: output('image','inspect',image,'--format','{{.Os}}/{{.Architecture}}'),
    backup: backupLabel, cipher, incidentAt, lastRecord, rpoSeconds,
    withinObjectives, ...(bundle ? {receiverRestoreSeconds: Math.round((performance.now() - receiverStarted) / 100) / 10} : {}),
    ...(upperBound === undefined ? {rtoSeconds: Math.round(rtoSeconds * 10) / 10} : {rtoUpperBoundSeconds: Math.round(upperBound * 10) / 10}), replayed, verifiedSales: 2, incomePerSale: 100000, stockCostPerSale: 40000,
    repositoryPlacement: bundle?'encrypted copy delivered to an independent recovery host':'isolated SFTP container on the rehearsal host', restoredProbe: ['keep'] };
  writeFileSync(join(state,'result.json'), JSON.stringify(result,null,2));
  }
} finally {
  if (existsSync(join(state,'.env'))) docker(...active,'down');
}
if (result) {
  mkdirSync(join(root,'tmp/recovery'),{ recursive:true });
  writeFileSync(join(root,'tmp/recovery/latest.json'),JSON.stringify({ id, ...result },null,2));
  console.log(JSON.stringify(result));
  assert.ok(result.withinObjectives, 'Recovery completed outside the 15 minute RPO or 4 hour RTO. Check transfer delay and UTC clock synchronization.');
}
