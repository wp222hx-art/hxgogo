import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
mkdirSync('output/tests',{recursive:true});const dir=mkdtempSync(resolve('output/tests/source-scheduler-'));
await build({entryPoints:['src/source-scheduler.ts'],outfile:join(dir,'scheduler.mjs'),bundle:true,platform:'node',format:'esm'});
const {createSourceScheduler}=await import(pathToFileURL(join(dir,'scheduler.mjs')));
const flush=()=>new Promise(r=>setImmediate(r));
test('one slow source does not block other sources or create duplicate concurrent jobs',async()=>{
  let finish;const calls=[];const slow=new Promise(r=>finish=r);
  const scheduler=createSourceScheduler({sources:['slow','fast'],run:async s=>{calls.push(s);if(s==='slow')await slow;}});
  scheduler.tick();await flush();scheduler.tick();await flush();
  assert.deepEqual(calls,['slow','fast','fast']);assert.equal(scheduler.pending,1);
  finish();await scheduler.stop();scheduler.tick();assert.equal(scheduler.pending,0);
});
test('gap repair is fair per source and cannot hold the live synchronization lane',async()=>{
  let time=0,finish;const repairs=[],draws=[];const pending=new Promise(r=>finish=r);
  const scheduler=createSourceScheduler({sources:['a','b','c'],run:async s=>{draws.push(s)},sweepSources:['a','b'],sweepEveryMs:100,now:()=>time,sweep:async s=>{repairs.push(s);if(repairs.length===1)await pending;}});
  scheduler.tick();await flush();time=10;scheduler.tick();await flush();
  assert.equal(draws.length,6);assert.deepEqual(repairs,['a']);
  finish();await flush();scheduler.tick();await flush();assert.deepEqual(repairs,['a','b']);
  time=110;scheduler.tick();await flush();assert.deepEqual(repairs,['a','b','a']);await scheduler.stop();
});
test('failure releases its lane; stop waits for in-flight commits and never starts new jobs',async()=>{
  let n=0,finish;const errors=[];const p=new Promise(r=>finish=r);
  const scheduler=createSourceScheduler({sources:['a'],run:async()=>{if(++n===1)throw Error('offline');await p;},onError:e=>errors.push(e.message)});
  scheduler.tick();await flush();assert.deepEqual(errors,['offline']);scheduler.tick();await flush();
  let stopped=false;const stop=scheduler.stop().then(()=>stopped=true);await flush();assert.equal(stopped,false);scheduler.tick();assert.equal(n,2);finish();await stop;
});

test('very slow repair cannot starve sources that have never been scanned',async()=>{
  let time=0;const repairs=[];
  const scheduler=createSourceScheduler({sources:['a','b','c'],run:async()=>{},sweepEveryMs:100,now:()=>time,sweep:async s=>{repairs.push(s);time+=200;}});
  for(let i=0;i<6;i++){scheduler.tick();await flush();}
  assert.deepEqual(repairs,['a','b','c','a','b','c']);await scheduler.stop();
});
