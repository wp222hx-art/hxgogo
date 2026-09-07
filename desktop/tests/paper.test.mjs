import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync,mkdirSync } from 'node:fs'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
mkdirSync('output/tests',{recursive:true});const dir=mkdtempSync(resolve('output/tests/paper-'))
await build({entryPoints:['src/paper-engine.ts','src/paper-api.ts','src/period.ts'],outdir:dir,bundle:true,format:'esm',platform:'node'})
const {DEFAULT_PAPER,simulate,paperConfig,sequenceStudy}=await import(pathToFileURL(join(dir,'paper-engine.js')))
const {paperTick}=await import(pathToFileURL(join(dir,'paper-api.js')))
const {periodAtTimeMs,periodTimeMs}=await import(pathToFileURL(join(dir,'period.js')))
const source='qkltj:6004',config={...DEFAULT_PAPER,capital:100000,unit:1,stopLoss:90000,takeProfit:90000,maxStake:50000,maxLevel:10,trigger:1,maxRounds:100}
const rows=hits=>hits.map((hit,i)=>({expect:'20990101'+String(i+1).padStart(3,'0'),hit}))
test('win progression resets after a miss; loss progression resets after a hit',()=>{
 let r=simulate(rows([true,true,false,true]),source,100,{...config,mode:'win'})
 assert.deepEqual(r.rows.map(r=>r.level),[0,1,2,0]);assert.deepEqual(r.rows.map(r=>r.stake_cents),[10000,20000,40000,10000])
 r=simulate(rows([false,false,true,false]),source,100,{...config,mode:'loss'})
 assert.deepEqual(r.rows.map(r=>r.level),[0,1,2,0]);assert.equal(r.rows[2].profit_cents,340000)
})
test('winning a doubled round need not recover the whole loss sequence at the assumed return',()=>{
 const r=simulate(rows([false,false,false,false,false,true]),source,500,{...config,mode:'loss'})
 assert.equal(r.rows[5].level,5);assert.equal(r.rows[5].hit,true);assert.equal(r.summary.profit_cents,-110000);assert.equal(r.rows[5].cycle_profit_cents,-110000)
})
test('finite budget, stop-loss exposure, stage caps and gaps prevent unlimited escalation',()=>{
 let r=simulate(rows([false,false,false,true]),source,100,{...config,mode:'loss',maxLevel:1})
 assert.equal(r.summary.rounds,2);assert.match(r.summary.stop_reason,/级数/)
 r=simulate(rows([false,false,true]),source,100,{...config,mode:'loss',capital:250})
 assert.equal(r.summary.rounds,1);assert.match(r.summary.stop_reason,/余额/)
 r=simulate(rows([false,false,true]),source,100,{...config,mode:'loss',stopLoss:250})
 assert.equal(r.summary.rounds,1);assert.match(r.summary.stop_reason,/止损/)
 const gap=[{expect:'20990101001',hit:false},{expect:'20990101003',hit:false},{expect:'20990101004',hit:true}]
 assert.deepEqual(simulate(gap,source,100,{...config,mode:'loss'}).rows.map(r=>r.level),[0,0,1])
})
test('prefix decisions cannot change when later outcomes change and validation rejects invalid money',()=>{
 const a=simulate(rows([false,true,true,false]),source,150,{...config,mode:'both'})
 const b=simulate(rows([false,true,false,true]),source,150,{...config,mode:'both'})
 assert.deepEqual(a.rows.slice(0,2),b.rows.slice(0,2));assert.equal(a.rows[2].stake_cents,b.rows[2].stake_cents)
 for(const bad of [{unit:-1},{capital:Infinity},{unit:.001},{maxLevel:100},{mode:'guaranteed'}])assert.throws(()=>paperConfig({...config,...bad}))
 const s=sequenceStudy(rows([true,true,false,false,true]),source,150,2)
 assert.equal(s.next_probability,null);assert.equal(s.conditions.find(r=>r.kind==='win').n,1);assert.equal(s.conditions.find(r=>r.kind==='win').hits,0);assert.equal(s.conditions.find(r=>r.kind==='loss').hits,1)
})
test('robot locks one future paper order, preserves it, reconciles corrections and supports pause/resume/stop',async()=>{
 const {startService}=createRequire(import.meta.url)('../../desktop-build/service.cjs'),token='paper-test-token-01234567890123456789'
 const service=await startService({root:resolve('desktop-build'),dataDir:join(dir,'service'),token,background:false,secrets:{async load(){return{}},async save(){}}})
 const call=async(path,body)=>{const r=await fetch(service.origin+'/api/paper'+path,{method:body?'POST':'GET',headers:{'x-hashplay-app':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
 try{
  const remaining=600000-Date.now()%600000;if(remaining<5000)await new Promise(r=>setTimeout(r,remaining+10))
  const last=periodTimeMs(periodAtTimeMs(Date.now(),source),source)
  const insert=(expect,ms,ns)=>service.db.prepare("INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,'synthetic',?,?,?,?,?,?)").bind(source,expect,...ns,ms)
  await service.db.batch(Array.from({length:150},(_,i)=>insert(periodAtTimeMs(last-i*600000,source),last-i*600000,[i%10,(i+2)%10,(i*7)%10,1,2])))
  // A correction between the balance read and plan snapshot must abort this tick.
  await service.db.prepare("INSERT INTO paper_bots(id,name,source,origin,strategy,version,count,config_json,created_ms,status) VALUES('race','race',?,'studio','balanced','studio-v1',150,?,?,'running')").bind(source,JSON.stringify(DEFAULT_PAPER),Date.now()).run()
  let correctedDuringRead=false
  const racingDB={batch:service.db.batch.bind(service.db),prepare(sql){
   const statement=service.db.prepare(sql)
   if(!sql.includes('FROM paper_orders o'))return statement
   return{bind(...args){const bound=statement.bind(...args);return{async all(){const result=await bound.all();if(!correctedDuringRead){correctedDuringRead=true;await service.db.prepare("UPDATE draws SET hash='corrected-during-read' WHERE source=? AND expect=?").bind(source,periodAtTimeMs(last,source)).run()}return result}}}}
  }}
  await paperTick(racingDB,source)
  assert.equal(correctedDuringRead,true)
  assert.equal((await service.db.prepare("SELECT COUNT(*) n FROM paper_orders WHERE bot_id='race'").first()).n,0)
  assert.equal((await call('/bots/race/control',{action:'stop'})).status,200)
  const ref={origin:'studio',strategy:'balanced',version:'studio-v1',count:150}
  let r=await call('/bots',{source,ref,config:{...DEFAULT_PAPER},name:'测试模拟机器人'});assert.equal(r.status,200,JSON.stringify(r));const id=r.data.id
  r=await call('/bots?source='+source);let bot=r.data.bots[0];assert.equal(bot.status,'running',JSON.stringify(bot));assert.equal(bot.rows.length,1,JSON.stringify(bot.events));const order=bot.rows[0]
  assert.equal(order.stake_cents,3000);assert.equal(bot.summary.pending,1)
  await Promise.all([paperTick(service.db,source),paperTick(service.db,source)])
  assert.equal((await service.db.prepare('SELECT COUNT(*) n FROM paper_orders').first()).n,1)
  await assert.rejects(service.db.prepare('UPDATE paper_orders SET unit_cents=1').run(),/IMMUTABLE/)
  const hit=order.numbers[0],miss=Array.from({length:1000},(_,i)=>String(i).padStart(3,'0')).find(n=>!order.numbers.includes(n))
  await insert(order.expect,order.cutoff_ms,[...hit].map(Number).concat([1,2])).run();await paperTick(service.db,source)
  r=await call('/bots?source='+source);bot=r.data.bots[0];assert.equal(bot.summary.hits,1);assert.equal(bot.summary.balance_cents,1016000)
  await service.db.prepare('UPDATE draws SET n1=?,n2=?,n3=? WHERE source=? AND expect=?').bind(...[...miss].map(Number),source,order.expect).run();await paperTick(service.db,source)
  bot=(await call('/bots?source='+source)).data.bots[0];assert.equal(bot.status,'paused');assert.equal(bot.summary.hits,0);assert.equal(bot.summary.balance_cents,997000);assert.deepEqual(bot.rows[0].numbers,order.numbers)
  assert.equal((await call('/bots/'+id+'/control',{action:'resume'})).status,200);assert.equal((await call('/bots?source='+source)).data.bots[0].status,'running')
  assert.equal((await call('/bots/'+id+'/control',{action:'pause'})).status,200)
  assert.equal((await call('/bots/'+id+'/control',{action:'stop'})).status,200)
  assert.equal((await call('/bots/'+id+'/control',{action:'resume'})).status,409)
  assert.equal((await call('/bots/'+id+'/export')).data.bot.rows.length,1)
  const replay=await call('/replay',{source,ref,config:DEFAULT_PAPER,limit:20});assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.kind,'walk_forward_recipe_replay');assert.equal(replay.data.study.next_probability,null)
  assert.equal((await call('/bots',{source,ref,config:{...DEFAULT_PAPER,unit:99999},name:'invalid'})).status,400)
 }finally{await service.close()}
})
