import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
mkdirSync('output/tests',{recursive:true})
const dir=mkdtempSync(resolve('output/tests/studio-'))
await build({entryPoints:['src/period.ts','src/studio-api.ts'],outdir:dir,bundle:true,format:'esm',platform:'node'})
const {periodAtTimeMs,periodTimeMs,nextPeriod}=await import(pathToFileURL(join(dir,'period.js')))
const {readiness}=await import(pathToFileURL(join(dir,'studio-api.js')))
const {startService}=createRequire(import.meta.url)('../../desktop-build/service.cjs')
const token='studio-test-token-no-real-credential',source='qkltj:6004'

test('workbench freezes pre-draw plans, checks source revisions, and follows corrected or removed canonical results',async()=>{
 const service=await startService({root:resolve('desktop-build'),dataDir:join(dir,'service'),token,background:false})
 const call=async(path,body,method='POST')=>{const r=await fetch(service.origin+path,{method:body?method:'GET',headers:{'x-hashplay-app':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
 const overview=()=>call('/api/studio/overview?source='+source)
 try{
  let r=await overview();assert.equal(r.status,200);assert.equal(r.data.readiness.ready,false);assert.equal(r.data.methodology.next_probability,null)
  assert.equal((await call('/api/studio/overview?source=local:five')).status,400)
  const remaining=600000-Date.now()%600000;if(remaining<5000)await new Promise(r=>setTimeout(r,remaining+20))
  const latest=periodAtTimeMs(Date.now(),source),lastMs=periodTimeMs(latest,source)
  const insert=(expect,ms,nums)=>service.db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind(source,expect,'synthetic',...nums,ms)
  await service.db.batch(Array.from({length:140},(_,i)=>insert(periodAtTimeMs(lastMs-i*600000,source),lastMs-i*600000,[i%10,(i+3)%10,(i*7)%10,1,2])))
  r=await overview();assert.equal(r.data.readiness.ready,true);assert.equal(r.data.snapshot.records.length,140)
  const input={source,recipe:'balanced',count:150,expect:r.data.readiness.expect,revision:r.data.snapshot.revision}
  assert.equal((await call('/api/studio/plans',{...input,revision:'wrong'})).status,409)
  assert.equal((await call('/api/studio/plans',{...input,count:0})).status,400)
  const created=await call('/api/studio/plans',input);assert.equal(created.status,200,JSON.stringify(created));const id=created.data.id
  const repeated=await call('/api/studio/plans',input);assert.equal(repeated.data.id,id);assert.equal(repeated.data.existing,true)
  r=await overview();const plan=r.data.plans[0];assert.equal(plan.numbers.length,150);assert.equal(new Set(plan.numbers).size,150);assert.equal(plan.actual,null);assert.equal(plan.theoretical_coverage,.15);assert.equal(plan.next_probability,null)
  await assert.rejects(service.db.prepare('UPDATE studio_plans SET score_mass=1 WHERE id=?').bind(id).run(),/STUDIO_IMMUTABLE/)
  await assert.rejects(service.db.prepare('DELETE FROM studio_plans WHERE id=?').bind(id).run(),/STUDIO_IMMUTABLE/)
  assert.equal((await call('/api/studio/plans/'+id,{note:'复盘 <script>保留为纯文本</script>',pinned:true},'PATCH')).status,200)
  const hit=plan.numbers[0],miss=Array.from({length:1000},(_,i)=>String(i).padStart(3,'0')).find(n=>!plan.numbers.includes(n))
  await insert(plan.expect,periodTimeMs(plan.expect,source),[...hit].map(Number).concat([1,2])).run()
  r=await overview();assert.equal(r.data.plans[0].hit,true);assert.equal(r.data.history[0].hits,1);assert.equal(r.data.history[0].n,1);assert.ok(r.data.history[0].interval95);assert.equal(r.data.plans[0].pinned,true)
  await service.db.prepare('UPDATE draws SET n1=?,n2=?,n3=? WHERE source=? AND expect=?').bind(...[...miss].map(Number),source,plan.expect).run()
  r=await overview();assert.equal(r.data.plans[0].hit,false);assert.equal(r.data.history[0].hits,0)
  await service.db.prepare('DELETE FROM draws WHERE source=? AND expect=?').bind(source,plan.expect).run()
  r=await overview();assert.equal(r.data.plans[0].hit,null);assert.equal(r.data.history[0].n,0)
  assert.equal(r.data.plans[0].note,'复盘 <script>保留为纯文本</script>')
  const raw=await call('/api/studio/data?source='+source+'&period='+latest);assert.equal(raw.data.rows.length,1)
  assert.equal((await call('/api/studio/data?source='+source+'&limit=99999')).status,400)
  assert.equal((await call('/api/studio/data?source='+source+'&period=%27')).status,400)
  // Direct database writes are guarded against races and retroactive inserts.
  await assert.rejects(service.db.prepare("INSERT INTO studio_plans SELECT 'bad-revision',source,expect,'control',version,count,numbers,based_on,'wrong',input_count,created_ms,cutoff_ms,score_mass FROM studio_plans WHERE id=?").bind(id).run(),/STUDIO_REVISION/)
  await assert.rejects(service.db.prepare("INSERT INTO studio_plans SELECT 'late',source,expect,'control',version,count,numbers,based_on,input_revision,input_count,1,2,score_mass FROM studio_plans WHERE id=?").bind(id).run(),/STUDIO_CUTOFF/)
 }finally{await service.close()}
 // Real database restart preserves immutable numbers and separate annotations.
 const restarted=await startService({root:resolve('desktop-build'),dataDir:join(dir,'service'),token,background:false})
 try{assert.equal((await restarted.db.prepare('SELECT COUNT(*) n FROM studio_plans').first()).n,1);assert.equal((await restarted.db.prepare('SELECT pinned FROM studio_annotations').first()).pinned,1)}finally{await restarted.close()}
})

test('readiness rejects stale periods, future data, incomplete and invalid history',()=>{
 const now=Math.floor(Date.now()/600000)*600000+300000,last=periodAtTimeMs(now,source),lastMs=periodTimeMs(last,source)
 const s={source:{id:source},quality:{rejectedRows:0},records:Array.from({length:120},(_,i)=>({period:periodAtTimeMs(lastMs-(119-i)*600000,source),previousContiguous:true}))}
 assert.equal(readiness(s,now).ready,true)
 assert.equal(readiness({...s,records:s.records.slice(1)},now).ready,false)
 assert.equal(readiness({...s,quality:{rejectedRows:1}},now).ready,false)
 const gap=structuredClone(s);gap.records[100].previousContiguous=false;assert.equal(readiness(gap,now).ready,false)
 assert.equal(readiness(s,lastMs+600001).ready,false)
 assert.equal(readiness(s,lastMs-1).ready,false)
})

test('legacy replay is excluded, fixed sizes stay separate, and streaks break at missing periods',async()=>{
 const {LocalDatabase}=await import('../database.mjs'),{studioHistory}=await import(pathToFileURL(join(dir,'studio-api.js')))
 const db=new LocalDatabase(join(dir,'history.sqlite'),resolve('migrations')),s='qkltj:6002'
 const nums=Array.from({length:100},(_,i)=>String(i).padStart(3,'0')).join(' ')
 try{
  const plan=(seq,mode='live',version='audit-v1',count=100)=>db.prepare('INSERT INTO arena_rounds(source,expect,strategy,mode,based_on,numbers,count,coverage,created_ms,prediction_version,prediction_status,cutoff_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(s,'20990101'+String(seq).padStart(3,'0'),'quant',mode,'20990101'+String(seq-1).padStart(3,'0'),count===100?nums:nums+' 100',count,.1,Date.now(),version,mode==='replay'?'replay':version==='legacy-unverified'?'legacy':'live',Date.UTC(2099,0,1))
  const draw=seq=>db.prepare("INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,'synthetic',9,9,9,1,1,?)").bind(s,'20990101'+String(seq).padStart(3,'0'),Date.UTC(2099,0,1)+seq*180000)
  for(const seq of [2,3,5,6]){await plan(seq).run();await draw(seq).run()}
  await plan(7,'replay').run();await draw(7).run()
  await plan(8,'live','legacy-unverified').run();await draw(8).run()
  await plan(9,'live','audit-v1',101).run();await draw(9).run()
  let history=await studioHistory(db,s);assert.equal(history.length,2)
  const h=history.find(h=>h.count===100);assert.equal(h.n,4);assert.equal(h.hits,0);assert.equal(h.max_miss,2);assert.equal(h.next_probability,null)
  assert.equal(history.find(h=>h.count===101).n,1)
  await db.prepare('UPDATE draws SET n1=0,n2=0,n3=0 WHERE source=? AND expect=?').bind(s,'20990101002').run()
  history=await studioHistory(db,s);assert.equal(history.find(h=>h.count===100).hits,1)
 }finally{db.close()}
})
