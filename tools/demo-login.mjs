// Local demonstration only. Never include this output in reports or screenshots.
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
const name=process.argv[2]??'owner';
const account=JSON.parse(readFileSync('infra/generated/accounts.json','utf8')).find(a=>a.username===name);
if(!account)throw new Error('Choose owner, cashier, or outsider. Run npm run setup first.');
let bits=0,value=0;const bytes=[];
for(const ch of account.otpSecret){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=digest.at(-1)&15;
const code=((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
console.log(`LOCAL DEMO ONLY\nURL: http://localhost:4100\nUsername: ${name}\nPassword: ${account.password}\nTOTP: ${code} (valid for about ${30-Math.floor(Date.now()/1000)%30}s)\nSubject ID: ${account.subject}\nRun this command again for the next TOTP. Do not share this output.`);
