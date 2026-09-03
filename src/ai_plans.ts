// ============ AI 建议自动回测：把 AI 分析官报告里的「择时 / 切换 / 仓位 / 止损」建议解析成受限规则 DSL，
//              在竞技场已结算序列上做 walk-forward 模拟（决策只用该期之前的数据），并区分「样本内（提出前）」与「样本外（提出后实盘）」。
//              形成二阶闭环：AI 提建议 → 系统落成第 N 套投资策略 → 逐期验证 → 样本外战绩反馈给 AI 下一份报告。 ============
import { BASE_KEYS, STRATEGIES, ARENA_N, ARENA_ODDS } from './arena'

const SPACE = 1000
const r3 = (x: number) => Math.round(x * 1000) / 1000
const r4 = (x: number) => Math.round(x * 10000) / 10000
const clamp = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }

// ------------------------------------------------------------ 规则 DSL（刻意受限：只允许可在已结算序列上无前视计算的量）
/** 可用条件指标（均只看目标期之前） */
export type Metric =
  | 'roll_z'        // 某策略近 window 期滚动 z
  | 'roll_rate'     // 某策略近 window 期命中率
  | 'miss_streak'   // 某策略当前连续未中期数
  | 'hit_streak'    // 某策略当前连续命中期数
  | 'meta_weight'   // 某基础策略在组合最优里的当前权重（该期记录的 weight）
  | 'best_z'        // 全部基础策略里最高的滚动 z（strategy 忽略）
export interface Condition { metric: Metric; strategy?: string; window?: number; op: '>' | '>=' | '<' | '<='; value: number }
export interface Target {
  kind: 'fixed' | 'best_z' | 'worst_z' | 'best_rate'
  strategy?: string      // fixed 时必填
  window?: number        // best/worst 时的滚动窗口
  min_n?: number         // best/worst 时最少样本，不足则回退 fallback
  fallback?: string | null  // 回退策略（null = 观望）
}
export interface Sizing { base: number; high: number; low: number; high_if?: Condition[]; low_if?: Condition[] }  // 单位倍数（0.5–2）
export interface Risk {
  stop_after_misses?: number   // 该方案（自身）连续 N 次下注未中 → 暂停
  pause_periods?: number       // 暂停 K 期后恢复
  max_drawdown?: number        // 方案累计回撤超过此值（单位：注）→ 暂停 pause_periods×2 期，恢复时重置回撤高点
}
export interface PlanRule {
  name: string
  rationale: string           // AI 给出的理由（原文摘要）
  target: Target
  conditions: Condition[]     // 全部满足才下注（AND）
  any_conditions?: Condition[] // 任一满足即可（OR，与 conditions 同时生效）
  sizing?: Sizing
  risk?: Risk
}

const METRICS: Metric[] = ['roll_z', 'roll_rate', 'miss_streak', 'hit_streak', 'meta_weight', 'best_z']
const OPS = ['>', '>=', '<', '<='] as const
const PICKABLE = STRATEGIES.filter(s => !s.ai).map(s => s.key)   // AI 方案可选的策略（含 meta/follow/vote/random，不含 ai 自身——ai 无回放序列）

function normCond(c: any): Condition | null {
  if (!c || !METRICS.includes(c.metric) || !OPS.includes(c.op)) return null
  const strategy = typeof c.strategy === 'string' && PICKABLE.includes(c.strategy) ? c.strategy : (c.metric === 'best_z' ? undefined : 'meta')
  return { metric: c.metric, strategy, window: Math.round(clamp(c.window, 5, 100, 20)), op: c.op, value: clamp(c.value, -10, 1000, 0) }
}
/** 把模型输出规范化为合法 PlanRule；不合法返回 null */
export function normalizeRule(o: any): PlanRule | null {
  if (!o || typeof o !== 'object') return null
  const t = o.target || {}
  const kind: Target['kind'] = ['fixed', 'best_z', 'worst_z', 'best_rate'].includes(t.kind) ? t.kind : 'fixed'
  const target: Target = {
    kind, strategy: kind === 'fixed' ? (PICKABLE.includes(t.strategy) ? t.strategy : 'meta') : undefined,
    window: Math.round(clamp(t.window, 5, 100, 40)), min_n: Math.round(clamp(t.min_n, 1, 100, 10)),
    fallback: t.fallback === null ? null : (PICKABLE.includes(t.fallback) ? t.fallback : (kind === 'fixed' ? null : 'meta')),
  }
  const conditions = (Array.isArray(o.conditions) ? o.conditions : []).map(normCond).filter(Boolean).slice(0, 6) as Condition[]
  const any_conditions = (Array.isArray(o.any_conditions) ? o.any_conditions : []).map(normCond).filter(Boolean).slice(0, 6) as Condition[]
  let sizing: Sizing | undefined
  if (o.sizing && typeof o.sizing === 'object') sizing = {
    base: clamp(o.sizing.base, 0.5, 2, 1), high: clamp(o.sizing.high, 0.5, 2, 1.5), low: clamp(o.sizing.low, 0.5, 2, 0.5),
    high_if: (Array.isArray(o.sizing.high_if) ? o.sizing.high_if : []).map(normCond).filter(Boolean).slice(0, 4) as Condition[],
    low_if: (Array.isArray(o.sizing.low_if) ? o.sizing.low_if : []).map(normCond).filter(Boolean).slice(0, 4) as Condition[],
  }
  let risk: Risk | undefined
  if (o.risk && typeof o.risk === 'object') risk = {
    stop_after_misses: o.risk.stop_after_misses != null ? Math.round(clamp(o.risk.stop_after_misses, 1, 20, 3)) : undefined,
    pause_periods: o.risk.pause_periods != null ? Math.round(clamp(o.risk.pause_periods, 1, 60, 10)) : undefined,
    // 模型常把回撤写成比例（0.06）：按 100 注名义本金（100×ARENA_N）折算；绝对值按「注」单位；最低 1000（至少允许 2 次未中）
    max_drawdown: o.risk.max_drawdown != null ? Math.round(clamp(Number(o.risk.max_drawdown) > 0 && Number(o.risk.max_drawdown) <= 1 ? Number(o.risk.max_drawdown) * 100 * ARENA_N : o.risk.max_drawdown, 1000, 100000, 10000)) : undefined,
  }
  return { name: String(o.name || 'AI 方案').slice(0, 40), rationale: String(o.rationale || '').slice(0, 300), target, conditions, any_conditions: any_conditions.length ? any_conditions : undefined, sizing, risk }
}

const short = (k?: string) => STRATEGIES.find(s => s.key === k)?.short || k || '—'
const M_CN: Record<Metric, string> = { roll_z: '滚动z', roll_rate: '滚动命中率', miss_streak: '连败', hit_streak: '连胜', meta_weight: '组合权重', best_z: '最强滚动z' }
const condText = (c: Condition) => `${c.metric === 'best_z' ? '' : short(c.strategy)}${M_CN[c.metric]}${['roll_z', 'roll_rate', 'best_z'].includes(c.metric) ? `(${c.window}期)` : ''} ${c.op} ${c.metric === 'roll_rate' || c.metric === 'meta_weight' ? (c.value <= 1 ? (c.value * 100).toFixed(0) + '%' : c.value) : c.value}`
/** 人话描述（前端 desc） */
export function describeRule(r: PlanRule) {
  const t = r.target
  const tgt = t.kind === 'fixed' ? `投「${short(t.strategy)}」` : `投${t.kind === 'best_z' ? '滚动z最高' : t.kind === 'worst_z' ? '滚动z最低' : '滚动命中率最高'}的基础策略(${t.window}期,≥${t.min_n}样本${t.fallback ? `,否则${short(t.fallback)}` : ',否则观望'})`
  const cond = r.conditions.length ? `仅当 ${r.conditions.map(condText).join(' 且 ')}` : ''
  const anyc = r.any_conditions?.length ? `${cond ? '，并且' : '仅当'}【${r.any_conditions.map(condText).join(' 或 ')}】` : ''
  const sz = r.sizing ? `；仓位 基础${r.sizing.base}×${r.sizing.high_if?.length ? `，${r.sizing.high_if.map(condText).join('且')}→${r.sizing.high}×` : ''}${r.sizing.low_if?.length ? `，${r.sizing.low_if.map(condText).join('且')}→${r.sizing.low}×` : ''}` : ''
  const rk = r.risk ? `；风控 ${[r.risk.stop_after_misses ? `连败${r.risk.stop_after_misses}次停${r.risk.pause_periods || 10}期` : '', r.risk.max_drawdown ? `回撤>${r.risk.max_drawdown}停${2 * (r.risk.pause_periods || 10)}期` : ''].filter(Boolean).join('、')}` : ''
  return `${cond}${anyc}${cond || anyc ? ' 时' : ''}${tgt}${sz}${rk}`
}

// ------------------------------------------------------------ walk-forward 模拟器
export interface Period { expect: string; hit: Record<string, number>; pnl: Record<string, number>; weight: Record<string, number> }
export interface SimResult {
  bets: number; skips: number; hits: number; rate: number | null; z: number; pnl: number; roi: number | null; max_dd: number; curve: number[]; picks: Record<string, number>
  units: number   // 累计投入单位数（含仓位倍数）
  dd_breaks: number   // 触发回撤停投次数
  forward?: { bets: number; skips: number; hits: number; rate: number | null; z: number; pnl: number; roi: number | null; max_dd: number; from: string }   // 样本外（提出后）
  since_index?: number
}

export function simulateRule(rule: PlanRule, periods: Period[], sinceExpect?: string | null): SimResult {
  const rollStats = (key: string, i: number, k: number) => { let n = 0, h = 0; for (let j = i - 1; j >= 0 && n < k; j--) { const v = periods[j].hit[key]; if (v === undefined) continue; n++; h += v } return { n, h, rate: n ? h / n : 0, z: n ? (h - n * 0.5) / Math.sqrt(n * 0.25) : 0 } }
  const streak = (key: string, i: number, want: number) => { let m = 0; for (let j = i - 1; j >= 0; j--) { const v = periods[j].hit[key]; if (v === undefined) continue; if (v !== want) break; m++ } return m }
  const bestBy = (i: number, k: number, min: number, mode: 'best_z' | 'worst_z' | 'best_rate') => { let key: string | null = null, best = -Infinity; for (const b of BASE_KEYS) { const s = rollStats(b, i, k); if (s.n < min) continue; const v = mode === 'best_z' ? s.z : mode === 'worst_z' ? -s.z : s.rate; if (v > best) { best = v; key = b } } return key }
  const metric = (c: Condition, i: number): number | null => {
    switch (c.metric) {
      case 'roll_z': { const s = rollStats(c.strategy!, i, c.window!); return s.n >= Math.min(5, c.window!) ? s.z : null }
      case 'roll_rate': { const s = rollStats(c.strategy!, i, c.window!); return s.n >= Math.min(5, c.window!) ? s.rate : null }
      case 'miss_streak': return streak(c.strategy!, i, 0)
      case 'hit_streak': return streak(c.strategy!, i, 1)
      case 'meta_weight': { for (let j = i - 1; j >= 0; j--) { const w = periods[j].weight?.[c.strategy!]; if (w !== undefined && w !== null) return Number(w) } return null }
      case 'best_z': { let b = -Infinity; for (const k of BASE_KEYS) { const s = rollStats(k, i, c.window!); if (s.n >= 5) b = Math.max(b, s.z) } return b === -Infinity ? null : b }
    }
  }
  const test = (c: Condition, i: number) => { const v = metric(c, i); if (v === null) return false; return c.op === '>' ? v > c.value : c.op === '>=' ? v >= c.value : c.op === '<' ? v < c.value : v <= c.value }
  const all = (cs: Condition[] | undefined, i: number) => !cs || cs.every(c => test(c, i))
  const any = (cs: Condition[] | undefined, i: number) => !cs || !cs.length || cs.some(c => test(c, i))

  let bets = 0, skips = 0, hits = 0, cum = 0, peak = 0, dd = 0, units = 0, ownMiss = 0, pauseUntil = -1, ddPeak = 0, ddBreaks = 0
  const curve: number[] = []; const picks: Record<string, number> = {}
  let fw: { bets: number; skips: number; hits: number; pnl: number; peak: number; dd: number; cum: number; units: number } | null = null
  let sinceIdx = -1
  periods.forEach((p, i) => {
    if (sinceExpect && sinceIdx < 0 && p.expect > sinceExpect) { sinceIdx = i; fw = { bets: 0, skips: 0, hits: 0, pnl: 0, peak: 0, dd: 0, cum: 0, units: 0 } }
    let key: string | null = null
    if (i >= pauseUntil && all(rule.conditions, i) && any(rule.any_conditions, i)) {
      const t = rule.target
      key = t.kind === 'fixed' ? t.strategy! : (bestBy(i, t.window!, t.min_n!, t.kind) ?? (t.fallback || null))
    }
    let pnlP = 0, did = false, mult = 1
    if (key && p.hit[key] !== undefined) {
      if (rule.sizing) { mult = rule.sizing.base; if (rule.sizing.high_if?.length && rule.sizing.high_if.every(c => test(c, i))) mult = rule.sizing.high; else if (rule.sizing.low_if?.length && rule.sizing.low_if.every(c => test(c, i))) mult = rule.sizing.low }
      did = true; bets++; hits += p.hit[key]; pnlP = p.pnl[key] * mult; units += mult; picks[key] = (picks[key] || 0) + 1
      if (p.hit[key]) ownMiss = 0; else { ownMiss++; if (rule.risk?.stop_after_misses && ownMiss >= rule.risk.stop_after_misses) { pauseUntil = i + 1 + (rule.risk.pause_periods || 10); ownMiss = 0 } }
    } else skips++
    cum += pnlP; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); curve.push(Math.round(cum))
    ddPeak = Math.max(ddPeak, cum)
    if (rule.risk?.max_drawdown && did && ddPeak - cum >= rule.risk.max_drawdown) { pauseUntil = i + 1 + 2 * (rule.risk.pause_periods || 10); ddPeak = cum; ddBreaks++; ownMiss = 0 }
    if (fw) { if (did) { fw.bets++; fw.hits += p.hit[key!]; fw.units += mult } else fw.skips++; fw.cum += pnlP; fw.peak = Math.max(fw.peak, fw.cum); fw.dd = Math.max(fw.dd, fw.peak - fw.cum) }
  })
  const pBar = ARENA_N / SPACE
  const zOf = (h: number, n: number) => n ? r3((h - n * pBar) / Math.sqrt(n * pBar * (1 - pBar))) : 0
  const f = fw as any
  return {
    bets, skips, hits, rate: bets ? r4(hits / bets) : null, z: zOf(hits, bets), pnl: Math.round(cum), roi: units ? r4(cum / (units * ARENA_N)) : null, max_dd: Math.round(dd), curve, picks, units: r3(units), dd_breaks: ddBreaks,
    since_index: sinceIdx >= 0 ? sinceIdx : undefined,
    forward: f ? { bets: f.bets, skips: f.skips, hits: f.hits, rate: f.bets ? r4(f.hits / f.bets) : null, z: zOf(f.hits, f.bets), pnl: Math.round(f.cum), roi: f.units ? r4(f.cum / (f.units * ARENA_N)) : null, max_dd: Math.round(f.dd), from: periods[sinceIdx].expect } : undefined,
  }
}

// ------------------------------------------------------------ 持久化（ai_plans）
export interface AiPlanRow { id: number; source: string; report_expect: string; name: string; rule: string; rationale: string; created_ms: number; retired_ms: number | null; retire_reason: string | null; model: string }
export async function listAiPlans(db: D1Database, source: string, includeRetired = false) {
  return (await db.prepare(`SELECT * FROM ai_plans WHERE source=? ${includeRetired ? '' : 'AND retired_ms IS NULL'} ORDER BY id`).bind(source).all<AiPlanRow>()).results
}
export async function saveAiPlans(db: D1Database, source: string, reportExpect: string, model: string, rules: PlanRule[]) {
  const stmts = rules.map(r => db.prepare('INSERT INTO ai_plans (source, report_expect, name, rule, rationale, created_ms, model) VALUES (?,?,?,?,?,?,?)').bind(source, reportExpect, r.name, JSON.stringify(r), r.rationale, Date.now(), model))
  if (stmts.length) await db.batch(stmts)
  return stmts.length
}
export const MAX_ACTIVE_AI_PLANS = 4
/** 淘汰规则：样本外 ≥ 30 期下注且 z < −1（显著劣于基线）→ 退役；或活跃数超上限时淘汰样本外最差 */
export async function retirePlans(db: D1Database, source: string, evaluated: { id: number; forward?: { bets: number; z: number; pnl: number } }[]) {
  const retire = async (id: number, reason: string) => db.prepare('UPDATE ai_plans SET retired_ms=?, retire_reason=? WHERE id=? AND retired_ms IS NULL').bind(Date.now(), reason, id).run()
  let n = 0
  for (const e of evaluated) if (e.forward && e.forward.bets >= 30 && e.forward.z < -1) { await retire(e.id, `样本外 ${e.forward.bets} 次下注 z=${e.forward.z}，盈亏 ${e.forward.pnl}，显著弱于基线`); n++ }
  const alive = evaluated.filter(e => !(e.forward && e.forward.bets >= 30 && e.forward.z < -1))
  if (alive.length > MAX_ACTIVE_AI_PLANS) {
    const ranked = [...alive].sort((a, b) => (a.forward?.pnl ?? 0) - (b.forward?.pnl ?? 0))
    for (const e of ranked.slice(0, alive.length - MAX_ACTIVE_AI_PLANS)) { await retire(e.id, `活跃方案超过 ${MAX_ACTIVE_AI_PLANS} 套，样本外盈亏最差被淘汰（${e.forward?.pnl ?? 0}）`); n++ }
  }
  return n
}
