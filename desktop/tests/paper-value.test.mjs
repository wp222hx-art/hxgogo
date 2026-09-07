import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {mkdirSync,mkdtempSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
mkdirSync('output/tests',{recursive:true});const dir=mkdtempSync(resolve('output/tests/paper-value-'))
await build({entryPoints:['src/paper-value.ts','src/arena.ts','src/period.ts'],outdir:dir,bundle:true,format:'esm',platform:'node',logLevel:'silent'})
const {ledgerValue,valueStats}=await import(pathToFileURL(join(dir,'paper-value.js')))
const {insertRounds}=await import(pathToFileURL(join(dir,'arena.js')))
const {periodAtTimeMs,periodTimeMs,nextPeriod}=await import(pathToFileURL(join(dir,'period.js')))
const source='qkltj:6004'
test('settled profit, pending cash, reference value and same-period flat comparison stay separate',()=>{
 const r=ledgerValue([
 {expect:'20990101001',hit:false,unit_cents:100,stake_cents:10000,branch:'base',level:0},
 {expect:'20990101002',hit:true,unit_cents:200,stake_cents:20000,branch:'loss',level:1},
 {expect:'20990101003',hit:null,unit_cents:400,stake_cents:40000,branch:'win',level:2}
 ],source,100,1,950,10000)
 assert.deepEqual(r.rows.map(r=>r.value_points),[-100,850,null])
 assert.equal(r.financial.realized_profit_cents,160000);assert.equal(r.financial.pending_stake_cents,40000)
 assert.equal(r.financial.flat_profit_cents,75000);assert.equal(r.financial.extra_profit_cents,85000)
 assert.equal(r.financial.payout_cents,190000);assert.equal(r.financial.roi,160000/30000)
 assert.equal(r.rows[2].extra_profit_cents,null);assert.equal(r.rows[2].balance_cents,1120000)
 assert.equal(r.financial.branches.loss.profit_cents,170000)
})
test('research streaks do not bridge gaps or pending observations',()=>{
 const rows=[{expect:'20990101001',hit:false},{expect:'20990101002',hit:false},{expect:'20990101004',hit:false}]
 let s=valueStats(rows,source,100);assert.equal(s.current_miss,1);assert.equal(s.longest_miss,2);assert.equal(s.value_points,-300)
 s=valueStats([...rows,{expect:'20990101005',hit:null}],source,100);assert.equal(s.current_miss,0);assert.equal(s.periods,3)
})
test('AI original tier and 500 prefixes share immutable research plans without substituting numbers',async()=>{
 const {startService}=createRequire(import.meta.url)('../../desktop-build/service.cjs'),token='paper-value-test-01234567890123456789'
 const service=await startService({root:resolve('desktop-build'),dataDir:join(dir,'service'),token,background:false,secrets:{async load(){return{}},async save(){}}})
 const call=async(path,body)=>{const r=await fetch(service.origin+'/api/paper'+path,{method:body?'POST':'GET',headers:{'x-hashplay-app':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
 try{
  const last=periodTimeMs(periodAtTimeMs(Date.now(),source),source),expect=nextPeriod(periodAtTimeMs(last,source),source)
  await service.db.batch(Array.from({length:125},(_,i)=>service.db.prepare("INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,'test',1,2,3,4,5,?)").bind(source,periodAtTimeMs(last-i*600000,source),last-i*600000)))
  const main=Array.from({length:500},(_,i)=>i),own=Array.from({length:100},(_,i)=>500+i)
  await insertRounds(service.db,source,expect,periodAtTimeMs(last,source),'live',[{strategy:'ai',numbers:main,coverage:.5,weight:1},{strategy:'ai-100',numbers:own,coverage:.1,weight:1}])
  const catalog=(await call('/catalog?source='+source)).data
  const original=catalog.strategies.find(s=>s.strategy==='ai-100'),prefix=catalog.strategies.find(s=>s.strategy==='ai'&&s.count===100)
  assert.equal(original.base_count,100);assert.equal(prefix.base_count,500)
  const query=r=>'/selection?'+new URLSearchParams({source,origin:r.origin,strategy:r.strategy,version:r.version,count:r.count,base_count:r.base_count})
  const a=(await call(query(original))).data,b=(await call(query(prefix))).data
  assert.deepEqual(a.current.numbers,own.map(n=>String(n).padStart(3,'0')))
  assert.deepEqual(b.current.numbers,main.slice(0,100).map(n=>String(n).padStart(3,'0')))
  const created=await call('/bots',{source,ref:original,config:{},name:'AI exact selection'})
  assert.equal(created.status,200,JSON.stringify(created))
  const bot=(await call('/bots?source='+source)).data.bots[0]
  assert.equal(bot.base_count,100);assert.deepEqual(bot.rows[0].numbers,a.current.numbers)
  assert.equal(bot.financial.realized_profit_cents,0);assert.equal(bot.financial.pending_stake_cents,2000)
  await assert.rejects(service.db.prepare('UPDATE paper_bots SET base_count=500 WHERE id=?').bind(bot.id).run(),/IMMUTABLE/)
  const none=(await call(query({...original,base_count:500}))).data;assert.equal(none.current,null)
  assert.equal((await call('/bots',{source,ref:{...original,base_count:500},config:{},name:'invalid basis'})).status,400)
  const realNow=Date.now
  try{
   const cutoff=periodTimeMs(expect,source);Date.now=()=>cutoff+1
   await service.db.prepare("INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,'test-result',5,0,0,4,5,?)").bind(source,expect,cutoff).run()
   const view=(await call('/bots?source='+source)).data.bots[0]
   assert.equal(view.research.stats.hits,1);assert.equal(view.research.stats.value_points,850)
   assert.equal(view.financial.realized_profit_cents,17000);assert.equal(view.financial.pending_stake_cents,0)
   const front=(await call(query(prefix))).data;assert.equal(front.research.stats.hits,0);assert.equal(front.research.stats.value_points,-100)
  }finally{Date.now=realNow}
 }finally{await service.close()}
})
