// Update only the presentation settings of an existing Storeluma realm.
import {readFileSync,writeFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync('.env','utf8').trim().split(/\r?\n/).map(s=>s.split('=')));
const base='http://localhost:8180';
const response=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'admin',password:env.KEYCLOAK_ADMIN_PASSWORD})});
if(!response.ok)throw new Error('Keycloak admin unavailable. Wait for startup and try again.');
const {access_token}=await response.json();
const branding={loginTheme:'storeluma',internationalizationEnabled:true,supportedLocales:['vi'],defaultLocale:'vi'};
const result=await fetch(base+'/admin/realms/storeluma',{method:'PUT',headers:{authorization:`Bearer ${access_token}`,'content-type':'application/json'},body:JSON.stringify(branding)});
if(!result.ok)throw new Error(`Could not apply Storeluma theme: ${result.status}`);
const path='infra/generated/storeluma-realm.json';
const realm=JSON.parse(readFileSync(path,'utf8'));
writeFileSync(path,JSON.stringify({...realm,...branding},null,2));
console.log('Storeluma login theme and Vietnamese locale applied. Accounts and authentication flow preserved.');
