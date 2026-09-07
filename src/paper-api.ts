import { Hono } from 'hono'
import { builtinSnapshot } from './atlas-api'
import { SOURCES } from './sync'
import { RECIPES,STUDIO_VERSION,readiness,createPlan,studioHistory } from './studio-api'
import { pick } from './picker'
import { verifiedLiveSql } from './arena'
import { nextPeriod,periodTimeMs } from './period'
import { extractFive } from './engine5'
import { DEFAULT_PAPER,paperConfig,simulate,sequenceStudy,nextSizing,stakeGate,cents,type Observation } from './paper-engine'

type Ref={origin:'studio'|'arena';strategy:string;version:string;count:number}
class PaperError extends Error{constructor(public status:number,message:string){super(message)}}
const fail=(status:number,message:string):never=>{throw new PaperError(status,message)}
const src=(s:any)=>{if(typeof s!=='string'||!s.startsWith('qkltj:')||!Object.hasOwn(SOURCES,s))return fail(400,'请选择一个在线数据来源');return s}
const ref=(r:any):Ref=>{if(!r||!['studio','arena'].includes(r.origin)||!['strategy','version'].every(k=>typeof r[k]==='string'&&/^[a-zA-Z0-9._:-]{1,80}$/.test(r[k]))||!Number.isInteger(r.count)||r.count<1||r.count>1000)fail(400,'策略配置无效');if(r.origin==='studio'&&(!RECIPES.some(s=>s.id===r.strategy)||r.version!==STUDIO_VERSION||![100,150,300,500].includes(r.count)))fail(400,'工作台配方无效');return{origin:r.origin,strategy:r.strategy,version:r.version,count:r.count}}
async function jsonBody(c:any){const reader=c.req.raw.body?.getReader();if(!reader)fail(400,'请填写模拟参数');let size=0,text='';const d=new TextDecoder();try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16384){await reader.cancel();fail(413,'参数内容过大')}text+=d.decode(r.value,{stream:true})}text+=d.decode()}finally{reader.releaseLock()}try{return JSON.parse(text)}catch{return fail(400,'JSON 格式错误')}}
const validActual=[1,2,3,4,5].map(n=>'d.n'+n+' BETWEEN 0 AND 9 AND typeof(d.n'+n+")='integer'").join(' AND ')
const actualSql="CASE WHEN "+validActual+" THEN CAST(d.n1 AS TEXT)||CAST(d.n2 AS TEXT)||CAST(d.n3 AS TEXT) END"
function decodeNumbers(s:string,origin:string,count:number){let a:any;try{a=origin==='studio'?JSON.parse(s):s.split(' ')}catch{return null}return Array.isArray(a)&&a.length===count&&new Set(a).size===count&&a.every(n=>typeof n==='string'&&/^\d{3}$/.test(n))?a as string[]:null}
export async function recordedRows(db:D1Database,source:string,r:Ref,limit=1000){
 const studio=r.origin==='studio',table=studio?'studio_plans':'arena_rounds',strategy=studio?'recipe':'strategy',version=studio?'version':'prediction_version'
 const rows=(await db.prepare(`SELECT p.expect,p.numbers,p.created_ms,p.cutoff_ms,${actualSql} actual FROM ${table} p
 LEFT JOIN draws d ON d.source=p.source AND d.expect=p.expect WHERE p.source=? AND p.${strategy}=? AND p.${version}=? AND p.count=? AND p.cutoff_ms<=?
 ${studio?'':'AND '+verifiedLiveSql('p',true)} ORDER BY p.expect DESC LIMIT ?`).bind(source,r.strategy,r.version,r.count,Date.now(),limit).all<any>()).results.reverse()
 return rows.map(p=>{const numbers=decodeNumbers(p.numbers,r.origin,r.count);return {...p,numbers,hit:numbers&&p.actual!=null?numbers.includes(p.actual):null}})
}
async function hashStudy(db:D1Database,source:string){
 const rows=(await db.prepare('SELECT expect,hash,n1,n2,n3,n4,n5 FROM draws WHERE source=? ORDER BY expect DESC LIMIT 1000').bind(source).all<any>()).results
 let valid=0,duplicates=0,mismatch=0,missing=0;const seen=new Set(),freq=Array.from({length:3},()=>Array(10).fill(0))
 for(const r of rows){const ns=[r.n1,r.n2,r.n3,r.n4,r.n5];if(ns.some(n=>!Number.isInteger(n)||n<0||n>9))continue;valid++;for(let i=0;i<3;i++)freq[i][ns[i]]++
 const h=String(r.hash||'').replace(/^0x/,'').toLowerCase();if(!/^[0-9a-f]{64}$/.test(h)){missing++;continue}if(seen.has(h))duplicates++;seen.add(h);const extracted=extractFive(h);if(!extracted||extracted.some((n,i)=>n!==ns[i]))mismatch++}
 return{sample:rows.length,valid,duplicates,invalid_hashes:missing,number_hash_mismatches:mismatch,frequencies:freq,chi_square:freq.map(a=>valid?a.reduce((s,n)=>s+(n-valid/10)**2/(valid/10),0):null),note:'仅检查字段完整性、重复和当前取号规则的一致性。没有验证链上最终性，也没有证明上游公平或发现可预测性；区块哈希中的结构化字段不按随机比特测试。'}
}
async function replayRows(db:D1Database,source:string,r:Ref,limit:number){
 if(r.origin==='arena')return {rows:await recordedRows(db,source,r,limit),kind:'recorded_pre_draw_plans'}
 const s=await builtinSnapshot(db,source,Math.min(3000,limit+1000)),records=s.records,all:any[]=[],rows:Observation[]=[]
 for(let i=0;i<records.length;i++){
  if(i%5===0)await new Promise(resolve=>setTimeout(resolve,0))
  const v=records[i],draw={source,expect:v.period,hash:'',block:null,n1:v.numbers[0],n2:v.numbers[1],n3:v.numbers[2],n4:v.numbers[3],n5:v.numbers[4],open_ms:v.drawAt}
  if(i>=Math.max(120,records.length-limit)){
   const tail=records.slice(i-120,i+1),continuous=tail.slice(1).every(x=>x.previousContiguous)
   if(!continuous){rows.push({expect:v.period,hit:null});all.push(draw);continue}
   const actual=v.numbers.slice(0,3).join(''),hist=all.slice(-1000).reverse()
   const nums=recipeNumbers(hist,source,v.period,r.strategy,r.count)
   rows.push({expect:v.period,actual,hit:nums.includes(actual),numbers:nums,cutoff_ms:periodTimeMs(v.period,source)!})
  }
  all.push(draw)
 }
 return {rows,kind:'walk_forward_recipe_replay'}
}
export function recipeNumbers(draws:any[],source:string,expect:string,recipe:string,count:number){
 const def=RECIPES.find(r=>r.id===recipe)!
 if(def.temp!==null)return pick(draws,{source,count,temp:def.temp,steps:60,btSteps:0,wParity:.6,wSize:.4,wCombo:.35}).numbers.map(n=>n.no)
 let x=2166136261;for(const ch of source+expect+STUDIO_VERSION)x=Math.imul(x^ch.charCodeAt(0),16777619)>>>0
 const a=Array.from({length:1000},(_,i)=>String(i).padStart(3,'0'))
 for(let i=999;i>0;i--){x=(Math.imul(1664525,x)+1013904223)>>>0;const j=Math.floor(x/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,count)
}
export async function botView(db:D1Database,id:string){
 const b=await db.prepare("SELECT b.*,b.source||':'||COALESCE((SELECT revision FROM atlas_source_revisions WHERE source_id=b.source),0) data_revision FROM paper_bots b WHERE id=?").bind(id).first<any>();if(!b)return fail(404,'模拟机器人不存在')
 const config=paperConfig(JSON.parse(b.config_json))
 const raw=(await db.prepare(`SELECT o.*,s.actual previous_actual,s.payout_cents previous_payout,s.settled_ms,${actualSql} actual FROM paper_orders o
 JOIN paper_bots b ON b.id=o.bot_id LEFT JOIN draws d ON d.source=b.source AND d.expect=o.expect LEFT JOIN paper_settlements s ON s.order_id=o.id WHERE o.bot_id=? ORDER BY o.sequence`).bind(id).all<any>()).results
 let balance=cents(config.capital),peak=balance,maxDrawdown=0,staked=0,settled=0,hits=0,pending=0;const rows=raw.map(o=>{
  const numbers=JSON.parse(o.numbers),hit=o.actual==null?null:numbers.includes(o.actual),payout=hit===null?null:hit?o.unit_cents*config.odds:0
  balance-=o.stake_cents;staked+=o.stake_cents;if(payout!==null){balance+=payout;settled++;hits+=Number(hit)}else pending++
  peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance)
  return {...o,numbers,hit,payout_cents:payout,profit_cents:payout==null?null:payout-o.stake_cents,balance_cents:balance}
 })
 const recent=rows.filter(o=>o.created_ms>=b.reset_ms).map(o=>({expect:o.expect,hit:o.hit}))
 const sizing=nextSizing(recent,b.source,config),reason=stakeGate(config,b.count,balance,rows.length,sizing)
 const events=(await db.prepare('SELECT kind,message,created_ms FROM paper_events WHERE bot_id=? ORDER BY id DESC LIMIT 20').bind(id).all()).results
 return {...b,config,config_json:undefined,rows,events,summary:{rounds:rows.length,settled,hits,pending,balance_cents:balance,profit_cents:balance-cents(config.capital),staked_cents:staked,max_drawdown_cents:maxDrawdown,hit_rate:settled?hits/settled:null},next:{...sizing,stake_cents:sizing.unit_cents*b.count,allowed:b.status==='running'&&!pending&&!reason,reason:b.status!=='running'?b.reason:pending?'等待已投入期次的结果':reason||b.reason}}
}
async function event(db:D1Database,id:string,kind:string,message:string){await db.prepare('INSERT INTO paper_events(bot_id,kind,message,created_ms) VALUES(?,?,?,?)').bind(id,kind,message,Date.now()).run()}
async function control(db:D1Database,id:string,status:string,reason:string,reset=false){
 await db.prepare('UPDATE paper_bots SET status=?,reason=?,control_revision=control_revision+1,reset_ms=CASE WHEN ? THEN ? ELSE reset_ms END WHERE id=?').bind(status,reason,Number(reset),Date.now(),id).run()
 await event(db,id,status,reason)
}
async function tickOne(db:D1Database,id:string){
 let b=await botView(db,id);if(b.status!=='running')return
 let corrected=false;const stmts=[]
 for(const o of b.rows){
  if(o.settled_ms&&o.previous_actual!==o.actual){corrected=true}
  if(o.actual!=null||o.settled_ms)stmts.push(db.prepare('INSERT INTO paper_settlements VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET actual=excluded.actual,payout_cents=excluded.payout_cents,settled_ms=excluded.settled_ms WHERE actual IS NOT excluded.actual OR payout_cents IS NOT excluded.payout_cents').bind(o.id,o.actual,o.payout_cents,Date.now()))
 }
 if(stmts.length)await db.batch(stmts)
 await db.prepare('UPDATE paper_bots SET last_tick_ms=? WHERE id=?').bind(Date.now(),id).run()
 if(corrected){await control(db,id,'paused','开奖记录发生更正或删除，已重新核算余额；请复核后恢复，恢复从基础金额开始。');return}
 if(b.summary.pending)return
 const s=await builtinSnapshot(db,b.source,1000),g=readiness(s)
 if(s.revision!==b.data_revision)return
 if(!g.ready){await db.prepare("UPDATE paper_bots SET reason=? WHERE id=? AND status='running' AND reason IS NOT ?").bind(g.reason,id,g.reason).run();return}
 if(b.rows.some(o=>o.expect===g.expect))return
 let observations=b.rows.filter(o=>o.created_ms>=b.reset_ms)
 if(observations.length&&nextPeriod(observations.at(-1)!.expect,b.source)!==g.expect)observations=[]
 const sizing=nextSizing(observations,b.source,b.config),reason=stakeGate(b.config,b.count,b.summary.balance_cents,b.rows.length,sizing)
 if(reason){await control(db,id,'stopped',reason);return}
 let numbers:string[]|null=null
 if(b.origin==='studio'){
  try{await createPlan(db,{source:b.source,recipe:b.strategy,count:b.count,expect:g.expect,revision:s.revision})}catch(e){if(e.status===409)return;throw e}
  const plan=await db.prepare('SELECT numbers FROM studio_plans WHERE source=? AND expect=? AND recipe=? AND version=? AND count=?').bind(b.source,g.expect,b.strategy,b.version,b.count).first<any>()
  if(plan)numbers=decodeNumbers(plan.numbers,'studio',b.count)
 }else{
  const plan=await db.prepare(`SELECT numbers FROM arena_rounds WHERE source=? AND expect=? AND strategy=? AND prediction_version=? AND count=? AND ${verifiedLiveSql('',true)}`).bind(b.source,g.expect,b.strategy,b.version,b.count).first<any>()
  if(plan)numbers=decodeNumbers(plan.numbers,'arena',b.count)
 }
 if(!numbers){await db.prepare("UPDATE paper_bots SET reason='等待原策略的下一份有效方案' WHERE id=? AND status='running'").bind(id).run();return}
 try{await db.prepare('INSERT INTO paper_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,b.rows.length+1,g.expect,JSON.stringify(numbers),sizing.unit_cents,sizing.unit_cents*b.count,sizing.level,sizing.branch,g.cutoff_ms,Date.now(),s.revision,b.control_revision).run()}
 catch(e:any){if(/PAPER_|UNIQUE/.test(e.message))return;throw e}
 await db.prepare("UPDATE paper_bots SET reason='' WHERE id=? AND status='running'").bind(id).run()
}
const lanes=new WeakMap<object,Map<string,Promise<void>>>()
export function paperTick(db:D1Database,source:string):Promise<void>{
 let jobs=lanes.get(db);if(!jobs){jobs=new Map();lanes.set(db,jobs)}if(jobs.has(source))return jobs.get(source)!
 const job=(async()=>{const ids=(await db.prepare("SELECT id FROM paper_bots WHERE source=? AND status='running' ORDER BY created_ms LIMIT 10").bind(source).all<any>()).results
 for(const b of ids)try{await tickOne(db,b.id)}catch(e:any){await control(db,b.id,'paused','模拟处理异常，已暂停；请检查数据后恢复。');console.error('paper robot',e.message)}})().finally(()=>jobs!.delete(source))
 jobs.set(source,job);return job
}
export const paperApi=new Hono<{Bindings:{DB:D1Database}}>()
paperApi.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
paperApi.onError((e,c)=>c.json({ok:false,error:e instanceof PaperError?e.message:'模拟分析失败，请检查参数或稍后重试'},(e instanceof PaperError?e.status:500)as any))
paperApi.get('/catalog',async c=>{
 const source=src(c.req.query('source')||'qkltj:6001'),history=await studioHistory(c.env.DB,source)
 const strategies=RECIPES.flatMap(r=>[100,150,300,500].map(count=>({origin:'studio',strategy:r.id,version:STUDIO_VERSION,count,name:r.name+' · '+count+' 个',history:history.find(h=>h.origin==='studio'&&h.strategy===r.id&&h.count===count)})))
 strategies.push(...history.filter(h=>h.origin==='arena').map(h=>({origin:'arena',strategy:h.strategy,version:h.version,count:h.count,name:h.name+' · '+h.count+' 个',history:h})))
 return c.json({ok:true,strategies,defaults:DEFAULT_PAPER,hash:await hashStudy(c.env.DB,source),snapshot:await builtinSnapshot(c.env.DB,source,120)})
})
paperApi.post('/replay',async c=>{
 const b=await jsonBody(c),source=src(b.source),r=ref(b.ref);let config;try{config=paperConfig(b.config)}catch(e){return fail(400,e.message)}
 const limit=b.limit??120;if(!Number.isInteger(limit)||limit<20||limit>300)fail(400,'历史模拟范围为 20–300 期')
 const input=await replayRows(c.env.DB,source,r,limit)
 const main=simulate(input.rows,source,r.count,config),flat=simulate(input.rows,source,r.count,{...config,mode:'flat'})
 return c.json({ok:true,contractVersion:'paper.v1',source,ref:r,kind:input.kind,input_periods:input.rows.length,valid_periods:input.rows.filter(r=>r.hit!=null).length,simulation:main,flat,study:sequenceStudy(input.rows,source,r.count,config.trigger),generated_ms:Date.now(),note:'历史模拟是选择参数后的重放；后段评分使用此前数据，不等同于从未看过的独立测试或未来盈利证据。'})
})
paperApi.get('/bots',async c=>{
 const source=src(c.req.query('source')||'qkltj:6001'),ids=(await c.env.DB.prepare('SELECT id FROM paper_bots WHERE source=? ORDER BY created_ms DESC LIMIT 30').bind(source).all<any>()).results
 const bots=[];for(const r of ids){const b=await botView(c.env.DB,r.id);bots.push({...b,rows:b.rows.slice(-100)})}return c.json({ok:true,bots})
})
paperApi.post('/bots',async c=>{
 const b=await jsonBody(c),source=src(b.source),r=ref(b.ref);let config;try{config=paperConfig(b.config)}catch(e){return fail(400,e.message)}
 if(typeof b.name!=='string'||!b.name.trim()||b.name.length>60)fail(400,'请输入 1–60 字的机器人名称')
 if(cents(config.unit)*r.count>Math.min(cents(config.capital),cents(config.maxStake),cents(config.stopLoss)))fail(400,'基础总额已超过本金、单期上限或止损额度')
 if(r.origin==='arena'&&!await c.env.DB.prepare(`SELECT 1 FROM arena_rounds WHERE source=? AND strategy=? AND prediction_version=? AND count=? AND ${verifiedLiveSql('',true)} LIMIT 1`).bind(source,r.strategy,r.version,r.count).first())fail(400,'未找到可验证的原策略记录')
 const id=crypto.randomUUID(),result=await c.env.DB.prepare("INSERT INTO paper_bots(id,name,source,origin,strategy,version,count,config_json,created_ms,status,reason) SELECT ?,?,?,?,?,?,?,?,?,'running','等待下一份有效方案' WHERE (SELECT COUNT(*) FROM paper_bots WHERE status<>'stopped')<10").bind(id,b.name.trim(),source,r.origin,r.strategy,r.version,r.count,JSON.stringify(config),Date.now()).run()
 if(!result.meta.changes)fail(409,'最多同时保留 10 个运行或暂停的机器人，请先停止不再使用的机器人')
 await event(c.env.DB,id,'created','仅使用模拟资金；从创建后的有效方案开始，不补写过去的投入。')
 await paperTick(c.env.DB,source);return c.json({ok:true,id})
})
paperApi.post('/bots/:id/control',async c=>{
 const b=await jsonBody(c),id=c.req.param('id'),bot=await botView(c.env.DB,id)
 if(!['pause','resume','stop'].includes(b.action))fail(400,'请选择暂停、恢复或停止')
 if(bot.status==='stopped')fail(409,'已结束的机器人不可恢复，请另建一轮模拟')
 if(b.action==='resume'&&bot.summary.pending)fail(409,'仍有投入缺少结果，请先恢复完整开奖数据')
 if(b.action==='resume'){const writes=bot.rows.filter(o=>o.actual!=null||o.settled_ms).map(o=>c.env.DB.prepare('INSERT INTO paper_settlements VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET actual=excluded.actual,payout_cents=excluded.payout_cents,settled_ms=excluded.settled_ms').bind(o.id,o.actual,o.payout_cents,Date.now()));if(writes.length)await c.env.DB.batch(writes)}
 await control(c.env.DB,id,b.action==='pause'?'paused':b.action==='stop'?'stopped':'running',b.action==='resume'?'手动恢复，下一次从基础金额开始':b.action==='pause'?'用户暂停':'用户结束',b.action==='resume')
 if(b.action==='resume')await paperTick(c.env.DB,bot.source);return c.json({ok:true})
})
paperApi.get('/bots/:id/export',async c=>c.json({ok:true,contractVersion:'paper.v1',exported_ms:Date.now(),bot:await botView(c.env.DB,c.req.param('id'))}))
paperApi.get('/study',async c=>{
 const source=src(c.req.query('source')),r=ref({origin:c.req.query('origin'),strategy:c.req.query('strategy'),version:c.req.query('version'),count:Number(c.req.query('count'))})
 const trigger=Number(c.req.query('trigger')||2);if(!Number.isInteger(trigger)||trigger<1||trigger>8)fail(400,'触发次数范围为 1–8')
 return c.json({ok:true,study:sequenceStudy(await recordedRows(c.env.DB,source,r),source,r.count,trigger)})
})
