import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import amqp from 'amqplib';
import {brokerUrl,definitions} from './broker.mjs';

test('pilot service accounts publish owned routes, receive their retries and have no configuration grant',async()=>{
  const name='storeluma-pilot-amqp-'+randomBytes(5).toString('hex'),master=randomBytes(24).toString('hex');
  const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
  docker(['run','--name',name,'-e','RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=+S 2:2','-d','-p','127.0.0.1::5672','rabbitmq:4.1-management-alpine']);
  let finance,sales;
  try{
    for(let i=0;i<120;i++){
      if(docker(['logs',name]).includes('Server startup complete'))break;
      if(docker(['inspect','--format','{{.State.Running}}',name])!=='true')throw new Error('RabbitMQ exited during startup');
      await sleep(500);
    }
    docker(['exec','-i','-u','rabbitmq',name,'sh','-ec','umask 077; file=$(mktemp); trap \'rm -f "$file"\' EXIT; cat > "$file"; rabbitmqctl import_definitions "$file"'],{input:JSON.stringify(definitions(master))});
    const port=docker(['port',name,'5672/tcp']).split(':').at(-1);
    const connect=service=>amqp.connect(brokerUrl(service,master).replace('rabbitmq:5672','127.0.0.1:'+port));
    finance=await connect('finance');sales=await connect('sales');
    const p=await sales.createConfirmChannel(),reader=await finance.createChannel(),sender=await finance.createConfirmChannel();
    sender.publish('storeluma.retry.finance','finance',Buffer.from('retry'));await sender.waitForConfirms();
    const queued=await reader.get('finance',{noAck:true});assert.equal(queued.content.toString(),'retry');
    p.publish('storeluma','sales.order-completed.v1',Buffer.from('fixture'));await p.waitForConfirms();
    const flags=docker(['exec','-u','rabbitmq',name,'rabbitmqctl','list_user_permissions','sl_sales','--formatter','json']);
    assert.equal(JSON.parse(flags)[0].configure,'^$');
    const topics=JSON.parse(docker(['exec','-u','rabbitmq',name,'rabbitmqctl','list_user_topic_permissions','sl_sales','--formatter','json']));
    assert.equal(new RegExp(topics[0].write).test('finance.payment-succeeded.v1'),false);
  }finally{await finance?.close();await sales?.close();docker(['rm','-f',name]);}
});
