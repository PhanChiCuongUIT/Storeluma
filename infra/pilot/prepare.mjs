import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const [input, target] = process.argv.slice(2);
if (!input || !target) throw new Error('Usage: node infra/pilot/prepare.mjs PRIVATE_INPUT.env NEW_CONFIG_DIR');
const data = parseEnv(readFileSync(input,'utf8'));
function field(name, pattern) {
  if (!pattern.test(data[name] ?? '')) throw new Error('Missing or invalid field: ' + name);
  return data[name];
}
if (!isIPv4(data.SERVER_IP ?? '')) throw new Error('SERVER_IP must be an IPv4 address');
const domain = field('DOMAIN',/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const region = field('OCI_REGION',/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
const namespace = field('OCI_NAMESPACE',/^[a-z0-9-]+$/);
const bucket = field('OCI_BUCKET',/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);
const access = field('OCI_ACCESS_KEY',/^[A-Za-z0-9+/=_-]+$/);
const secret = field('OCI_SECRET_KEY',/^[A-Za-z0-9+/=_-]+$/);
const dst = resolve(target);
if (existsSync(dst)) throw new Error('Configuration already exists. Keep it for subsequent deployments.');
process.umask(0o077);
mkdirSync(dirname(dst), {recursive:true});
const work = mkdtempSync(join(dirname(dst),'.storeluma-init-'));
try {
  const setup = fileURLToPath(new URL('../../tools/dev-setup.mjs', import.meta.url));
  execFileSync(process.execPath,[setup],{ cwd:work, stdio:'pipe' });
  const generated = join(work,'infra/generated');
  const [credentials] = JSON.parse(readFileSync(join(generated,'accounts.json')));
  const realm = JSON.parse(readFileSync(join(generated,'storeluma-realm.json')));
  const app = 'https://shop.' + domain;
  const owner = realm.users[0];
  Object.assign(owner,{ id:randomUUID(), username:'chuho', firstName:'Chủ', lastName:'hộ' });
  owner.email = 'chuho@' + domain;
  owner.emailVerified = false;
  realm.users = [owner];
  realm.sslRequired = 'all';
  const client = realm.clients.find(c => c.clientId === 'storeluma-web');
  client.redirectUris=[app+'/auth/callback'];
  client.webOrigins=[app];
  client.attributes['post.logout.redirect.uris']=app+'/';
  writeFileSync(join(work,'realm.json'),JSON.stringify(realm));
  renameSync(join(generated,'init.sql'),join(work,'init.sql'));
  appendFileSync(join(work,'.env'),`APP_HOST=shop.${domain}\nIDENTITY_HOST=id.${domain}\n`);
  writeFileSync(join(work,'owner-login.json'),JSON.stringify({ url:app, username:owner.username,
    password:credentials.password, otpSecret:credentials.otpSecret, digits:6, period:30, algorithm:'SHA1' },null,2));
  mkdirSync(join(work,'pgbackrest'));
  writeFileSync(join(work,'pgbackrest/pgbackrest.conf'),`[global]
repo1-type=s3
repo1-s3-endpoint=${namespace}.compat.objectstorage.${region}.oci.customer-oci.com
repo1-s3-region=${region}
repo1-s3-bucket=${bucket}
repo1-s3-uri-style=path
repo1-s3-key=${access}
repo1-s3-key-secret=${secret}
repo1-path=/storeluma
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${randomBytes(32).toString('hex')}
repo1-retention-full=2
repo1-bundle=y
compress-type=zst
start-fast=y
log-level-file=off

[storeluma]
pg1-path=/var/lib/postgresql/data
`);
  rmSync(join(work,'infra'),{recursive:true});
  rmSync(join(work,'.env.example'));
  // These two bind-mounted files are read by different container UIDs; the parent is 0700.
  for (const name of ['realm.json','init.sql']) chmodSync(join(work,name),0o444);
  renameSync(work,dst);
  console.log('Prepared private pilot configuration. Keep owner-login.json and a separate secure copy of the configuration.');
} finally {
  if (existsSync(work)) rmSync(work,{recursive:true});
}
