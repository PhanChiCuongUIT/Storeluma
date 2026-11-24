import { Pool, type PoolClient } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const db = new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000});
export async function transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++){
    const c=await db.connect();
    try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
    catch(e){await c.query('ROLLBACK');if(attempt>=2||!['40001','40P01'].includes((e as {code:string}).code))throw e;}
    finally{c.release();}
    await new Promise(resolve=>setTimeout(resolve,30+Math.random()*100));
  }
}
export async function migrate(service:string){
  if(process.env.STORELUMA_SCHEMA_MODE==='verify'){
    const files=(await readdir(`services/${service}/migrations`)).filter(f=>/^\d{3}\.sql$/.test(f));
    const applied=new Set((await db.query('SELECT version FROM schema_migrations')).rows.map(r=>r.version));
    if(files.some(f=>!applied.has(f.slice(0,3))))throw new Error('Database migration required for '+service);
    return;
  }
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(441004)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=`services/${service}/migrations`;
    for(const file of (await readdir(directory)).filter(f=>/^\d{3}\.sql$/.test(f)).sort()){
      const version=file.slice(0,3);
      const done=await c.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version]);
      if(!done.rowCount){await c.query(await readFile(`${directory}/${file}`,'utf8'));await c.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);}
    }
  });
}
export async function outbox(c:PoolClient,type:string,payload:Record<string,unknown>){
  const event={id:randomUUID(),type,occurredAt:new Date().toISOString(),version:1,...payload};
  await c.query('INSERT INTO outbox(id,type,payload) VALUES($1,$2,$3)',[event.id,type,event]);
}
