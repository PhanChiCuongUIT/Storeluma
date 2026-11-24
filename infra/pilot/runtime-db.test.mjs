import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {allowRuntime,runtimeConnection} from './runtime-db.mjs';
test('pilot runtime writes business records but cannot change schemas or migration history',async()=>{
  const name='storeluma-acl-'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
  const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
  const sql=(database,query,user='postgres')=>docker(['exec','-i',name,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U',user,'-d',database],{input:query});
  docker(['run','-d','--rm','--name',name,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256','-e','POSTGRES_PASSWORD='+password,'postgres:17-alpine']);
  try{
    for(let i=0;i<60;i++){try{if(sql('postgres','SELECT 1')==='1')break;}catch{}await sleep(500);}
    sql('postgres',"CREATE ROLE sales LOGIN; CREATE DATABASE sales_db OWNER sales; REVOKE ALL ON DATABASE sales_db FROM PUBLIC;");
    sql('sales_db','CREATE TABLE schema_migrations(version text PRIMARY KEY);','sales');
    for(const file of readdirSync('services/sales/migrations').filter(x=>x.endsWith('.sql')).sort()){
      sql('sales_db',readFileSync('services/sales/migrations/'+file,'utf8'),'sales');
      sql('sales_db',"INSERT INTO schema_migrations VALUES('"+file.slice(0,3)+"')",'sales');
    }
    allowRuntime('sales',password,sql);allowRuntime('sales',password,sql);
    const runtime=runtimeConnection('sales',password);assert.notEqual(runtime.password,password);
    const asRuntime=q=>sql('sales_db',q,runtime.user);
    assert.equal(asRuntime("SELECT has_schema_privilege(current_user,'public','CREATE')"),'f');
    assert.equal(asRuntime("SELECT has_table_privilege(current_user,'schema_migrations','UPDATE')"),'f');
    assert.equal(asRuntime("SELECT has_table_privilege(current_user,'schema_migrations','SELECT')"),'t');
    sql('postgres','CREATE DATABASE finance_db; REVOKE ALL ON DATABASE finance_db FROM PUBLIC;');
    const connect=(pw,dbName)=>docker(['exec','-e','PGPASSWORD',name,'psql','-XAtq','-h','127.0.0.1','-U',runtime.user,'-d',dbName,'-c','SELECT 1'],{env:{...process.env,PGPASSWORD:pw}});
    assert.equal(connect(runtime.password,'sales_db'),'1');
    assert.throws(()=>connect(runtime.password,'finance_db'));
    const next=randomBytes(32).toString('hex');
    allowRuntime('sales',next,sql);
    assert.throws(()=>connect(runtime.password,'sales_db'));
    assert.equal(connect(runtimeConnection('sales',next).password,'sales_db'),'1');
    assert.equal(asRuntime("INSERT INTO customers(tenant_id,name) VALUES(gen_random_uuid(),'Test') RETURNING version"),'1');
  }finally{docker(['stop',name]);}
});
