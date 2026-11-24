import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {rollService} from './rollout.mjs';

test('service rollback uses its journal, refuses drift, and restores the old digest on failed readiness', () => {
  const dir=mkdtempSync(join(tmpdir(),'storeluma-rollout-'));
  const ref=c=>'ghcr.io/sample/sales@sha256:'+c.repeat(64);
  let active=ref('a');
  const args={action:'roll-service',journal:join(dir,'sales.json'),candidate:ref('b'),current:()=>active,
    check:()=>{},replace:image=>{active=image;}};
  try {
    rollService(args); assert.equal(active,ref('b'));
    rollService({...args,action:'rollback-service'}); assert.equal(active,ref('a'));
    rollService({...args,action:'rollback-service'}); assert.equal(active,ref('a'));
    assert.throws(()=>rollService({...args,candidate:ref('c'),replace:image=>{
      active=image;
      if(image===ref('c'))throw new Error('unhealthy');
    }}),/unhealthy/);
    assert.equal(active,ref('a'));
    assert.equal(JSON.parse(readFileSync(args.journal)).status,'reverted');
    active=ref('d');
    assert.throws(()=>rollService({...args,action:'rollback-service'}),/matching/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
