import { Hono } from 'hono'
import { builtinSnapshot } from './atlas-api'
import { SOURCES } from './sync'
import { pick } from './picker'
import { nextPeriod, periodTimeMs } from './period'
import { wilsonInterval } from './evaluation'
import { verifiedLiveSql, STRATEGIES } from './arena'

export const STUDIO_VERSION = 'studio-v1'
export const RECIPES = [
 { id:'balanced', name:'均衡观察', description:'综合历史信号，使用固定参数排序。', temp:1.5 },
 { id:'focused', name:'集中观察', description:'放大排序差异；不代表命中概率更高。', temp:0.8 },
 { id:'control', name:'随机对照', description:'固定种子洗牌，作为同覆盖数的对照组。', temp:null },
]
const COUNTS = [100,150,300,500]
class StudioError extends Error { constructor(public status:number, message:string) { super(message) } }
const fail = (status:number,message:string):never => { throw new StudioError(status,message) }
const strictKeys = (b:any, keys:string[]) => { if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k))) fail(400,'提交内容格式不正确') }
async function body(c:any) {
 const reader=c.req.raw.body?.getReader(); if(!reader) return fail(400,'请提交 JSON 内容')
 let text='',size=0;const decoder=new TextDecoder()
 try { for(;;) { const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){await reader.cancel();fail(413,'提交内容过长')}text+=decoder.decode(r.value,{stream:true}) }text+=decoder.decode() }
 finally { reader.releaseLock() }
 try{return JSON.parse(text)}catch{return fail(400,'JSON 格式不正确')}
}
function sourceOf(value:unknown):string { if(typeof value!=='string'||!value.startsWith('qkltj:')||!Object.hasOwn(SOURCES,value))return fail(400,'请选择平台提供的数据来源');return value }
function controlNumbers(seed:string,count:number) {
 let x=2166136261;for(const ch of seed)x=Math.imul(x^ch.charCodeAt(0),16777619)>>>0
 const a=Array.from({length:1000},(_,i)=>String(i).padStart(3,'0'))
 for(let i=999;i>0;i--){x=(Math.imul(1664525,x)+1013904223)>>>0;const j=Math.floor(x/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]]}
 return a.slice(0,count)
}
export function readiness(s:any,now=Date.now()) {
 const tail=s.records.slice(-120), last=tail.at(-1), cutoff=last?periodTimeMs(nextPeriod(last.period,s.source.id),s.source.id):null
 let reason=''
 if(tail.length<120)reason='需要至少 120 期有效历史数据，请先同步数据。'
 else if(s.quality.rejectedRows)reason='样本中存在无效记录，请先检查数据。'
 else if(tail.slice(1).some((r:any)=>!r.previousContiguous))reason='最近 120 期存在缺期，请等待数据补齐。'
 else if(!cutoff||cutoff<=now+1500)reason='当前期次已截止或即将截止，等待最新开奖同步后再生成。'
 else if(periodTimeMs(last.period,s.source.id)!>now)reason='数据时间超前，请检查系统时间和数据来源。'
 return {ready:!reason,reason,expect:last?nextPeriod(last.period,s.source.id):null,cutoff_ms:cutoff}
}
const validDraw = [1,2,3,4,5].map(n=>'d.n'+n+' BETWEEN 0 AND 9 AND typeof(d.n'+n+")='integer'").join(' AND ')
const actualSql = "CASE WHEN "+validDraw+" THEN CAST(d.n1 AS TEXT)||CAST(d.n2 AS TEXT)||CAST(d.n3 AS TEXT) ELSE NULL END"
function planRow(r:any) {
 const numbers=JSON.parse(r.numbers),actual=r.actual??null
 return {...r,numbers,pinned:!!r.pinned,note:r.note||'',actual,hit:actual===null?null:numbers.includes(actual),
 status:actual!==null?'settled':Date.now()<r.cutoff_ms?'locked':'awaiting_data',
 theoretical_coverage:r.count/1000,next_probability:null,calibrated:false}
}
export async function readPlans(db:D1Database,source:string) {
 const rows=(await db.prepare(`SELECT p.*,a.note,a.pinned,${actualSql} actual
 FROM studio_plans p LEFT JOIN studio_annotations a ON a.plan_id=p.id
 LEFT JOIN draws d ON d.source=p.source AND d.expect=p.expect
 WHERE p.source=? ORDER BY p.expect DESC,p.created_ms DESC,p.id LIMIT 100`).bind(source).all<any>()).results
 return rows.map(planRow)
}
export async function studioHistory(db:D1Database,source:string) {
 // Equal per-configuration windows, with results always joined from canonical draws.
 const rows=(await db.prepare(`WITH combined AS (
 SELECT 'studio' origin,recipe strategy,version,count,expect,numbers,created_ms,cutoff_ms FROM studio_plans WHERE source=?
 UNION ALL
 SELECT 'arena',strategy,prediction_version,count,expect,numbers,created_ms,cutoff_ms FROM arena_rounds
 WHERE source=? AND ${verifiedLiveSql('',true)}
 ), ranked AS (
 SELECT *,ROW_NUMBER() OVER(PARTITION BY origin,strategy,version,count ORDER BY expect DESC) rn FROM combined
 )
 SELECT p.*,${actualSql} actual FROM ranked p LEFT JOIN draws d ON d.source=? AND d.expect=p.expect
 WHERE p.rn<=500 ORDER BY p.expect ASC`).bind(source,source,source).all<any>()).results
 const groups=new Map<string,any>()
 for(const r of rows){
  const key=[r.origin,r.strategy,r.version,r.count].join(':')
  if(!groups.has(key))groups.set(key,{key,origin:r.origin,strategy:r.strategy,version:r.version,count:r.count,
   name:r.origin==='studio'?RECIPES.find(x=>x.id===r.strategy)?.name||r.strategy:STRATEGIES.find(x=>x.key===r.strategy)?.name||r.strategy,
   n:0,hits:0,pending:0,missing:0,invalid:0,max_miss:0,current_miss:0,last_observed:null,trail:[],first_period:null,last_period:null})
  const g=groups.get(key)
  if(r.actual==null){if(Date.now()<r.cutoff_ms)g.pending++;else g.missing++;g.current_miss=0;g.last_observed=null;continue}
  let nums:string[];try{nums=r.origin==='studio'?JSON.parse(r.numbers):r.numbers.split(' ')}catch{continue}
  if(nums.length!==r.count||new Set(nums).size!==r.count||nums.some(n=>!/^\d{3}$/.test(n))){g.invalid++;g.current_miss=0;g.last_observed=null;continue}
  const hit=nums.includes(r.actual);
  if(g.last_observed&&nextPeriod(g.last_observed,source)!==r.expect)g.current_miss=0
  g.current_miss=hit?0:g.current_miss+1;g.max_miss=Math.max(g.max_miss,g.current_miss);g.last_observed=r.expect
  g.n++;g.hits+=Number(hit);g.first_period??=r.expect;g.last_period=r.expect;g.trail.push(hit)
 }
 return [...groups.values()].map(g=>({...g,rate:g.n?g.hits/g.n:null,interval95:wilsonInterval(g.hits,g.n),
  baseline:g.count/1000,excess_hits:g.hits-g.n*g.count/1000,trail:g.trail.slice(-40),next_probability:null,calibrated:false}))
}
export async function createPlan(db:D1Database,input:any) {
 strictKeys(input,['source','recipe','count','expect','revision'])
 const source=sourceOf(input.source),recipe=RECIPES.find(r=>r.id===input.recipe),count=input.count
 if(!recipe||!COUNTS.includes(count))fail(400,'请选择有效策略和覆盖数量')
 if(typeof input.expect!=='string'||typeof input.revision!=='string')fail(400,'请刷新页面后重试')
 const existing=await db.prepare('SELECT id FROM studio_plans WHERE source=? AND expect=? AND recipe=? AND version=? AND count=?')
  .bind(source,input.expect,recipe.id,STUDIO_VERSION,count).first<any>()
 if(existing)return {id:existing.id,existing:true}
 const s=await builtinSnapshot(db,source,1000),gate=readiness(s)
 if(!gate.ready)fail(409,gate.reason)
 if(input.revision!==s.revision||input.expect!==gate.expect)fail(409,'数据已更新，请刷新后重新生成。')
 const draws=s.records.slice().reverse().map((r:any)=>({source,expect:r.period,n1:r.numbers[0],n2:r.numbers[1],n3:r.numbers[2],n4:r.numbers[3],n5:r.numbers[4],open_ms:r.drawAt,block:null,hash:''}))
 const picked=recipe.temp===null?null:pick(draws,{source,count,temp:recipe.temp,steps:60,btSteps:0,wParity:0.6,wSize:0.4,wCombo:0.35})
 const numbers=picked?picked.numbers.map(r=>r.no):controlNumbers(source+gate.expect+STUDIO_VERSION,count)
 const id=crypto.randomUUID(),created=Date.now()
 try {
  await db.prepare(`INSERT INTO studio_plans(id,source,expect,recipe,version,count,numbers,based_on,input_revision,input_count,created_ms,cutoff_ms,score_mass)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,source,gate.expect,recipe.id,STUDIO_VERSION,count,JSON.stringify(numbers),s.latestPeriod,s.revision,draws.length,created,gate.cutoff_ms,picked?.coverage.score_mass??null).run()
 }catch(e:any){
  if(/UNIQUE/.test(e.message)){const row=await db.prepare('SELECT id FROM studio_plans WHERE source=? AND expect=? AND recipe=? AND version=? AND count=?').bind(source,gate.expect,recipe.id,STUDIO_VERSION,count).first<any>();if(row)return{id:row.id,existing:true}}
  if(/STUDIO_CUTOFF|STUDIO_REVISION/.test(e.message))fail(409,'生成期间数据或期次已更新，未保存过期方案，请刷新后再试。')
  throw e
 }
 return {id,existing:false}
}
export const studioApi=new Hono<{Bindings:{DB:D1Database}}>()
studioApi.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
studioApi.onError((e,c)=>c.json({ok:false,error:e instanceof StudioError?e.message:'工作台数据读取失败，请稍后重试'},(e instanceof StudioError?e.status:500) as any))
studioApi.get('/overview',async c=>{
 const source=sourceOf(c.req.query('source')||'qkltj:6001')
 let s:any,plans:any[],history:any[],consistent=false
 for(let attempt=0;attempt<3;attempt++){
  s=await builtinSnapshot(c.env.DB,source,1000)
  ;[plans,history]=await Promise.all([readPlans(c.env.DB,source),studioHistory(c.env.DB,source)])
  const revision=await c.env.DB.prepare('SELECT source_id||\':\'||revision token FROM atlas_source_revisions WHERE source_id=?').bind(source).first<string>('token')
  if((revision||source+':0')===s.revision){consistent=true;break}
 }
 if(!consistent)fail(409,'数据正在更新，请稍后刷新。')
 return c.json({ok:true,contractVersion:'studio.v1',snapshot:s,readiness:readiness(s),recipes:RECIPES,counts:COUNTS,plans,history,
  methodology:{projection:'front3',space:1000,history_window_per_config:500,calibrated:false,next_probability:null,
   note:'历史区间描述已观察样本；固定策略仍可能存在相关性和选择偏差，不能作为下期命中承诺。'}})
})
studioApi.post('/plans',async c=>c.json({ok:true,...await createPlan(c.env.DB,await body(c))}))
studioApi.patch('/plans/:id',async c=>{
 const b=await body(c);strictKeys(b,['note','pinned'])
 if(typeof b.note!=='string'||b.note.length>1000||typeof b.pinned!=='boolean')fail(400,'备注限 1000 字，关注状态须为布尔值')
 const id=c.req.param('id')
 if(!await c.env.DB.prepare('SELECT 1 FROM studio_plans WHERE id=?').bind(id).first())fail(404,'方案不存在')
 await c.env.DB.prepare('INSERT INTO studio_annotations VALUES(?,?,?,?) ON CONFLICT(plan_id) DO UPDATE SET note=excluded.note,pinned=excluded.pinned,updated_ms=excluded.updated_ms').bind(id,b.note,Number(b.pinned),Date.now()).run()
 return c.json({ok:true})
})
studioApi.get('/data',async c=>{
 const source=sourceOf(c.req.query('source')||'qkltj:6001'),period=c.req.query('period')||''
 if(period&&!/^\d{8,12}$/.test(period))fail(400,'请输入完整期号')
 const limit=Number(c.req.query('limit')||100)
 if(!Number.isInteger(limit)||limit<1||limit>3000)fail(400,'导出范围为最近 1–3000 期')
 const rows=(await c.env.DB.prepare("SELECT expect,n1,n2,n3,n4,n5,open_ms,block,hash,src,mismatch FROM draws WHERE source=? AND (?='' OR expect=?) ORDER BY expect DESC LIMIT ?").bind(source,period,period,limit).all()).results
 return c.json({ok:true,contractVersion:'studio.v1',source,projection:'digits5',limit,period:period||null,rows,exported_at:Date.now()})
})
