// Transfer a disposable encrypted rehearsal between two hosts. The private key stays on the receiver.
import {createCipheriv,createDecipheriv,createPrivateKey,createPublicKey,generateKeyPairSync,privateDecrypt,publicEncrypt,randomBytes} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

const magic=Buffer.from("STORELUMA1");
export function seal(bytes,recipient){
  const publicKey=createPublicKey({key:Buffer.from(recipient,"base64"),format:"der",type:"spki"});
  if(publicKey.asymmetricKeyType!=="rsa"||publicKey.asymmetricKeyDetails.modulusLength!==3072)throw new Error("Expected RSA-3072 recipient");
  const aes=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",aes,iv);
  const key=publicEncrypt({key:publicKey,oaepHash:"sha256"},aes);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([magic,key,iv,cipher.getAuthTag(),encrypted]);
}
export function unseal(bytes,pem){
  if(!bytes.subarray(0,magic.length).equals(magic))throw new Error("Unknown transfer format");
  const offset=magic.length+384,secret=privateDecrypt({key:createPrivateKey(pem),oaepHash:"sha256"},bytes.subarray(magic.length,offset));
  const decipher=createDecipheriv("aes-256-gcm",secret,bytes.subarray(offset,offset+12));
  decipher.setAuthTag(bytes.subarray(offset+12,offset+28));
  return Buffer.concat([decipher.update(bytes.subarray(offset+28)),decipher.final()]);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const dir=process.argv[2];if(!dir)throw new Error("Provide a new private destination directory");
  mkdirSync(dir,{recursive:true,mode:0o700});
  const pair=generateKeyPairSync("rsa",{modulusLength:3072});
  writeFileSync(join(dir,"receiver.pem"),pair.privateKey.export({format:"pem",type:"pkcs8"}),{mode:0o600,flag:"wx"});
  writeFileSync(join(dir,'receiver-start.json'),JSON.stringify({startedAt:Date.now()}),{flag:'wx',mode:0o600});
  writeFileSync(join(dir,"recipient.txt"),pair.publicKey.export({format:"der",type:"spki"}).toString("base64"),{flag:"wx"});
}
