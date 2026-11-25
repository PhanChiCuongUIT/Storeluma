import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
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

test('failed rollback keeps its target and a retry reaches it', t => {
  const dir=mkdtempSync(join(tmpdir(),'storeluma-rollout-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const previous='example/sales@sha256:'+'a'.repeat(64), next='example/sales@sha256:'+'b'.repeat(64);
  let active=previous;
  const args={action:'roll-service',journal:join(dir,'sales.json'),candidate:next,current:()=>active,
    check:()=>{},replace:image=>{active=image;}};
  rollService(args);
  const rollback={...args,action:'rollback-service'};
  assert.throws(()=>rollService({...rollback,replace:image=>{
    active=image;
    if(image===previous)throw Error('unhealthy');
  }}),/unhealthy/);
  assert.equal(active,next);
  assert.equal(JSON.parse(readFileSync(args.journal)).previous,previous);
  rollService(rollback);
  assert.equal(active,previous);
});

test('interrupted changes resume before or after container replacement', t => {
  const dir=mkdtempSync(join(tmpdir(),'storeluma-rollout-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const previous='example/sales@sha256:'+'a'.repeat(64), next='example/sales@sha256:'+'b'.repeat(64);
  const journal=join(dir,'sales.json');
  // A legacy journal without a status can precede an unapplied deploy.
  writeFileSync(journal,JSON.stringify({previous,next}));
  const touched=[];
  rollService({action:'rollback-service',journal,current:()=>previous,check:()=>{},replace:image=>touched.push(image)});
  assert.deepEqual(touched,[previous]);
  for(const rollback of [false,true]){
    const target=rollback?previous:next, source=rollback?next:previous;
    for(const running of [source,target]){
      let active=running;
      const entry={previous,next,status:rollback?'rolling-back':'deploying'};
      const args={journal,candidate:next,action:rollback?'rollback-service':'roll-service',
        current:()=>active,check:()=>{},replace:image=>{active=image;}};
      writeFileSync(journal,JSON.stringify(entry));
      rollService(args);
      assert.equal(active,target);
      assert.equal(JSON.parse(readFileSync(journal)).status,rollback?'rolled-back':'healthy');
      writeFileSync(journal,JSON.stringify(entry));
      active=running;
      assert.throws(()=>rollService({...args,replace:image=>{active=image;if(image===target)throw Error('not ready');}}),/not ready/);
      assert.equal(active,source);
      rollService(args);
      assert.equal(active,target);
    }
  }
});
