import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';

test('pilot resolves only pinned images, exact HTTPS callbacks and edge ports', () => {
  const dir = mkdtempSync(join(tmpdir(),'storeluma-pilot-'));
  try {
    const input = join(dir,'input.env'), config = join(dir,'private');
    writeFileSync(input,'SERVER_IP=192.0.2.10\nDOMAIN=example.org\nOCI_REGION=ap-singapore-1\nOCI_NAMESPACE=sample\nOCI_BUCKET=sample-backups\nOCI_ACCESS_KEY=test\nOCI_SECRET_KEY='+randomBytes(24).toString('hex'));
    const cmd = ['infra/pilot/prepare.mjs',input,config];
    execFileSync(process.execPath,cmd);
    const secrets = readFileSync(join(config,'.env'),'utf8');
    assert.notEqual(spawnSync(process.execPath,cmd).status,0);
    assert.ok(readFileSync(join(config,'.env'),'utf8')===secrets,'Retry changed the generated credentials');
    const realm = JSON.parse(readFileSync(join(config,'realm.json'),'utf8'));
    const client = realm.clients[0], app = 'https://shop.example.org';
    assert.deepEqual(realm.users.map(u=>u.username),['chuho']);
    assert.equal(parseEnv(secrets).IDENTITY_HOST,'id.example.org');
    assert.match(readFileSync(join(config,'pgbackrest/pgbackrest.conf'),'utf8'),/repo1-type=s3\n/);
    const saveRealm = () => {
      chmodSync(join(config,'realm.json'),0o600);
      writeFileSync(join(config,'realm.json'),JSON.stringify(realm));
    };
    const services = ['edge','postgres','rabbitmq','keycloak','business','catalog','inventory','finance','sales','reporting','notification','gateway'];
    const images = Object.fromEntries(services.map(s => [s,'example.org/'+s+'@sha256:'+'a'.repeat(64)]));
    const file = join(dir,'release.json');
    const saveRelease = () => writeFileSync(file,JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:'linux/arm64',images}));
    const validate = () => spawnSync(process.execPath,['infra/pilot/deploy.mjs','validate',file,config],{encoding:'utf8'});
    saveRelease();
    let r = validate();
    assert.equal(r.status,0,r.stderr);
    images.sales='example.org/sales:latest';
    saveRelease();
    assert.notEqual(validate().status,0);
    images.sales=images.gateway;
    saveRelease();
    client.redirectUris=[app+'/*'];
    saveRealm();
    assert.notEqual(validate().status,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
