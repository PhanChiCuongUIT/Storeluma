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
  const pending = last && (!last.status || last.status === 'deploying' || last.status === 'rolling-back');
  if (pending) {
    assert.ok([last.previous, last.next].includes(before), 'Running digest differs from interrupted deployment');
    assert.ok(rollback || (last.status !== 'rolling-back' && candidate === last.next),
      'Finish the interrupted service change before selecting a different digest');
  }
  const cancellingUnapplied = rollback && before === candidate && pending && last.status !== 'rolling-back';
  if (before === candidate && (!pending || cancellingUnapplied)) {
    check(candidate);
    replace(candidate);
    assert.equal(current(), candidate, 'Running image differs from selected digest');
    if (cancellingUnapplied) save({...last,status:'rolled-back'});
    return;
  }
  const entry = rollback || pending ? last : {previous: before, next: candidate, changedAt: new Date().toISOString()};
  const fallback = rollback ? entry.next : entry.previous;
  assert.match(fallback, digest);
  // A resumed change may already be running its target. If preflight now
  // fails, restore the recorded source just as for a readiness failure.
  if (before !== candidate) check(candidate);
  save({...entry, status: rollback ? 'rolling-back' : 'deploying'});
  try {
    if (before === candidate) check(candidate);
    replace(candidate);
    assert.equal(current(), candidate, 'Running image differs from selected digest');
    save({...entry, status: rollback ? 'rolled-back' : 'healthy'});
  } catch (error) {
    replace(fallback);
    assert.equal(current(), fallback, 'Verify the previous service image on the host');
    save({...entry, status: rollback ? 'rollback-failed' : 'reverted'});
    throw error;
  }
}
