// ============ AI 预测官：把全部量化上下文交给大模型推理 → 结构化预测 → 折算为 1000 维三位号得分 → 作为竞技场选手被真实开奖检验 ============
// 设计原则：
//  1) AI 只拿「目标期之前」的数据（与其他策略同一 walk-forward 规则），输出结构化 JSON 而不是随口报号；
//  2) 每期都把它自己上几期的预测与真实结果喂回去（自我复盘闭环），形成不间断迭代；
//  3) AI 的号码进入 arena_rounds（strategy='ai'），与随机对照组同台结算——它是否有信号由数据说话。
import { type Draw } from './analysis'
import { STRATEGIES, ARENA_N, type PerfMap, type ExtraPlan } from './arena'
import { normalizeRule, describeRule, simulateRule, listAiPlans, saveAiPlans, retirePlans, type PlanRule, MAX_ACTIVE_AI_PLANS } from './ai_plans'

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
  pick_plan: string                               // 选号方案说明：这 500 注应该如何构成（≤200 字）
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
- 只输出 JSON，字段：regime(string, ≤40字), confidence(0-1), pos_weights(3×10 数组，每位 0-9 的相对权重 0-100，不要全部相同), strategy_blend(对象，key 为基础策略 key，值 0-100), boost(≤30 个三位号字符串), avoid(≤30 个三位号字符串), reasoning(中文 ≤300 字，说明依据与本期与上期思路的差异), pick_plan(中文 ≤200 字，面向投注者的选号方案：三位各自重点覆盖哪几个数字、主要参考哪些策略、加注/回避的逻辑，这 500 注就是按你的权重实际生成的), next_focus(≤60 字，下期复盘要验证的假设)。
- pos_weights 是你对 500 注构成的直接控制：权重高的数字会在该位获得更多注数。要有取舍（每位建议 3-5 个重点数字权重明显高于其余），但不要把任何数字压到 0。
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
    reasoning: String(o.reasoning || '').slice(0, 1200), pick_plan: String(o.pick_plan || '').slice(0, 600), next_focus: String(o.next_focus || '').slice(0, 200),
  }
}

// ------------------------------------------------------------ 本期 AI 推荐：500 注 + 对照推理的结构拆解
/** 对一份 500 注做可解释的结构拆解：各位数字覆盖、形态/大小单双分布、加注入选/回避剔除、与其他策略的重合（共识度） */
export function explainPick(f: AiForecast | null, numbers: string[], others: { strategy: string; numbers: string }[]) {
  const posCount = [0, 1, 2].map(() => Array(10).fill(0))
  const shape = { 豹: 0, 顺: 0, 对: 0, 杂: 0 } as Record<string, number>
  const wan = { 大: 0, 小: 0, 单: 0, 双: 0 }
  let sumBig = 0
  for (const n of numbers) {
    const a = +n[0], b = +n[1], c = +n[2]
    posCount[0][a]++; posCount[1][b]++; posCount[2][c]++
    if (a === b && b === c) shape.豹++; else { const s = [a, b, c].sort(); if (s[2] - s[1] === 1 && s[1] - s[0] === 1) shape.顺++; else if (a === b || b === c || a === c) shape.对++; else shape.杂++ }
    a >= 5 ? wan.大++ : wan.小++; a % 2 ? wan.单++ : wan.双++
    if (a + b + c >= 14) sumBig++
  }
  const set = new Set(numbers)
  const focus = posCount.map(row => row.map((c, d) => ({ d, c })).sort((x, y) => y.c - x.c).filter(x => x.c > numbers.length / 10).slice(0, 5))
  const consensus = others.filter(o => o.strategy !== 'ai').map(o => { const arr = o.numbers.split(' '); let k = 0; for (const x of arr) if (set.has(x)) k++; return { strategy: o.strategy, overlap: k, ratio: r3(k / Math.max(1, arr.length)) } }).sort((a, b) => b.overlap - a.overlap)
  const blendSum = f ? Object.values(f.strategy_blend).reduce((a, b) => a + b, 0) : 0
  return {
    count: numbers.length,
    pos_count: posCount,                                              // 3×10：500 注中每位每个数字出现的注数
    pos_focus: focus,                                                 // 每位重点数字（高于均值）
    shape, wan, sum_big: sumBig, sum_small: numbers.length - sumBig,
    blend: f && blendSum > 0 ? Object.entries(f.strategy_blend).map(([k, v]) => ({ strategy: k, share: r3(v / blendSum) })).sort((a, b) => b.share - a.share) : [],
    boost_in: f ? f.boost.filter(n => set.has(n)) : [], boost_out: f ? f.boost.filter(n => !set.has(n)) : [],
    avoid_out: f ? f.avoid.filter(n => !set.has(n)) : [], avoid_in: f ? f.avoid.filter(n => set.has(n)) : [],
    consensus,
  }
}

/** 本期 AI 推荐：优先用 AI 预测官的 500 注；若本期调用失败/超时，用组合最优兜底（明确标注），保证每期都形成一个选择 */
export async function aiPick(db: D1Database, source: string, current: { expect: string; based_on: string; strategies: { strategy: string; numbers: string; count: number; coverage: number; weight: number }[] } | null) {
  if (!current) return null
  const fRow = await db.prepare('SELECT output, error, model, latency_ms, created_ms, prompt_tokens, completion_tokens FROM ai_forecasts WHERE source=? AND expect=?').bind(source, current.expect).first<any>()
  let forecast: AiForecast | null = null
  if (fRow && !fRow.error) { try { forecast = normalize(JSON.parse(fRow.output)) } catch {} }
  const aiRow = current.strategies.find(s => s.strategy === 'ai')
  const metaRow = current.strategies.find(s => s.strategy === 'meta')
  const status: 'ready' | 'thinking' | 'fallback' = aiRow ? 'ready' : (fRow?.error ? 'fallback' : 'thinking')
  const row = aiRow || (status === 'fallback' ? metaRow : null)
  const numbers = row ? row.numbers.split(' ') : []
  return {
    expect: current.expect, based_on: current.based_on, status,
    strategy_used: row ? row.strategy : null, fallback: status === 'fallback', error: fRow?.error || null,
    numbers, count: numbers.length, coverage: row?.coverage ?? null,
    forecast, model: fRow?.model || null, latency_ms: fRow?.latency_ms ?? null, created_ms: fRow?.created_ms ?? null,
    tokens: fRow ? (fRow.prompt_tokens || 0) + (fRow.completion_tokens || 0) : null,
    breakdown: numbers.length ? explainPick(forecast, numbers, current.strategies) : null,
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
  return rows.map(r => { let o: any = null; try { o = JSON.parse(r.output) } catch {} return { ...r, next_focus: o?.next_focus || '', pick_plan: o?.pick_plan || '', boost: o?.boost || [], avoid: o?.avoid || [], pos_weights: o?.pos_weights || null, strategy_blend: o?.strategy_blend || null, output: undefined } })
}

/** 为目标期生成 AI 预测（含调用、落库）；返回 forecast（失败时 null，error 落库） */
export async function forecastFor(db: D1Database, env: AiEnv, source: string, next: string, draws: Draw[], perf: PerfMap, weights: Record<string, any>) {
  const exists = await db.prepare('SELECT output, error FROM ai_forecasts WHERE source=? AND expect=?').bind(source, next).first<any>()
  if (exists) { if (exists.error) return null; try { return normalize(JSON.parse(exists.output)) } catch { return null } }
  const selfHist = await aiHistory(db, source, 6, next)
  const ctx = {
    task: `为期号 ${next} 给出结构化预测（三位号 = 万/千/百）。系统会把你的 pos_weights × strategy_blend × boost/avoid 折算为 1000 个三位号的得分，取 Top ${ARENA_N} 注作为本期推荐直接展示给用户（理论命中率 50%，保本 52.6%）。reasoning 和 pick_plan 要能让用户看懂这 500 注为什么这样选。`,
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
不要编造数据；引用数字时以输入为准。
输入里的 ai_plans 是你（AI 分析官）之前报告提出、已被系统自动落成可回测方案的规则，含「样本内（提出前回测）」与「样本外（提出后实盘逐期验证）」两段战绩——样本外才是对你建议的真实检验。请在「AI 预测官复盘」之后增加一节：
## AI 建议回测复盘（逐条评价之前提出的规则在样本外是否成立、为什么；哪些该保留/修改/淘汰）
在「下一阶段投资策略」中给出 1-3 条**新的、可机械执行**的规则（使用输入 available_metrics 里的指标；每条注明目标策略、条件阈值、仓位、止损），系统会自动把它们变成新的回测方案。`

export async function generateReport(db: D1Database, env: AiEnv, source: string, board: any) {
  const latest = board.periods.at(-1)?.expect || '0'
  const exists = await db.prepare('SELECT report, created_ms, model FROM ai_reports WHERE source=? AND expect=?').bind(source, latest).first<any>()
  if (exists) return { ...exists, expect: latest, cached: true }
  const ctx = {
    settled_periods: board.n_periods, odds: board.odds, per_strategy_count: board.per_strategy_count,
    strategies: board.strategies.map((s: any) => ({ key: s.key, name: s.name, n: s.n, hits: s.hits, rate: s.rate, z: s.z, pnl: s.pnl, roi: s.roi, max_dd: s.max_dd, rolling: s.rolling, verdict: s.verdict, control: !!s.control, meta: !!s.meta, ai: !!s.ai })),
    meta_weights: board.weights, plans: board.plans?.map((p: any) => ({ name: p.name, bets: p.bets, skips: p.skips, rate: p.rate, z: p.z, pnl: p.pnl, roi: p.roi, max_dd: p.max_dd })),
    ai_recent: await aiHistory(db, source, 12),
    ai_plans: (board.plans || []).filter((p: any) => p.ai).map((p: any) => ({ id: p.plan_id, name: p.name, rule_text: p.desc, proposed_after: p.report_expect, in_sample_plus_forward: { bets: p.bets, skips: p.skips, rate: p.rate, z: p.z, pnl: p.pnl, roi: p.roi, max_dd: p.max_dd }, out_of_sample: p.forward || 'no periods yet' })),
    ai_plans_retired: (await listAiPlans(db, source, true)).filter(r => r.retired_ms).slice(-5).map(r => ({ name: r.name, reason: r.retire_reason })),
    available_metrics: RULE_HINT,
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
  // 二阶闭环：把报告里的投资规则抽取成结构化 DSL → 落库 → 之后每次战绩榜自动 walk-forward 回测（样本外从 latest 之后开始）
  let plans_added = 0, plans_error: string | null = null
  try { const rules = await extractRules(env, report); plans_added = await saveAiPlans(db, source, latest, model, rules) } catch (e: any) { plans_error = String(e.message || e) }
  return { report, expect: latest, model, created_ms: Date.now(), latency_ms: Date.now() - t0, cached: false, plans_added, plans_error }
}

// ------------------------------------------------------------ 二阶闭环：报告 → 规则 DSL → 自动回测方案
const RULE_HINT = {
  metrics: { roll_z: '某策略近 window 期滚动 z（需 strategy, window 5-100）', roll_rate: '某策略近 window 期命中率 0-1', miss_streak: '某策略当前连续未中期数', hit_streak: '某策略当前连续命中期数', meta_weight: '某基础策略在组合最优里的当前权重 0-1', best_z: '全部基础策略中最高的滚动 z（无 strategy）' },
  ops: ['>', '>=', '<', '<='],
  strategies: STRATEGIES.filter(s => !s.ai).map(s => s.key),
  target_kinds: { fixed: '固定投 strategy', best_z: '投滚动 z 最高的基础策略', worst_z: '投滚动 z 最低（逆向）', best_rate: '投滚动命中率最高' },
  sizing: '仓位倍数 0.5-2：base + high_if/low_if 条件', risk: 'stop_after_misses(自身连败停投) + pause_periods(停几期) + max_drawdown(累计回撤超过则暂停，单位为「注」：每次下注 500 注、未中亏 500，合理范围 2000-20000；不要写比例)',
}
const RULE_SYSTEM = `你是规则编译器。把一份 HashArena 分析报告中「下一阶段投资策略」部分的可执行建议，编译成 1-3 条结构化规则 JSON。只输出 JSON：{"rules":[{"name":"≤16字","rationale":"≤80字依据","target":{"kind":"fixed|best_z|worst_z|best_rate","strategy":"仅fixed","window":40,"min_n":10,"fallback":"策略key或null(观望)"},"conditions":[{"metric":"roll_z","strategy":"cold","window":40,"op":">","value":0.5}],"any_conditions":[],"sizing":{"base":1,"high":1.5,"low":0.5,"high_if":[...],"low_if":[...]},"risk":{"stop_after_misses":3,"pause_periods":10,"max_drawdown":10000}}]}
约束：只能使用给定 metrics/ops/strategies/target_kinds；条件必须能在「该期之前的已结算数据」上计算；sizing/risk 可省略；不要输出解释。`
export async function extractRules(env: AiEnv, report: string): Promise<PlanRule[]> {
  const res = await fetch(`${env.OPENAI_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: aiModel(env), reasoning_effort: 'low', response_format: { type: 'json_object' }, max_completion_tokens: 3000,
      messages: [{ role: 'system', content: RULE_SYSTEM }, { role: 'user', content: JSON.stringify({ schema_hint: RULE_HINT, report }) }] }),
  })
  const j: any = await res.json()
  if (!res.ok || j.error) throw new Error(j.error?.message || `HTTP ${res.status}`)
  const o = JSON.parse(j.choices?.[0]?.message?.content || '{}')
  return (Array.isArray(o.rules) ? o.rules : []).map(normalizeRule).filter(Boolean).slice(0, 3) as PlanRule[]
}
/** 供 arenaBoard 使用：把库中活跃的 AI 方案包装为 ExtraPlan（同一序列上 walk-forward，样本外从 report_expect 之后算起） */
export async function aiExtraPlans(db: D1Database, source: string): Promise<ExtraPlan[]> {
  const rows = await listAiPlans(db, source)
  return rows.map(r => { let rule: PlanRule | null = null; try { rule = normalizeRule(JSON.parse(r.rule)) } catch {} if (!rule) return null
    return { key: `ai-plan-${r.id}`, id: r.id, name: `AI·${r.name}`, desc: describeRule(rule), since: r.report_expect, rationale: r.rationale || '', created_ms: r.created_ms, simulate: (periods) => simulateRule(rule!, periods, r.report_expect) } }).filter(Boolean) as ExtraPlan[]
}
/** 根据最新战绩榜执行淘汰（样本外显著劣于基线 / 超出活跃上限） */
export async function aiPlansMaintain(db: D1Database, source: string, board: any) {
  const ev = (board.plans || []).filter((p: any) => p.ai).map((p: any) => ({ id: p.plan_id, forward: p.forward }))
  return ev.length ? retirePlans(db, source, ev) : 0
}
export { MAX_ACTIVE_AI_PLANS }
export async function latestReport(db: D1Database, source: string) {
  return db.prepare('SELECT expect, model, report, created_ms, latency_ms FROM ai_reports WHERE source=? ORDER BY expect DESC LIMIT 1').bind(source).first<any>()
}
