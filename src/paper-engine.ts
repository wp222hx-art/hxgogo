import { nextPeriod } from './period'
import { wilsonInterval } from './evaluation'
export type Mode='flat'|'win'|'loss'|'both'
export type PaperConfig={capital:number;unit:number;multiplier:number;maxLevel:number;maxStake:number;stopLoss:number;takeProfit:number;maxRounds:number;trigger:number;odds:number;mode:Mode}
export type Observation={expect:string;hit:boolean|null;actual?:string|null;numbers?:string[];cutoff_ms?:number;created_ms?:number}
export const DEFAULT_PAPER:PaperConfig={capital:10000,unit:0.2,multiplier:2,maxLevel:4,maxStake:2000,stopLoss:3000,takeProfit:3000,maxRounds:500,trigger:2,odds:950,mode:'both'}
export function paperConfig(input:any):PaperConfig{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_PAPER,k)))throw Error('模拟参数格式不正确')
 const c={...DEFAULT_PAPER,...input};if(!['flat','win','loss','both'].includes(c.mode))throw Error('请选择有效的模拟方式')
 const rules:Record<string,[number,number,boolean]>={capital:[1,10000000,false],unit:[.01,10000,false],multiplier:[1.1,3,false],maxLevel:[0,10,true],maxStake:[.01,10000000,false],stopLoss:[.01,10000000,false],takeProfit:[.01,10000000,false],maxRounds:[1,5000,true],trigger:[1,8,true],odds:[1,1000,true]}
 for(const[k,[lo,hi,integer]]of Object.entries(rules)){const n=c[k];if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi||(integer&&!Number.isInteger(n)))throw Error(k+' 超出允许范围');if(['capital','unit','maxStake','stopLoss','takeProfit'].includes(k)&&Math.abs(n*100-Math.round(n*100))>1e-6)throw Error('金额最多保留两位小数')}
 return c
}
export const cents=(n:number)=>Math.round(n*100)
export function unitAt(c:PaperConfig,level:number){return Math.ceil(cents(c.unit)*c.multiplier**level-1e-8)}
export function nextSizing(rows:Observation[],source:string,c:PaperConfig){
 let wins=0,misses=0,last:string|null=null
 for(const r of rows){if(last&&nextPeriod(last,source)!==r.expect){wins=0;misses=0}last=r.expect;if(r.hit==null){wins=0;misses=0;continue}if(r.hit){wins++;misses=0}else{misses++;wins=0}}
 const branch=(c.mode==='win'||c.mode==='both')&&wins>=c.trigger?'win':(c.mode==='loss'||c.mode==='both')&&misses>=c.trigger?'loss':'base'
 const level=branch==='base'?0:(branch==='win'?wins:misses)-c.trigger+1
 return {level,branch,wins,misses,unit_cents:unitAt(c,level)}
}
export function stakeGate(c:PaperConfig,count:number,balance:number,rounds:number,sizing:ReturnType<typeof nextSizing>){
 const pnl=balance-cents(c.capital),stake=sizing.unit_cents*count
 if(rounds>=c.maxRounds)return '已达到模拟期数上限'
 if(pnl<=-cents(c.stopLoss))return '已达到模拟止损线'
 if(pnl>=cents(c.takeProfit))return '已达到模拟止盈线'
 if(sizing.level>c.maxLevel)return '下一档超过加码级数上限'
 if(!Number.isSafeInteger(stake)||stake>cents(c.maxStake))return '下一期金额超过单期上限'
 if(stake>balance)return '模拟余额不足，停止加码'
 if(balance-stake<cents(c.capital)-cents(c.stopLoss))return '下一期全损将超过止损线'
 return null
}
export function simulate(rows:Observation[],source:string,count:number,config:PaperConfig){
 const c=paperConfig(config),history:Observation[]=[],ledger:any[]=[];let balance=cents(c.capital),peak=balance,maxDrawdown=0,totalStaked=0,hits=0,stopReason:string|null=null,cyclePnl=0,lastBranch='base',lastPeriod:string|null=null
 for(const r of rows){
  if(r.hit==null){history.push(r);continue}
  if(lastPeriod&&nextPeriod(lastPeriod,source)!==r.expect){history.length=0;cyclePnl=0;lastBranch='base'}
  const sizing=nextSizing(history,source,c);stopReason=stakeGate(c,count,balance,ledger.length,sizing);if(stopReason)break
  const stake=sizing.unit_cents*count,payout=r.hit?sizing.unit_cents*c.odds:0,profit=payout-stake
  if(history.at(-1)?.hit!==false)cyclePnl=0
  cyclePnl+=profit;balance+=profit;totalStaked+=stake;hits+=Number(r.hit);peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak-balance)
  ledger.push({expect:r.expect,hit:r.hit,actual:r.actual??null,...sizing,stake_cents:stake,payout_cents:payout,profit_cents:profit,balance_cents:balance,cycle_profit_cents:cyclePnl})
  lastBranch=sizing.branch;lastPeriod=r.expect;history.push(r)
 }
 const sizing=nextSizing(history,source,c),nextStop=stopReason||stakeGate(c,count,balance,ledger.length,sizing)
 return {config:c,count,rows:ledger,summary:{rounds:ledger.length,hits,hit_rate:ledger.length?hits/ledger.length:null,balance_cents:balance,profit_cents:balance-cents(c.capital),staked_cents:totalStaked,max_drawdown_cents:maxDrawdown,roi:totalStaked?(balance-cents(c.capital))/totalStaked:null,stop_reason:nextStop},next:{...sizing,stake_cents:sizing.unit_cents*count,allowed:!nextStop,reason:nextStop},theory:{coverage:count/1000,break_even:count/c.odds,return_per_unit:c.odds/1000-1,calibrated_probability:null}}
}
export function sequenceStudy(rows:Observation[],source:string,count:number,trigger:number){
 const buckets={base:{n:0,hits:0},win:{n:0,hits:0},loss:{n:0,hits:0}},p0=count/1000
 let wins=0,misses=0,last:string|null=null,n=0,hits=0,brier=0,baselineBrier=0,evaluated=0;const valid=rows.filter(r=>r.hit!=null).length,split=Math.floor(valid*.7)
 let runs=0,previous:boolean|null=null,segment:boolean[]=[],tail:boolean[]=[]
 for(const r of rows){
  if(last&&nextPeriod(last,source)!==r.expect){wins=misses=0;previous=null;segment=[]}last=r.expect
  if(r.hit==null){wins=misses=0;previous=null;segment=[];continue}
  const branch=wins>=trigger?'win':misses>=trigger?'loss':'base',b=buckets[branch],forecast=(b.hits+20*p0)/(b.n+20)
  if(n>=split){brier+=(forecast-Number(r.hit))**2;baselineBrier+=(p0-Number(r.hit))**2;evaluated++}
  b.n++;b.hits+=Number(r.hit);hits+=Number(r.hit);n++
  if(previous===null||previous!==r.hit)runs++;previous=r.hit;segment.push(r.hit);tail=segment
  if(r.hit){wins++;misses=0}else{misses++;wins=0}
 }
 const branch=wins>=trigger?'win':misses>=trigger?'loss':'base',b=buckets[branch]
 const conditions=Object.entries(buckets).map(([kind,v])=>({kind,...v,rate:v.n?v.hits/v.n:null,interval95:wilsonInterval(v.hits,v.n),smoothed_rate:(v.hits+20*p0)/(v.n+20)}))
 const n1=tail.filter(Boolean).length,n2=tail.length-n1;let runCount=tail.length?1:0;for(let i=1;i<tail.length;i++)if(tail[i]!==tail[i-1])runCount++
 const expected=tail.length?2*n1*n2/tail.length+1:0,variance=tail.length>1?2*n1*n2*(2*n1*n2-tail.length)/(tail.length**2*(tail.length-1)):0
 const z=n1>10&&n2>10&&variance>0?(runCount-expected)/Math.sqrt(variance):null
 return {n,hits,rate:n?hits/n:null,baseline:p0,conditions,current:{branch,wins,misses,n:b.n,smoothed_rate:(b.hits+20*p0)/(b.n+20)},holdout:{kind:'chronological_last_30_percent_prefix_only',n:evaluated,brier:evaluated?brier/evaluated:null,baseline_brier:evaluated?baselineBrier/evaluated:null},runs:{n:tail.length,runs:runCount,z,scope:'latest_contiguous_segment'},next_probability:null,calibrated:false,guidance:b.n<30?'同类状态样本少于 30 期，继续记录，暂不判断加码机会。':evaluated<30?'后段验证样本不足，条件频率仅供观察。':brier>=baselineBrier?'条件频率在后段验证中未优于理论基线，尚无提高下期命中率的依据。':'条件频率在这段历史的后段评分较好，仍需新增开奖前记录复验，不能据此确认下一期优势。'}
}
