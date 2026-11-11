import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,mkdirSync,mkdtempSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {removeMigrationWorkspace} from './helpers/migration-workspace';
const exec=promisify(execFile);
const env=Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
test('MIG-02 Finance upgrade preserves historical closed drawer and adds isolated refund sources',async()=>{
  const name='storeluma_migration_'+randomUUID().replaceAll('-',''),connection={host:'127.0.0.1',port:Number(env.PG_HOST_PORT??55432),user:'postgres',password:env.PG_ADMIN_PASSWORD};
  const admin=new Pool({...connection,database:'postgres'}),fixture=new Pool({...connection,database:name});
  mkdirSync('tmp',{recursive:true});const workspace=mkdtempSync(resolve('tmp/migration-')),directory=join(workspace,'services/finance/migrations');mkdirSync(directory,{recursive:true});
  const moduleUrl=pathToFileURL(resolve('dist/packages/platform/db.js')).href,url=new URL(`postgresql://127.0.0.1:${connection.port}/${name}`);url.username=connection.user;url.password=connection.password;
  const migrate=()=>exec(process.execPath,['--input-type=module','-e',`const {migrate,db}=await import(${JSON.stringify(moduleUrl)});try{await migrate('finance')}finally{await db.end()}`],{cwd:workspace,env:{...process.env,DATABASE_URL:url.href},timeout:30000});let created=false;
  try{
    await admin.query(`CREATE DATABASE "${name}"`);created=true;for(const file of ['001.sql','002.sql','003.sql','004.sql'])copyFileSync('services/finance/migrations/'+file,join(directory,file));await migrate();
    const t=randomUUID(),site=randomUUID(),register=randomUUID(),shift=randomUUID(),payment=randomUUID(),order=randomUUID(),actor=randomUUID();
    await fixture.query("INSERT INTO registers(id,tenant_id,site_id,name) VALUES($1,$2,$3,'Quầy cũ')",[register,t,site]);
    await fixture.query("INSERT INTO shifts(id,tenant_id,site_id,register_id,cashier_id,opening_cash,status,expected_cash,counted_cash,difference_vnd,closed_at) VALUES($1,$2,$3,$4,$5,500000,'CLOSED',700000,700000,0,now())",[shift,t,site,register,actor]);
    await fixture.query("INSERT INTO payments(id,tenant_id,site_id,order_id,reservation_id,shift_id,actor_id,order_code,amount_vnd,tendered_vnd,status) VALUES($1,$2,$3,$4,$5,$6,$7,'OLD-ORDER',200000,200000,'SUCCEEDED')",[payment,t,site,order,randomUUID(),shift,actor]);
    await fixture.query('INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,payment_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,200000,$6)',[randomUUID(),t,site,shift,payment,actor]);
    const before=(await fixture.query('SELECT id,payment_id,amount_vnd,shift_id FROM cash_ledger')).rows;
    copyFileSync('services/finance/migrations/005.sql',join(directory,'005.sql'));await Promise.all([migrate(),migrate()]);await migrate();
    expect((await fixture.query('SELECT id,payment_id,amount_vnd,shift_id FROM cash_ledger')).rows).toEqual(before);
    expect((await fixture.query('SELECT status,expected_cash,counted_cash,difference_vnd FROM shifts')).rows[0]).toEqual({status:'CLOSED',expected_cash:'700000',counted_cash:'700000',difference_vnd:'0'});
    const refund=randomUUID();await fixture.query('INSERT INTO refunds(id,tenant_id,site_id,return_id,order_id,payment_id,amount_vnd,shift_id) VALUES($1,$2,$3,$4,$5,$6,50000,$7)',[refund,t,site,randomUUID(),order,payment,shift]);
    await expect(fixture.query('INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,payment_id,refund_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,$6,-50000,$7)',[randomUUID(),t,site,shift,payment,refund,actor])).rejects.toMatchObject({code:'23514'});
    const newShift=randomUUID();await fixture.query('INSERT INTO shifts(id,tenant_id,site_id,register_id,cashier_id,opening_cash) VALUES($1,$2,$3,$4,$5,0)',[newShift,t,site,register,actor]);
    await fixture.query('INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,refund_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,-50000,$6)',[randomUUID(),t,site,newShift,refund,actor]);
    expect((await fixture.query('SELECT amount_vnd FROM cash_ledger WHERE refund_id=$1',[refund])).rows[0].amount_vnd).toBe('-50000');
    expect((await fixture.query('SELECT expected_cash FROM shifts WHERE id=$1',[shift])).rows[0].expected_cash).toBe('700000');
    copyFileSync('services/finance/migrations/006.sql',join(directory,'006.sql'));await Promise.all([migrate(),migrate()]);await migrate();
    expect((await fixture.query('SELECT amount_vnd FROM cash_ledger ORDER BY amount_vnd')).rows.map(r=>r.amount_vnd)).toEqual(['-50000','200000']);
    expect((await fixture.query("SELECT data->>'amountVnd' amount FROM projection_records WHERE kind='MONEY' ORDER BY (data->>'amountVnd')::numeric")).rows.map(r=>r.amount)).toEqual(['-50000','200000']);
    expect((await fixture.query("SELECT count(*) FROM projection_records WHERE kind='SHIFT'")).rows[0].count).toBe('2');
  }finally{
    try{await fixture.end();if(created&&/^storeluma_migration_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE "${name}"`);}
    finally{try{await admin.end();}finally{removeMigrationWorkspace(workspace);}}
  }
});
