import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync,readFileSync,appendFileSync } from 'node:fs';
const target='infra/generated';
if (existsSync('.env')) {
  if (!existsSync(`${target}/storeluma-realm.json`)) throw new Error('Existing .env: restore infra/generated from the same setup; no secrets overwritten.');
  const current=readFileSync('.env','utf8');
  for(const service of ['catalog','inventory','finance','sales']){const key=service.toUpperCase()+'_SERVICE_KEY';if(!new RegExp('^'+key+'=','m').test(current))appendFileSync('.env',`\n${key}=${randomBytes(32).toString('hex')}\n`);}
  console.log('Existing local configuration preserved.'); process.exit(0);
}
mkdirSync(target,{recursive:true});
const secret=()=>randomBytes(24).toString('hex');
const env={PG_ADMIN_PASSWORD:secret(),RABBIT_PASSWORD:secret(),KEYCLOAK_ADMIN_PASSWORD:secret(),OIDC_SECRET:secret(),SESSION_KEY:randomBytes(32).toString('hex')};
const services=['business','inventory','finance','catalog','sales','reporting','notification','gateway','keycloak'];
for(const s of ['catalog','inventory','finance','sales'])env[`${s.toUpperCase()}_SERVICE_KEY`]=randomBytes(32).toString('hex');
for (const s of services) env[`${s.toUpperCase()}_DB_PASSWORD`]=secret();
writeFileSync('.env',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
writeFileSync('.env.example',Object.keys(env).map(k=>`${k}=GENERATED_BY_NPM_RUN_SETUP`).join('\n')+'\n');
writeFileSync(`${target}/init.sql`,services.map(s=>`CREATE ROLE ${s} LOGIN PASSWORD '${env[`${s.toUpperCase()}_DB_PASSWORD`]}';\nCREATE DATABASE ${s}_db OWNER ${s};\nREVOKE ALL ON DATABASE ${s}_db FROM PUBLIC;\nGRANT CONNECT ON DATABASE ${s}_db TO ${s};`).join('\n'));
const base32=bytes=>{let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value>>>(bits-5))&31];bits-=5;}}return out;};
const accounts=['owner','cashier','outsider'].map((username,i)=>({username,subject:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,password:secret().slice(0,20)+'Aa1!',otpSecret:base32(randomBytes(20))}));
writeFileSync(`${target}/accounts.json`,JSON.stringify(accounts,null,2));
const realm={realm:'storeluma',enabled:true,displayName:'Storeluma',registrationAllowed:false,resetPasswordAllowed:false,sslRequired:'none',accessTokenLifespan:900,
  loginTheme:'storeluma',internationalizationEnabled:true,supportedLocales:['vi'],defaultLocale:'vi',
  browserFlow:'storeluma-browser',authenticationFlows:[{alias:'storeluma-browser',description:'Password and TOTP required',providerId:'basic-flow',topLevel:true,builtIn:false,authenticationExecutions:[{authenticator:'auth-username-password-form',requirement:'REQUIRED',priority:10,userSetupAllowed:false,authenticatorFlow:false},{authenticator:'auth-otp-form',requirement:'REQUIRED',priority:20,userSetupAllowed:false,authenticatorFlow:false}]}],
  bruteForceProtected:true,failureFactor:5,permanentLockout:false,
  clients:[{clientId:'storeluma-web',enabled:true,publicClient:false,secret:env.OIDC_SECRET,standardFlowEnabled:true,directAccessGrantsEnabled:false,
    redirectUris:['http://localhost:4100/auth/callback'],webOrigins:['http://localhost:4100'],attributes:{'post.logout.redirect.uris':'http://localhost:4100/','pkce.code.challenge.method':'S256'},
    protocolMappers:[{name:'api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.custom.audience':'storeluma-api','access.token.claim':'true','id.token.claim':'false'}}]}],
  users:accounts.map(a=>({id:a.subject,username:a.username,enabled:true,firstName:a.username==='owner'?'Chủ hộ':a.username==='cashier'?'Thu ngân':'Người dùng khác',lastName:'Demo',email:`${a.username}@storeluma.test`,emailVerified:false,
    credentials:[{type:'password',value:a.password,temporary:false},{type:'otp',secretData:JSON.stringify({value:a.otpSecret}),credentialData:JSON.stringify({subType:'totp',digits:6,counter:0,period:30,algorithm:'HmacSHA1',secretEncoding:'BASE32'})}],requiredActions:[]}))};
writeFileSync(`${target}/storeluma-realm.json`,JSON.stringify(realm,null,2));
console.log('Local secrets and 3 password + TOTP demo accounts created in ignored infra/generated/accounts.json.');
