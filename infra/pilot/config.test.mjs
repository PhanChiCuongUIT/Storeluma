import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';

test('pilot resolves only pinned images, exact HTTPS callbacks and edge ports', () => {
  const dir = mkdtempSync(join(tmpdir(),'storeluma-pilot-'));
  try {
    const keys = Object.keys(parseEnv(readFileSync('.env.example','utf8')));
    const env = Object.fromEntries(keys.map(k => [k, randomBytes(32).toString('hex')]));
    const app = 'https://shop.example.org';
    writeFileSync(join(dir,'.env'),Object.entries({...env, APP_HOST:'shop.example.org',IDENTITY_HOST:'identity.example.org'})
      .map(([k,v]) => k+'='+v).join('\n'));
    const client = {clientId:'storeluma-web',secret:env.OIDC_SECRET,redirectUris:[app+'/auth/callback'],webOrigins:[app],
      attributes:{'post.logout.redirect.uris':app+'/','pkce.code.challenge.method':'S256'}};
    const realm = { realm:'storeluma',sslRequired:'all',clients:[client] };
    const saveRealm = () => writeFileSync(join(dir,'realm.json'),JSON.stringify(realm));
    saveRealm();
    writeFileSync(join(dir,'init.sql'),'');
    mkdirSync(join(dir,'pgbackrest'));
    writeFileSync(join(dir,'pgbackrest/pgbackrest.conf'),'');
    const services = ['edge','postgres','rabbitmq','keycloak','business','catalog','inventory','finance','sales','reporting','notification','gateway'];
    const images = Object.fromEntries(services.map(s => [s,'example.org/'+s+'@sha256:'+'a'.repeat(64)]));
    const file = join(dir,'release.json');
    const saveRelease = () => writeFileSync(file,JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),platform:'linux/arm64',images}));
    const validate = () => spawnSync(process.execPath,['infra/pilot/deploy.mjs','validate',file,dir],{encoding:'utf8'});
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
