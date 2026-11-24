import {createHash,createHmac,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import routes from '../../packages/platform/routes.json' with {type:'json'};
const services=Object.keys(routes.consumers);
const pattern=names=>names.length?'^('+names.map(s=>s.replaceAll('.','\\.')).join('|')+')$':'^$';
function credentials(service,master){
  if(!services.includes(service)||!master)throw new Error('Unknown broker account');
  return createHmac('sha256',master).update('storeluma-amqp:'+service).digest('hex');
}
export const brokerUrl=(service,master)=>'amqp://sl_'+service+':'+credentials(service,master)+'@rabbitmq:5672';
export function definitions(master,serviceSeeds={}){
  const users=[],permissions=[],topic_permissions=[],exchanges=[],queues=[],bindings=[];
  const exchange=(name,type)=>exchanges.push({name,type,vhost:'/',durable:true,auto_delete:false,internal:false,arguments:{}});
  const queue=(name,args={})=>queues.push({name,vhost:'/',durable:true,auto_delete:false,arguments:args});
  const bind=(source,destination,routing_key)=>bindings.push({vhost:'/',source,destination,destination_type:'queue',routing_key,arguments:{}});
  exchange('storeluma','topic');exchange('storeluma.dead','fanout');queue('storeluma.deferred');
  for(const key of routes.deferred)bind('storeluma','storeluma.deferred',key);
  for(const service of services){
    const user='sl_'+service,salt=randomBytes(4),retry='storeluma.retry.'+service;
    const hash=createHash('sha256').update(salt).update(credentials(service,serviceSeeds[service]??master)).digest();
    users.push({name:user,password_hash:Buffer.concat([salt,hash]).toString('base64'),hashing_algorithm:'rabbit_password_hashing_sha256',tags:[]});
    permissions.push({user,vhost:'/',configure:'^$',read:pattern([service]),write:pattern(['storeluma',retry])});
    topic_permissions.push({user,vhost:'/',exchange:'storeluma',write:pattern(routes.producers[service]),read:pattern(routes.consumers[service])});
    exchange(retry,'direct');queue(service,{'x-dead-letter-exchange':'storeluma.dead'});queue(service+'.dead');
    bind(retry,service,service);bind(retry,service+'.dead',service+'.dead');
    for(const key of routes.consumers[service])bind('storeluma',service,key);
  }
  return {users,vhosts:[{name:'/'}],permissions,topic_permissions,exchanges,queues,bindings};
}
export function configureBroker(compose,env,master,serviceSeeds={}){
  execFileSync('docker',[...compose,'exec','-T','-u','rabbitmq','rabbitmq','sh','-ec',
    'umask 077; file=$(mktemp); trap \'rm -f "$file"\' EXIT; cat > "$file"; rabbitmqctl import_definitions "$file"'],
    {input:JSON.stringify(definitions(master,serviceSeeds)),env,stdio:['pipe','inherit','inherit']});
}
