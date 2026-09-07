import { nextPeriod } from './period'

// Value points use one yuan per selected number; all cash values remain integer cents.
export function valueStats(rows:any[],source:string,count:number,odds=950){
 const settled=rows.filter(r=>r.hit!=null),hits=settled.filter(r=>r.hit).length
 let wins=0,misses=0,longestWin=0,longestMiss=0,last:string|null=null
 for(const r of rows){
  if(last&&nextPeriod(last,source)!==r.expect)wins=misses=0
  last=r.expect
  if(r.hit==null){wins=misses=0;continue}
  if(r.hit){wins++;misses=0}else{misses++;wins=0}
  longestWin=Math.max(longestWin,wins);longestMiss=Math.max(longestMiss,misses)
 }
 const rate=(a:any[])=>a.length?a.filter(r=>r.hit).length/a.length:null
 const hitRate=rate(settled),points=hits*odds-settled.length*count
 return {periods:settled.length,hits,hit_rate:hitRate,baseline:count/1000,breakeven:count/odds,
  edge_vs_breakeven:hitRate==null?null:hitRate-count/odds,value_points:points,roi:settled.length?points/(settled.length*count):null,
  current_wins:wins,current_miss:misses,longest_win:longestWin,longest_miss:longestMiss,
  last30:{periods:settled.slice(-30).length,hit_rate:rate(settled.slice(-30))},
  last100:{periods:settled.slice(-100).length,hit_rate:rate(settled.slice(-100))},
  first:settled[0]?.expect??null,last:settled.at(-1)?.expect??null,reference_odds:odds}
}
export function ledgerValue(input:any[],source:string,count:number,unit:number,odds:number,capital:number){
 const baseUnit=Math.round(unit*100),baseStake=baseUnit*count
 let balance=Math.round(capital*100),realized=0,flatProfit=0,pendingStake=0,settledStake=0,payouts=0,totalStake=0,wins=0,misses=0,last:string|null=null,lastRevision:any=null
 const branches:any={base:{rounds:0,staked_cents:0,profit_cents:0},win:{rounds:0,staked_cents:0,profit_cents:0},loss:{rounds:0,staked_cents:0,profit_cents:0}}
 const rows=input.map(r=>{
  if((last&&nextPeriod(last,source)!==r.expect)||(lastRevision!=null&&r.bot_revision!=null&&lastRevision!==r.bot_revision))wins=misses=0
  last=r.expect;lastRevision=r.bot_revision
  const before={wins,misses},hit=r.hit??null,payout=hit==null?null:hit?r.unit_cents*odds:0,profit=payout==null?null:payout-r.stake_cents
  const flatPayout=hit==null?null:hit?baseUnit*odds:0,flat=flatPayout==null?null:flatPayout-baseStake
  totalStake+=r.stake_cents;balance-=r.stake_cents
  if(profit==null){pendingStake+=r.stake_cents;wins=misses=0}
  else{
   payouts+=payout!;balance+=payout!;realized+=profit;settledStake+=r.stake_cents;flatProfit+=flat!
   const group=branches[r.branch]||branches.base;group.rounds++;group.staked_cents+=r.stake_cents;group.profit_cents+=profit
   if(hit){wins++;misses=0}else{misses++;wins=0}
  }
  return {...r,hit,payout_cents:payout,profit_cents:profit,balance_cents:balance,
   value_points:hit==null?null:(hit?odds-count:-count),multiplier:r.unit_cents/baseUnit,before,
   flat_profit_cents:flat,extra_profit_cents:profit==null?null:profit-flat!,
   cumulative_profit_cents:realized,cumulative_flat_profit_cents:flatProfit}
 })
 return {rows,financial:{realized_profit_cents:realized,pending_stake_cents:pendingStake,settled_stake_cents:settledStake,
  payout_cents:payouts,staked_cents:totalStake,roi:settledStake?realized/settledStake:null,
  flat_profit_cents:flatProfit,extra_profit_cents:realized-flatProfit,branches}}
}
