import amqp, {type ConfirmChannel, type ChannelModel} from 'amqplib';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {db,transaction} from './db.js';
import {setReadiness} from './http.js';
const eventSchema=z.object({id:z.uuid(),type:z.enum(['site.provision.requested','warehouse.ready','register.ready','site.activated']),version:z.literal(1),tenantId:z.uuid(),siteId:z.uuid(),warehouseId:z.uuid(),registerId:z.uuid(),occurredAt:z.iso.datetime()});
export type Event=z.infer<typeof eventSchema>;
export async function worker(name:string,keys:string[],handle:(c:PoolClient,e:Event)=>Promise<void>){
  let channel:ConfirmChannel|undefined,connection:ChannelModel|undefined,busy=false,connecting=false;
  setReadiness(()=>Boolean(channel));
  const connect=async()=>{
    if(connecting||channel)return;connecting=true;
    try{
      connection=await amqp.connect(process.env.RABBIT_URL!);
      connection.on('error',()=>{});connection.on('close',()=>{channel=undefined;});
      const ch=await connection.createConfirmChannel();
      ch.on('error',()=>{});ch.on('close',()=>{channel=undefined;});
      await ch.assertExchange('storeluma','topic',{durable:true});
      await ch.assertExchange('storeluma.dead','fanout',{durable:true});
      for(const [queue,routes] of Object.entries({business:['warehouse.ready','register.ready'],inventory:['site.provision.requested'],finance:['site.provision.requested']})){
        await ch.assertQueue(queue,{durable:true,arguments:{'x-dead-letter-exchange':'storeluma.dead'}});
        for(const route of routes)await ch.bindQueue(queue,'storeluma',route);
      }
      await ch.assertQueue(`${name}.dead`,{durable:true});await ch.bindQueue(`${name}.dead`,'storeluma.dead','');
      await ch.assertQueue(name,{durable:true,arguments:{'x-dead-letter-exchange':'storeluma.dead'}});
      for(const key of keys)await ch.bindQueue(name,'storeluma',key);
      await ch.prefetch(8);
      await ch.consume(name,async msg=>{
        if(!msg)return;
        let event:Event;
        try{event=eventSchema.parse(JSON.parse(msg.content.toString()));if(!keys.includes(event.type))throw new Error('wrong route');}
        catch{ch.nack(msg,false,false);return;}
        try{
          await transaction(async c=>{
            const fresh=await c.query('INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
            if(fresh.rowCount)await handle(c,event);
          });
          ch.ack(msg);
        }catch{console.warn('consumer_retry',{service:name,eventId:event.id});setTimeout(()=>{try{ch.nack(msg,false,true);}catch{}},1000);}
      });
      channel=ch;console.log(`${name}: broker connected`);
    }catch{console.warn(`${name}: broker reconnect pending`);try{await connection?.close();}catch{}}
    finally{connecting=false;}
  };
  await connect();
  setInterval(async()=>{
    if(!channel){await connect();return;}if(busy)return;busy=true;
    try{
      const rows=await transaction(async c=>(await c.query(`UPDATE outbox SET lease_until=now()+interval '15 seconds' WHERE id IN (SELECT id FROM outbox WHERE delivered_at IS NULL AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows);
      for(const row of rows){
        const ch=channel;if(!ch)break;
        await new Promise<void>((resolve,reject)=>{ch.publish('storeluma',row.type,Buffer.from(JSON.stringify(row.payload)),{persistent:true,messageId:row.id},err=>err?reject(err):resolve());});
        await db.query('UPDATE outbox SET delivered_at=now() WHERE id=$1',[row.id]);
      }
    }catch{console.warn(`${name}: outbox retry pending`);}finally{busy=false;}
  },500);
}
