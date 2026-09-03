// ============ AI 预测官：把全部量化上下文交给大模型推理 → 结构化预测 → 折算为 1000 维三位号得分 → 作为竞技场选手被真实开奖检验 ============
// 设计原则：
//  1) AI 只拿「目标期之前」的数据（与其他策略同一 walk-forward 规则），输出结构化 JSON 而不是随口报号；
//  2) 每期都把它自己上几期的预测与真实结果喂回去（自我复盘闭环），形成不间断迭代；
//  3) AI 的号码进入 arena_rounds（strategy='ai'），与随机对照组同台结算——它是否有信号由数据说话。
import { type Draw } from './analysis'
import { STRATEGIES, ARENA_N, type PerfMap } from './arena'

export interface AiEnv { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string; AI_MODEL?: string; AI_EFFORT?: string }
export const aiEnabled = (env: AiEnv) => !!(env.OPENAI_API_KEY && env.OPENAI_BASE_URL)
export const aiModel = (env: AiEnv) => env.AI_MODEL || 'gpt-5-mini'
/** 逐期预测的推理强度：该厅 1 分钟一期，默认 low（~5-10s）；报告固定 medium */
export const aiEffort = (env: AiEnv): 'low' | 'medium' | 'high' => (['low', 'medium', 'high'].includes(env.AI_EFFORT || '') ? env.AI_EFFORT : 'low') as any
const SPACE = 1000
const no3 = (i: number) => String(i).padStart(3, '0')
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** 大模型输出的结构化预测 */
export interface AiForecast {
  regime: string                                  // 对当前盘面的判断（如「万位大数连开、形态回归杂六」）
  confidence: number                              // 0-1，自评把握
  pos_weights: number[][]                         // 3×10，每位 0-9 的相对权重（0-100）
  strategy_blend: Record<string, number>          // 对基础策略向量的融合权重（0-100）
  boost: string[]                                 // 额外看好的三位号（≤30）
  avoid: string[]                                 // 明确回避的三位号（≤30）
  reasoning: string                               // 中文推理（≤300 字）
  next_focus: string                              // 下期复盘时要验证的假设
}

// ------------------------------------------------------------ 上下文压缩（把「前面所有数据」提炼成模型可消化的摘要）
const d3 = (d: Draw) => `${d.n1}${d.n2}${d.n3}`
function digest(draws: Draw[]) {
  const recent = draws.slice(0, 60)
  const posFreq = (win: number) => [0, 1, 2].map(pos => { const c = Array(10).fill(0); for (const d of draws.slice(0, win)) c[[d.n1, d.n2, d.n3][pos]]++; return c })
  const gaps = [0, 1, 2].map(pos => [...Array(10).keys()].map(v => { const i = draws.findIndex(d => [d.n1, d.n2, d.n3][pos] === v); return i < 0 ? draws.length : i }))
  const runs = (f: (d: Draw) => string) => { let s = ''; for (const d of recent.slice(0, 30)) s += f(d); return s }
  const shape = (d: Draw) => { const a = d.n1, b = d.n2, c = d.n3; if (a === b && b === c) return '豹'; const s = [a, b, c].sort(); if (s[2] - s[1] === 1 && s[1] - s[0] === 1) return '顺'; if (a === b || b === c || a === c) return '对'; return '杂' }
  const sh: Record<string, number> = {}; for (const d of draws.slice(0, 200)) sh[shape(d)] = (sh[shape(d)] || 0) + 1
  return {
    latest_expect: draws[0].expect, sample: draws.length,
    last60_first3: recent.map(d3).join(' '),
    pos_freq_60: posFreq(60), pos_freq_200: posFreq(200),
    gaps_now: gaps,
    runs30_newest_first: {
      w_size: runs(d => d.n1 >= 5 ? '大' : '小'), w_parity: runs(d => d.n1 % 2 ? '单' : '双'),
      q_size: runs(d => d.n2 >= 5 ? '大' : '小'), q_parity: runs(d => d.n2 % 2 ? '单' : '双'),
      b_size: runs(d => d.n3 >= 5 ? '大' : '小'), b_parity: runs(d => d.n3 % 2 ? '单' : '双'),
      sum3_size: runs(d => d.n1 + d.n2 + d.n3 >= 14 ? '大' : '小'), dragon: runs(d => d.n1 > d.n3 ? '龙' : d.n1 < d.n3 ? '虎' : '和'), shape: runs(shape),
    },
    shape_200: sh,
  }
}

function perfDigest(perf: PerfMap, weights: Record<string, any>) {
  return STRATEGIES.filter(s => !s.ai).map(s => {
    const rows = (perf[s.key] || []).slice(-40); const n = rows.length, h = rows.reduce((a, r) => a + r.hit, 0)
    return { key: s.key, name: s.name, rolling40: n ? { n, hits: h, rate: r3(h / n), z: r3((h - n * 0.5) / Math.sqrt(n * 0.25 || 1)) } : null, meta_weight: weights[s.key]?.w ?? null, last10: rows.slice(-10).map(r => r.hit).join('') }
  })
}

// ------------------------------------------------------------ 调用大模型
export interface AiCallResult { forecast: AiForecast | null; raw: string; usage: { prompt_tokens?: number; completion_tokens?: number }; latency_ms: number; error?: string; model: string }

const SYSTEM = `你是「HashArena 竞技场」的 AI 预测官，负责对一个基于区块哈希的三位数（万/千/百，000-999）开奖序列做量化推理，并给出结构化预测。
你清楚：哈希逐期独立，任何号码理论概率恒为 1/1000；你的任务不是宣称能预测，而是在同一 walk-forward 规则下，综合所有统计信号、各策略近期战绩以及你自己过往预测的复盘，给出你认为「倾向最高」的分布，让真实开奖来检验。
要求：
- 只输出 JSON，字段：regime(string, ≤40字), confidence(0-1), pos_weights(3×10 数组，每位 0-9 的相对权重 0-100，不要全部相同), strategy_blend(对象，key 为基础策略 key，值 0-100), boost(≤30 个三位号字符串), avoid(≤30 个三位号字符串), reasoning(中文 ≤300 字，说明依据与本期与上期思路的差异), next_focus(≤60 字，下期复盘要验证的假设)。
- 认真利用「你上几期的预测与结果」：如果连续失误，要调整思路（例如从追热切换为回补、降低对某策略的信任）；如果命中，说明哪部分假设成立。
- 不要复述数据，直接给出判断。`

export async function callAi(env: AiEnv, ctx: any, opts: { timeoutMs?: number; effort?: 'low' | 'medium' | 'high' } = {}): Promise<AiCallResult> {
  const model = aiModel(env); const t0 = Date.now()
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 40_000)
  try {
    const res = await fetch(`${env.OPENAI_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, reasoning_effort: opts.effort ?? 'medium', response_format: { type: 'json_object' }, max_completion_tokens: 6000,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(ctx) }] }),
    })
    const j: any = await res.json()
    if (!res.ok || j.error) return { forecast: null, raw: JSON.stringify(j).slice(0, 2000), usage: {}, latency_ms: Date.now() - t0, error: j.error?.message || `HTTP ${res.status}`, model }
    const raw = j.choices?.[0]?.message?.content || ''
    let forecast: AiForecast | null = null
    try { forecast = normalize(JSON.parse(raw)) } catch (e: any) { return { forecast: null, raw, usage: j.usage || {}, latency_ms: Date.now() - t0, error: 'bad json: ' + e.message, model } }
    return { forecast, raw, usage: j.usage || {}, latency_ms: Date.now() - t0, model }
  } catch (e: any) {
    return { forecast: null, raw: '', usage: {}, latency_ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e), model }
  } finally { clearTimeout(timer) }
}

function normalize(o: any): AiForecast {
  const clampW = (v: any) => Math.max(0, Math.min(100, Number(v) || 0))
  let pw: number[][] = Array.isArray(o.pos_weights) ? o.pos_weights.slice(0, 3).map((row: any) => Array.isArray(row) ? [...Array(10).keys()].map(i => clampW(row[i])) : Array(10).fill(50)) : []
  while (pw.length < 3) pw.push(Array(10).fill(50))
  pw = pw.map(row => row.every(v => v === 0) ? Array(10).fill(50) : row)
  const blend: Record<string, number> = {}
  if (o.strategy_blend && typeof o.strategy_blend === 'object') for (const [k, v] of Object.entries(o.strategy_blend)) if (STRATEGIES.some(s => s.key === k && !s.meta && !s.control && !s.ai)) blend[k] = clampW(v)
  const nums = (a: any) => Array.isArray(a) ? [...new Set(a.map((x: any) => String(x).replace(/\D/g, '').padStart(3, '0').slice(-3)).filter((x: string) => /^\d{3}$/.test(x)))].slice(0, 30) as string[] : []
  return {
    regime: String(o.regime || '').slice(0, 80), confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0.5)),
    pos_weights: pw, strategy_blend: blend, boost: nums(o.boost), avoid: nums(o.avoid),
    reasoning: String(o.reasoning || '').slice(0, 1200), next_focus: String(o.next_focus || '').slice(0, 200),
  }
}

// ------------------------------------------------------------ 预测 → 1000 维得分
/** vec：各基础策略的 1000 维概率向量（来自 generateRound 内部） */
export function aiScores(f: AiForecast, vec: Record<string, number[]>): number[] {
  const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }
  // 每位权重：加 5 的地板防止 0 概率，再做 0.8 次幂温和化（避免模型过度自信）
  const pd = f.pos_weights.map(row => norm(row.map(v => Math.pow(v + 5, 0.8))))
  const own = new Array<number>(SPACE); for (let i = 0; i < SPACE; i++) own[i] = pd[0][Math.floor(i / 100)] * pd[1][Math.floor(i / 10) % 10] * pd[2][i % 10]
  const bsum = Object.values(f.strategy_blend).reduce((a, b) => a + b, 0)
  const blend = new Array<number>(SPACE).fill(0)
  if (bsum > 0) for (const [k, w] of Object.entries(f.strategy_blend)) { const v = vec[k]; if (!v) continue; for (let i = 0; i < SPACE; i++) blend[i] += (w / bsum) * v[i] }
  else for (let i = 0; i < SPACE; i++) blend[i] = 1 / SPACE
  // 几何融合：自有分布 × 策略融合分布（各占一半），再叠加 boost/avoid
  const out = new Array<number>(SPACE)
  for (let i = 0; i < SPACE; i++) out[i] = Math.sqrt(own[i] * blend[i])
  for (const n of f.boost) out[Number(n)] *= 1.6
  for (const n of f.avoid) out[Number(n)] *= 0.4
  return norm(out)
}

// ------------------------------------------------------------ 持久化 + 编排
export interface AiRow { expect: string; based_on: string; output: string; reasoning: string; regime: string; confidence: number; error: string | null; created_ms: number; model: string; latency_ms: number; prompt_tokens: number; completion_tokens: number }

/** 取 AI 自己最近 k 期预测 + 结算结果（自我复盘素材） */
export async function aiHistory(db: D1Database, source: string, k = 6, beforeExpect?: string) {
  const rows = (await db.prepare(`SELECT f.expect, f.regime, f.confidence, f.reasoning, f.output, f.error, f.created_ms, f.model, f.latency_ms, a.actual, a.hit, a.rank, a.pnl
    FROM ai_forecasts f LEFT JOIN arena_rounds a ON a.source=f.source AND a.expect=f.expect AND a.strategy='ai'
    WHERE f.source=? ${beforeExpect ? 'AND f.expect<?' : ''} ORDER BY f.expect DESC LIMIT ?`).bind(...(beforeExpect ? [source, beforeExpect, k] : [source, k])).all<any>()).results
  return rows.map(r => { let o: any = null; try { o = JSON.parse(r.output) } catch {} return { ...r, next_focus: o?.next_focus || '', boost: o?.boost || [], avoid: o?.avoid || [], pos_weights: o?.pos_weights || null, strategy_blend: o?.strategy_blend || null, output: undefined } })
}

/** 为目标期生成 AI 预测（含调用、落库）；返回 forecast（失败时 null，error 落库） */
export async function forecastFor(db: D1Database, env: AiEnv, source: string, next: string, draws: Draw[], perf: PerfMap, weights: Record<string, any>) {
  const exists = await db.prepare('SELECT output, error FROM ai_forecasts WHERE source=? AND expect=?').bind(source, next).first<any>()
  if (exists) { if (exists.error) return null; try { return normalize(JSON.parse(exists.output)) } catch { return null } }
  const selfHist = await aiHistory(db, source, 6, next)
  const ctx = {
    task: `为期号 ${next} 给出结构化预测（三位号 = 万/千/百）。竞技场每策略每期取 Top ${ARENA_N} 注（理论命中率 50%，保本 52.6%）。`,
    market: digest(draws),
    strategy_leaderboard_rolling40: perfDigest(perf, weights),
    your_recent_forecasts_newest_first: selfHist.map(h => ({ expect: h.expect, regime: h.regime, confidence: h.confidence, next_focus: h.next_focus, boost: h.boost.slice(0, 10), result: h.actual ? { actual: h.actual, hit: !!h.hit, rank: h.rank, pnl: h.pnl } : 'pending', reasoning: (h.reasoning || '').slice(0, 200) })),
  }
  const r = await callAi(env, ctx, { effort: aiEffort(env), timeoutMs: 35_000 })
  const f = r.forecast
  await db.prepare(`INSERT OR IGNORE INTO ai_forecasts (source, expect, model, based_on, output, reasoning, regime, confidence, prompt_tokens, completion_tokens, latency_ms, created_ms, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(source, next, r.model, draws[0].expect, f ? JSON.stringify(f) : r.raw.slice(0, 4000), f?.reasoning || null, f?.regime || null, f?.confidence ?? null, r.usage.prompt_tokens ?? null, r.usage.completion_tokens ?? null, r.latency_ms, Date.now(), r.error || null).run()
  return f
}

// ------------------------------------------------------------ 阶段性分析报告（AI 分析官）
const REPORT_SYSTEM = `你是「HashArena 竞技场」的 AI 分析官。你会收到多策略在同一 walk-forward 规则下的完整战绩（含随机对照组）、组合最优的自适应权重、投资策略模拟结果，以及 AI 预测官自己的逐期表现。
请输出一份中文 Markdown 报告（≤900 字），结构：
## 一句话结论
## 各策略表现解读（哪些跑赢/跑输对照组、是否统计显著、可能原因）
## AI 预测官复盘（命中模式、失误模式、下一阶段调整思路）
## 组合最优权重是否合理（给出你建议的权重方向）
## 下一阶段投资策略（择时/仓位/止损的具体规则；必须明确说明理论期望为负、样本不足处的不确定性）
不要编造数据；引用数字时以输入为准。`

export async function generateReport(db: D1Database, env: AiEnv, source: string, board: any) {
  const latest = board.periods.at(-1)?.expect || '0'
  const exists = await db.prepare('SELECT report, created_ms, model FROM ai_reports WHERE source=? AND expect=?').bind(source, latest).first<any>()
  if (exists) return { ...exists, expect: latest, cached: true }
  const ctx = {
    settled_periods: board.n_periods, odds: board.odds, per_strategy_count: board.per_strategy_count,
    strategies: board.strategies.map((s: any) => ({ key: s.key, name: s.name, n: s.n, hits: s.hits, rate: s.rate, z: s.z, pnl: s.pnl, roi: s.roi, max_dd: s.max_dd, rolling: s.rolling, verdict: s.verdict, control: !!s.control, meta: !!s.meta, ai: !!s.ai })),
    meta_weights: board.weights, plans: board.plans?.map((p: any) => ({ name: p.name, bets: p.bets, skips: p.skips, rate: p.rate, z: p.z, pnl: p.pnl, roi: p.roi, max_dd: p.max_dd })),
    ai_recent: await aiHistory(db, source, 12),
    last_30_settlement: board.periods.slice(-30).map((p: any) => ({ expect: p.expect.slice(-4), actual: p.actual, hits: Object.entries(p.hit).filter(([, v]) => v).map(([k]) => k) })),
  }
  const t0 = Date.now(); const model = aiModel(env)
  const res = await fetch(`${env.OPENAI_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, reasoning_effort: 'medium', max_completion_tokens: 6000, messages: [{ role: 'system', content: REPORT_SYSTEM }, { role: 'user', content: JSON.stringify(ctx) }] }),
  })
  const j: any = await res.json()
  if (!res.ok || j.error) throw new Error(j.error?.message || `HTTP ${res.status}`)
  const report = j.choices?.[0]?.message?.content || ''
  await db.prepare('INSERT OR REPLACE INTO ai_reports (source, expect, model, report, prompt_tokens, completion_tokens, latency_ms, created_ms) VALUES (?,?,?,?,?,?,?,?)')
    .bind(source, latest, model, report, j.usage?.prompt_tokens ?? null, j.usage?.completion_tokens ?? null, Date.now() - t0, Date.now()).run()
  return { report, expect: latest, model, created_ms: Date.now(), latency_ms: Date.now() - t0, cached: false }
}
export async function latestReport(db: D1Database, source: string) {
  return db.prepare('SELECT expect, model, report, created_ms, latency_ms FROM ai_reports WHERE source=? ORDER BY expect DESC LIMIT 1').bind(source).first<any>()
}
