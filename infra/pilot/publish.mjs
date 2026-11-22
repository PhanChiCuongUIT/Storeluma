import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const result = JSON.parse(readFileSync('tmp/recovery/latest.json'));
const commit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(result.revision, commit);
assert.equal(result.platform, 'linux/arm64');
const registry = process.env.GITHUB_REPOSITORY?.toLowerCase();
if (!registry || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(registry)) throw new Error('Missing release repository');
const images = {};
for (const [service, imageId] of Object.entries(result.images)) {
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const info = () => JSON.parse(execFileSync('docker',['image','inspect',imageId],{encoding:'utf8'}))[0];
  const builtin = { edge:'caddy', keycloak:'quay.io/keycloak/keycloak', rabbitmq:'rabbitmq' }[service];
  const repository = builtin ?? 'ghcr.io/' + registry + '/' + service;
  if (!builtin) {
    const tag = repository + ':' + commit;
    execFileSync('docker',['tag',imageId,tag],{stdio:'inherit'});
    execFileSync('docker',['push',tag],{stdio:'inherit'});
  }
  const digest = info().RepoDigests.find(ref => ref.startsWith(repository + '@')
    || ref.startsWith('docker.io/library/' + repository + '@'));
  assert.ok(digest, 'Missing registry digest for ' + service);
  images[service] = digest;
}
assert.equal(Object.keys(images).length,12);
writeFileSync('tmp/recovery/release.json',JSON.stringify({ commit, platform: result.platform, images },null,2));
