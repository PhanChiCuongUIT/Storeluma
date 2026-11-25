// Keycloak's realm import only runs on creation. Add the unassigned role to an existing local realm.
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

const settings=parseEnv(readFileSync('.env','utf8')),base='http://127.0.0.1:8180';
const importPath='infra/generated/storeluma-realm.json';
const realm=JSON.parse(readFileSync(importPath,'utf8'));
realm.roles??={};realm.roles.realm??=[];
if(!realm.roles.realm.some(role=>role.name==='storeluma-ops')){
  realm.roles.realm.push({name:'storeluma-ops',description:'Platform operations'});
  writeFileSync(importPath,JSON.stringify(realm));
}
const token=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',redirect:'error',
  body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'admin',password:settings.KEYCLOAK_ADMIN_PASSWORD})});
if(!token.ok)throw new Error('Local Keycloak administration is unavailable');
const headers={authorization:'Bearer '+(await token.json()).access_token,'content-type':'application/json'};
const roles=base+'/admin/realms/storeluma/roles';
const lookup=()=>fetch(roles+'/storeluma-ops',{headers,redirect:'error'});
const status=(await lookup()).status;
if(status===404){
  const created=await fetch(roles,{method:'POST',headers,redirect:'error',body:JSON.stringify({name:'storeluma-ops',description:'Platform operations'})});
  if(!created.ok && created.status!==409)throw new Error('Could not add the operations role');
}
if(!(await lookup()).ok)throw new Error('The local operations role is unavailable');
console.log('Local operations role is available. No user assignment was changed.');
