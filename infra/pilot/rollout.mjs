import assert from 'node:assert/strict';
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';

const digest = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;

// The caller holds the host deployment lock for the entire change. Keep the
// previous digest on disk before replacing a container so a retry can recover it.
export function rollService({action, candidate, journal, current, check, replace}) {
  const before = current();
  assert.match(before, digest);
  const last = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')) : undefined;
  const save = entry => {
    writeFileSync(journal + '.new', JSON.stringify(entry, null, 2), {mode: 0o600});
    renameSync(journal + '.new', journal);
  };
  const rollback = action === 'rollback-service';
  if (rollback) {
    assert.ok(last && [last.next, last.previous].includes(before), 'No matching service deployment to roll back');
    candidate = last.previous;
  }
  assert.match(candidate, digest);
  if (before === candidate) {
    check(candidate);
    replace(candidate);
    return;
  }
  check(candidate);
  const entry = {previous: before, next: candidate, changedAt: new Date().toISOString()};
  save(entry);
  try {
    replace(candidate);
    assert.equal(current(), candidate, 'Running image differs from selected digest');
    save(rollback ? {...last, status: 'rolled-back'} : {...entry, status: 'healthy'});
  } catch (error) {
    replace(before);
    assert.equal(current(), before, 'Verify the previous service image on the host');
    save({...entry, status: 'reverted'});
    throw error;
  }
}
