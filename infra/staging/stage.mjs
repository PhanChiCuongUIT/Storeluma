import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const state = resolve(root, 'tmp/https-staging');
const origin = 'https://storeluma.localhost:9443';
const project = 'storeluma-https-stage';
const git = (...command) => execFileSync('git', command, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const revision = commit + (git('status', '--porcelain') ? '-dirty' : '');
const env = { ...process.env, STAGING_REVISION: revision };
const args = ['compose', '-p', project, '--env-file', resolve(state, '.env'),
  '-f', 'compose.yaml', '-f', 'infra/staging/compose.yaml'];
const run = (...command) => execFileSync('docker', [...args, ...command], { cwd: root, env, stdio: 'inherit' });
const capture = (...command) => execFileSync('docker', command, { cwd: root, env, encoding: 'utf8' }).trim();

async function up() {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  execFileSync(process.execPath, [resolve(root, 'tools/dev-setup.mjs')], { cwd: state, stdio: 'inherit' });
  const realmPath = resolve(state, 'infra/generated/storeluma-realm.json');
  const realm = JSON.parse(readFileSync(realmPath, 'utf8'));
  const client = realm.clients.find(entry => entry.clientId === 'storeluma-web');
  client.redirectUris = [origin + '/auth/callback'];
  client.webOrigins = [origin];
  client.attributes['post.logout.redirect.uris'] = origin + '/';
  realm.sslRequired = 'all';
  writeFileSync(realmPath, JSON.stringify(realm));

  run('up', '-d', '--no-deps', '--force-recreate', 'edge');
  let cert;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      cert = execFileSync('docker', [...args, 'exec', '-T', 'edge', 'cat',
        '/data/caddy/pki/authorities/local/root.crt'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
      break;
    } catch { await sleep(1000); }
  }
  if (!cert?.startsWith('-----BEGIN CERTIFICATE-----')) throw new Error('Staging CA is unavailable');
  writeFileSync(resolve(state, 'root.crt'), cert);
  run('up', '-d', '--build', '--wait', '--wait-timeout', '300');
}

function manifest() {
  const services = {};
  for (const service of capture(...args, 'config', '--services').split(/\r?\n/)) {
    const container = capture(...args, 'ps', '-q', service);
    const info = JSON.parse(capture('inspect', container))[0];
    if (!info.State.Running || (service !== 'edge' && info.State.Health?.Status !== 'healthy')) {
      throw new Error('Service not ready: ' + service);
    }
    const published = Object.entries(info.NetworkSettings.Ports ?? {}).flatMap(([port, bindings]) =>
      (bindings ?? []).map(b => b.HostIp + ':' + b.HostPort + '->' + port)).sort();
    const expected = service === 'edge' ? ['127.0.0.1:9080->9080/tcp', '127.0.0.1:9443->9443/tcp'] : [];
    if (published.join(',') !== expected.join(',')) throw new Error('Unexpected port exposure: ' + service);
    const image = JSON.parse(capture('image', 'inspect', info.Image))[0];
    services[service] = { imageId: info.Image, registryDigests: image.RepoDigests ?? [],
      platform: image.Os + '/' + image.Architecture, published };
    if (!['postgres', 'rabbitmq', 'keycloak', 'edge'].includes(service)) {
      if (image.Config.Labels?.['org.opencontainers.image.revision'] !== revision || image.Config.User !== 'node') {
        throw new Error('Unexpected application image revision or runtime user: ' + service);
      }
      const migrations = capture('exec', container, 'ls', 'services/' + service + '/migrations')
        .split(/\r?\n/).filter(file => /^\d+\.sql$/.test(file)).sort();
      if (!migrations.length) throw new Error('No migrations in image: ' + service);
      services[service].latestMigrationFile = migrations.at(-1);
    }
  }
  writeFileSync(resolve(state, 'manifest.json'), JSON.stringify({
    commit, revision, checkedAt: new Date().toISOString(), project, services
  }, null, 2) + '\n');
}

switch (process.argv[2]) {
  case 'up': await up(); break;
  case 'manifest': manifest(); break;
  case 'down': run('down'); break;
  default: throw new Error('Usage: node infra/staging/stage.mjs up|manifest|down');
}
