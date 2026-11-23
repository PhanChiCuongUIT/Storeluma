import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const [action, releaseFile, configPath] = process.argv.slice(2);
if (!['validate','deploy','backup-full','backup-diff','check-archive'].includes(action) || !releaseFile || !configPath)
  throw new Error('Usage: node infra/pilot/deploy.mjs validate|deploy|backup-full|backup-diff|check-archive RELEASE.json PRIVATE_CONFIG_DIR');
const dir = resolve(configPath), dotenv = join(dir,'.env');
const release = JSON.parse(readFileSync(releaseFile,'utf8'));
assert.match(release.commit, /^[a-f0-9]{40}$/);
assert.equal(release.platform,'linux/arm64');
const localCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(release.commit,localCommit,'Check out the release commit before deploying its configuration');
const settings = parseEnv(readFileSync(dotenv,'utf8'));
for (const key of Object.keys(parseEnv(readFileSync('.env.example','utf8')))) {
  if (!settings[key] || settings[key] === 'GENERATED_BY_NPM_RUN_SETUP') throw new Error('Missing pilot setting: ' + key);
}
assert.ok(/^[a-f0-9]{64}$/i.test(settings.SESSION_KEY),'Invalid session encryption key');
for (const host of [settings.APP_HOST,settings.IDENTITY_HOST]) {
  assert.match(host ?? '',/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
  assert.ok(!host.endsWith('.localhost'));
}
assert.notEqual(settings.APP_HOST,settings.IDENTITY_HOST);
const realm = JSON.parse(readFileSync(join(dir,'realm.json'),'utf8'));
const app = 'https://' + settings.APP_HOST;
const client = realm.clients?.find(c => c.clientId === 'storeluma-web');
assert.equal(realm.realm,'storeluma');
assert.equal(realm.sslRequired?.toLowerCase(),'all');
assert.deepEqual(client?.redirectUris,[app + '/auth/callback']);
assert.deepEqual(client?.webOrigins,[app]);
assert.equal(client?.attributes?.['post.logout.redirect.uris'],app + '/');
assert.equal(client?.attributes?.['pkce.code.challenge.method'],'S256');
assert.ok(settings.OIDC_SECRET && client.secret === settings.OIDC_SECRET,'Client configuration mismatch');
assert.ok(existsSync(join(dir,'init.sql')) && existsSync(join(dir,'pgbackrest/pgbackrest.conf')));
const env = { ...process.env, ...settings, PILOT_CONFIG_DIR:dir };
const services = ['edge','postgres','keycloak','rabbitmq','business','catalog','inventory','finance','sales','gateway','reporting','notification'];
for (const service of services) {
  const ref = release.images?.[service];
  assert.match(ref ?? '', /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
  env[service.toUpperCase() + '_IMAGE'] = ref;
}
const compose = ['compose','-p','storeluma-pilot','--env-file',dotenv,'-f','compose.yaml','-f','infra/pilot/compose.yaml'];
const run = (...args) => execFileSync('docker',[...compose,...args],{env,stdio:'inherit'});
const config = JSON.parse(execFileSync('docker',[...compose,'config','--format','json'],{env,encoding:'utf8'}));
for (const service of services) {
  const s = config.services[service];
  assert.equal(s.image,release.images[service]);
  assert.equal(s.restart,'unless-stopped','Missing restart policy for '+service);
  assert.ok(!s.build);
  if (service !== 'edge') assert.ok(!s.ports?.length);
}
assert.deepEqual(config.services.edge.ports.map(p => String(p.published)).sort(), ['443','80']);
const backup = (...cmd) => run('exec','-T','-u','postgres','postgres','pgbackrest','--stanza=storeluma',...cmd);
if (action === 'check-archive') backup('check');
if (action === 'backup-full' || action === 'backup-diff') {
  backup('check');
  backup('--type=' + action.slice(7),'backup');
}
if (action === 'deploy') {
  run('pull');
  run('up','-d','--no-build','--wait','postgres','rabbitmq');
  backup('stanza-create');
  backup('check');
  backup('--type=full','backup');
  run('up','-d','--no-build','--wait','--wait-timeout','300');
  const issuer = 'https://' + settings.IDENTITY_HOST + '/realms/storeluma';
  for (const [url,field,expected] of [[issuer+'/.well-known/openid-configuration','issuer',issuer],[app+'/health','status','ok']]) {
    let verified = false;
    for (let n=0;n<30;n++) {
      try {
        const r = await fetch(url,{signal:AbortSignal.timeout(8000)});
        verified = r.ok && (await r.json())[field] === expected;
      } catch {}
      if (verified) break;
      await new Promise(done => setTimeout(done,2000));
    }
    assert.ok(verified,'Public HTTPS readiness failed: '+url);
  }
}
console.log('Pilot ' + action + ' succeeded for ' + release.commit);
