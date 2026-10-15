import { Pool, type PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const db = new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000});
export async function transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function migrate(service:string){
  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(441004)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done=await c.query('SELECT 1 FROM schema_migrations WHERE version=$1',['001']);
    if(!done.rowCount){await c.query(await readFile(`services/${service}/migrations/001.sql`,'utf8'));await c.query('INSERT INTO schema_migrations(version) VALUES($1)',['001']);}
  });
}
export async function outbox(c:PoolClient,type:string,payload:Record<string,unknown>){
  const event={id:randomUUID(),type,occurredAt:new Date().toISOString(),version:1,...payload};
  await c.query('INSERT INTO outbox(id,type,payload) VALUES($1,$2,$3)',[event.id,type,event]);
}
