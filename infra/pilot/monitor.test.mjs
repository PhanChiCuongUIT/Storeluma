import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deliver} from './monitor.mjs';

test('a receiver sees an alert and recovery once; rejected delivery is retried',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'storeluma-alert-')),state=join(dir,'state.json'),messages=[];
  const send=async message=>messages.push(message);
  try{
    const issues=['finance/outbox-delay'];
    await assert.rejects(deliver(issues,state,async()=>{throw Error('offline');}),/offline/);
    assert.equal(await deliver(issues,state,send),true);
    assert.equal(await deliver(issues,state,send),false);
    assert.equal(await deliver([],state,send),true);
    assert.deepEqual(messages.map(m=>m.status),['alert','recovered']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
