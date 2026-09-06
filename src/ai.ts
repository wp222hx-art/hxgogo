// ============ AI 预测官：把全部量化上下文交给大模型推理 → 结构化预测 → 折算为 1000 维三位号得分 → 作为竞技场选手被真实开奖检验 ============
// 设计原则：
//  1) AI 只拿「目标期之前」的数据（与其他策略同一 walk-forward 规则），输出结构化 JSON 而不是随口报号；
//  2) 每期都把它自己上几期的预测与真实结果喂回去（自我复盘闭环），形成不间断迭代；
//  3) AI 的号码进入 arena_rounds（strategy='ai'），与随机对照组同台结算——它是否有信号由数据说话。
import { normalizeDistribution, type Draw } from './analysis'
import { STRATEGIES, ARENA_N, AI_SUBSETS, AI_SHARP, rollingZ, insertRounds, verifiedLiveSql, type PerfMap, type ExtraPlan } from './arena'
import { normalizeRule, describeRule, simulateRule, listAiPlans, saveAiPlans, retirePlans, type PlanRule, MAX_ACTIVE_AI_PLANS } from './ai_plans'
import { parseCustomNs } from './config'

export interface AiEnv {
  // DeepSeek（优先）：只需 key，base 默认官方；模型默认 deepseek-v4-flash 非思考模式（延迟最低）
  DEEPSEEK_API_KEY?: string; DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string      // deepseek-v4-flash（默认）| deepseek-v4-pro | deepseek-v4-flash-vision-exp（旧名 deepseek-chat/reasoner 已于 2026-07-24 停用）
  DEEPSEEK_THINKING?: string   // off | low | high | max —— V4 思考模式开关与强度；默认 off（非思考，最快）；开启后 temperature 无效
  // OpenAI 兼容（备用）
  OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string
  AI_PROVIDER?: string       // 'deepseek' | 'openai'，缺省：有 DEEPSEEK_API_KEY 则 deepseek，否则 openai
  AI_MODEL?: string; AI_EFFORT?: string
  AI_LEAD_MS?: string        // 报单窗口：AI 必须在「下期开奖时刻 − AI_LEAD_MS」之前锁定，默认 20000
  AI_TIMEOUT_MS?: string     // 单次调用上限，默认 25000（会被报单截止进一步裁剪）
  AI_CUSTOM_N?: string       // 自定义精选注数（逗号分隔，如 "200,250"）：定义后每期同步生成 ai-custom-N 并独立结算
}
export interface AiProvider { name: 'deepseek' | 'openai' | 'local'; key: string; base: string; model: string; thinking?: DsThinking }
export type DsThinking = 'off' | 'low' | 'high' | 'max'
/** DeepSeek V4 模型目录（官方 api-docs 2026-08）：供配置页罗列与校验时核对 */
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', version: 'DeepSeek-V4-Flash-0731', tag: '推荐', desc: '轻量旗舰：1M 上下文，思考/非思考双模式，JSON 输出，并发 2500', price: { in_miss: 0.44, in_hit: 0.014, out: 1.32 }, speed: { off: '2–5s', low: '5–12s', high: '15–40s', max: '40s+' } },
  { id: 'deepseek-v4-pro', version: 'DeepSeek-V4-Pro-0813', tag: '最强', desc: '旗舰推理：HLE 42.7/60.0，Agent 能力最强，价格 ×3，并发 500', price: { in_miss: 1.32, in_hit: 0.044, out: 3.96 }, speed: { off: '4–8s', low: '8–20s', high: '20–60s', max: '60s+' } },
  { id: 'deepseek-v4-flash-vision-exp', version: 'DeepSeek-V4-Flash-Vision-Exp', tag: '实验', desc: '多模态实验版：纯文本能力同 Flash，额外接受图片输入', price: { in_miss: 0.44, in_hit: 0.014, out: 1.32 }, speed: { off: '2–5s', low: '5–12s', high: '15–40s', max: '40s+' } },
] as const
export const DEEPSEEK_LEGACY: Record<string, string> = { 'deepseek-chat': 'deepseek-v4-flash', 'deepseek-reasoner': 'deepseek-v4-flash' }
export const dsThinking = (env: AiEnv): DsThinking => (['off', 'low', 'high', 'max'].includes(env.DEEPSEEK_THINKING || '') ? env.DEEPSEEK_THINKING : ((env.DEEPSEEK_MODEL || env.AI_MODEL) === 'deepseek-reasoner' ? 'low' : 'off')) as DsThinking
/** 旧名自动映射到 V4（deepseek-chat → v4-flash 非思考；deepseek-reasoner → v4-flash 思考）；空 → v4-flash */
const dsModel = (m: string) => { const x = (m || '').trim(); if (!x) return 'deepseek-v4-flash'; return DEEPSEEK_LEGACY[x] || x }
export function aiProvider(env: AiEnv): AiProvider | null {
  const want = (env.AI_PROVIDER || '').toLowerCase()
  if (want === 'disabled') return null
  if (want === 'local') {
    try {
      const url = new URL(env.OPENAI_BASE_URL || '')
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !env.AI_MODEL?.trim()) return null
      return { name: 'local', key: '', base: url.href.replace(/\/$/, ''), model: env.AI_MODEL.trim() }
    } catch { return null }
  }
  const ds = env.DEEPSEEK_API_KEY ? { name: 'deepseek' as const, key: env.DEEPSEEK_API_KEY, base: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''), model: dsModel(env.DEEPSEEK_MODEL || (env.AI_MODEL && /^deepseek/i.test(env.AI_MODEL) ? env.AI_MODEL : '')), thinking: dsThinking(env) } : null
  const oa = env.OPENAI_API_KEY && env.OPENAI_BASE_URL ? { name: 'openai' as const, key: env.OPENAI_API_KEY, base: env.OPENAI_BASE_URL.replace(/\/$/, ''), model: (env.AI_MODEL && !/^deepseek/i.test(env.AI_MODEL) ? env.AI_MODEL : 'gpt-5-mini') } : null
  if (want === 'deepseek') return ds
  if (want === 'openai') return oa
  return ds || oa
}
export const aiEnabled = (env: AiEnv) => !!aiProvider(env)
export const aiModel = (env: AiEnv) => aiProvider(env)?.model || null
export const aiProviderName = (env: AiEnv) => aiProvider(env)?.name || null
/** 逐期预测的推理强度（仅 OpenAI 推理模型使用；DeepSeek 忽略） */
export const aiEffort = (env: AiEnv): 'low' | 'medium' | 'high' => (['low', 'medium', 'high'].includes(env.AI_EFFORT || '') ? env.AI_EFFORT : 'low') as any
export const aiLeadMs = (env: AiEnv) => { const n = Number(env.AI_LEAD_MS); return Number.isFinite(n) && n >= 5000 ? n : 20_000 }
/** 思考模式最低预算：低于此值自动降级为非思考。实测 v4-flash think-low 在完整预测官上下文下 >25s，1 分钟厅（预算 ≤55s）不可行；三分厅以上才开 */
export const THINK_MIN_BUDGET_MS = 90_000
export const aiTimeoutMs = (env: AiEnv) => { const n = Number(env.AI_TIMEOUT_MS); return Number.isFinite(n) && n >= 3000 ? n : 25_000 }

/** 统一的 chat 调用：屏蔽 DeepSeek / OpenAI 参数差异；json=true 时尽力要求 JSON 并稳健解析 */
export interface ChatResult { ok: boolean; content: string; reasoning_content?: string; usage: { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number; cache_hit?: number }; latency_ms: number; error?: string; model: string; provider: string; request?: any }
/** 构造请求体（导出供配置页「请求预览」使用） */
export function buildChatBody(pv: AiProvider, opts: { json?: boolean; maxTokens?: number; effort?: 'low' | 'medium' | 'high'; temperature?: number }, messages: any[]) {
  const body: any = { model: pv.model, messages }
  if (pv.name === 'deepseek') {
    const th = pv.thinking || 'off'
    body.max_tokens = Math.min(8000, opts.maxTokens ?? 1500)
    // V4 思考模式：thinking.type + reasoning_effort(low/high/max)；思考开启时 temperature 等采样参数无效
    body.thinking = { type: th === 'off' ? 'disabled' : 'enabled' }
    if (th !== 'off') body.reasoning_effort = th
    else if (opts.temperature != null) body.temperature = opts.temperature
    if (opts.json) body.response_format = { type: 'json_object' }
  } else if (pv.name === 'local') {
    body.max_tokens = opts.maxTokens ?? 1500
    if (opts.temperature != null) body.temperature = opts.temperature
    if (opts.json) body.response_format = { type: 'json_object' }
  } else {
    body.reasoning_effort = opts.effort ?? 'low'
    body.max_completion_tokens = opts.maxTokens ?? 6000
    if (opts.json) body.response_format = { type: 'json_object' }
  }
  return body
}
export async function llmChat(env: AiEnv, opts: { system: string; user: string; json?: boolean; maxTokens?: number; effort?: 'low' | 'medium' | 'high'; timeoutMs?: number; temperature?: number }): Promise<ChatResult> {
  const pv = aiProvider(env); const t0 = Date.now()
  if (!pv) return { ok: false, content: '', usage: {}, latency_ms: 0, error: 'AI 未配置', model: '', provider: '' }
  const messages = [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }]
  const body = buildChatBody(pv, opts, messages)
  if (pv.name === 'deepseek' && pv.thinking !== 'off') body.max_tokens = Math.min(16000, (opts.maxTokens ?? 1500) + 6000)   // 思考模式：给思维链留额度
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? aiTimeoutMs(env))
  try {
    const res = await fetch(`${pv.base}/chat/completions`, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', ...(pv.key ? { Authorization: `Bearer ${pv.key}` } : {}) }, body: JSON.stringify(body) })
    const text = await res.text()                       // 读体阶段的 abort 会在此抛出 → 走 catch 记 timeout，而不是被吞成空内容
    let j: any; try { j = JSON.parse(text) } catch { return { ok: false, content: text.slice(0, 500), usage: {}, latency_ms: Date.now() - t0, error: `non-json response HTTP ${res.status}`, model: pv.model, provider: pv.name } }
    if (!res.ok || j.error) return { ok: false, content: JSON.stringify(j).slice(0, 2000), usage: {}, latency_ms: Date.now() - t0, error: j.error?.message || `HTTP ${res.status}`, model: pv.model, provider: pv.name }
    const msg = j.choices?.[0]?.message || {}
    const u = j.usage || {}
    const usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens, cache_hit: u.prompt_cache_hit_tokens }
    if (!msg.content && msg.reasoning_content) return { ok: false, content: '', reasoning_content: msg.reasoning_content, usage, latency_ms: Date.now() - t0, error: 'thinking consumed all tokens (no final content)', model: pv.model, provider: pv.name }
    return { ok: true, content: msg.content || '', reasoning_content: msg.reasoning_content || undefined, usage, latency_ms: Date.now() - t0, model: pv.model, provider: pv.name, request: { ...body, messages: undefined } }
  } catch (e: any) {
    return { ok: false, content: '', usage: {}, latency_ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e), model: pv.model, provider: pv.name }
  } finally { clearTimeout(timer) }
}
/** 从模型文本里稳健取出 JSON（容忍 ```json 围栏、前后废话） */
export function parseJson(raw: string): any {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try { return JSON.parse(s) } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1))
  throw new Error('no json object')
}
const SPACE = 1000
const no3 = (i: number) => String(i).padStart(3, '0')
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** 大模型输出的结构化预测 */
export interface AiForecast {
  regime: string                                  // 对当前盘面的判断（如「万位大数连开、形态回归杂六」）
  confidence: number                              // Legacy alias for self-report, never a hit probability.
  self_reported_confidence?: number | null
  confidence_kind?: 'self_reported_not_probability'
  calibrated?: false
  evidence_status?: 'insufficient' | 'hypothesis'
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
  return STRATEGIES.filter(s => !s.ai && !s.derived).map(s => {
    const rows = (perf[s.key] || []).slice(-40); const n = rows.length, h = rows.reduce((a, r) => a + r.hit, 0)
    const z = n ? (h - n * 0.5) / Math.sqrt(n * 0.25 || 1) : 0
    return { key: s.key, name: s.name, rolling40: n ? { n, hits: h, rate: r3(h / n), z: r3(z) } : null, blend_eligible: n > 0 && z > 0, meta_weight: weights[s.key]?.w ?? null, last10: rows.slice(-10).map(r => r.hit).join('') }
  })
}

// ------------------------------------------------------------ 调用大模型
export interface AiCallResult { forecast: AiForecast | null; raw: string; cot?: string; usage: { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number }; latency_ms: number; error?: string; model: string }

export const FORECAST_SYSTEM = `你是「HashArena 竞技场」的统计研究助手，对区块哈希生成的三位数（000-999）提出可检验的排序假设。
在独立均匀假设下，每个三位号的理论概率为 1/1000。历史冷热、遗漏、连开和短期策略冠军不能直接证明下一期可预测。
要求：
- 只输出 JSON：regime(string, ≤40字), evidence_status("insufficient"|"hypothesis"), confidence(0-1，仅模型对解释的主观自评，绝不是命中概率), pos_weights(3×10 数组，0-100，相同权重完全合法), strategy_blend(对象), boost(≤30 个严格三位数字字符串), avoid(同上), reasoning(中文 ≤200 字), pick_plan(中文 ≤150 字，描述排序构成和验证限制), next_focus(≤60 字，可被未来数据否证的假设)。
- 缺少可重复的独立样本外证据时，应明确 evidence_status="insufficient"，每位给相同权重，strategy_blend={}、boost=[]、avoid=[]。允许且鼓励回答“证据不足”。
- 若提出非均匀排序，只能标为 hypothesis，明确这只是待验证假设。不得把归一化排序分、机制共识或 confidence 解释成真实命中概率。
- 滚动 z>0 只是近期高于基线，不代表统计显著或正收益。blend_eligible 是兼容性的实验过滤器，不是优势证明；可以不用任何策略。
- 连续失误不要求改成追冷，单次命中不能证明假设成立。保持事先确定的规则与观察窗口，累计足够的未来样本后再评价。
- 多个档位和来源高度相关；从中挑最高战绩存在选择偏差。不要因某档位近期领先就集中或增加投入，不给加注、追损或收益保证。
- 直接输出 JSON，须在开奖前锁定；reasoning 可以明确“本期没有新证据”。`

export async function callAi(env: AiEnv, ctx: any, opts: { timeoutMs?: number; effort?: 'low' | 'medium' | 'high' } = {}): Promise<AiCallResult> {
  const r = await llmChat(env, { system: FORECAST_SYSTEM, user: JSON.stringify(ctx), json: true, maxTokens: aiProvider(env)?.name === 'deepseek' ? 1500 : 6000, effort: opts.effort ?? 'low', timeoutMs: opts.timeoutMs, temperature: 0.2 })
  const pv = aiProvider(env)
  const model = `${r.provider}:${r.model}` + (pv?.name === 'deepseek' && pv.thinking !== 'off' ? `:think-${pv.thinking}` : '')
  if (!r.ok) return { forecast: null, raw: r.content, usage: {}, latency_ms: r.latency_ms, error: r.error, model }
  let forecast: AiForecast | null = null
  try { forecast = normalize(parseJson(r.content)) } catch (e: any) { return { forecast: null, raw: r.content, cot: r.reasoning_content, usage: r.usage, latency_ms: r.latency_ms, error: 'bad json: ' + e.message, model } }
  return { forecast, raw: r.content, cot: r.reasoning_content, usage: r.usage, latency_ms: r.latency_ms, model }
}

export function normalize(o: any): AiForecast {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('forecast must be a JSON object')
  const clampW = (v: any) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0 }
  let pw: number[][] = Array.isArray(o.pos_weights) ? o.pos_weights.slice(0, 3).map((row: any) => Array.isArray(row) ? [...Array(10).keys()].map(i => clampW(row[i])) : Array(10).fill(50)) : []
  while (pw.length < 3) pw.push(Array(10).fill(50))
  pw = pw.map(row => row.every(v => v === 0) ? Array(10).fill(50) : row)
  const blend: Record<string, number> = {}
  if (o.strategy_blend && typeof o.strategy_blend === 'object') for (const [k, v] of Object.entries(o.strategy_blend)) if (STRATEGIES.some(s => s.key === k && !s.meta && !s.control && !s.ai)) blend[k] = clampW(v)
  // Reject malformed identifiers rather than turning "bad", "1000" or "" into a real number.
  const nums = (a: any): string[] => Array.isArray(a) ? [...new Set(a.filter((x: any) => typeof x === 'string' && /^[0-9]{3}$/.test(x)))].slice(0, 30) as string[] : []
  let boost = nums(o.boost), avoid = nums(o.avoid)
  const hasHypothesis = pw.some(row => row.some(v => v !== row[0])) || boost.length > 0 || avoid.length > 0 || Object.values(blend).some(w => w > 0)
  const evidence = o.evidence_status === 'insufficient' ? 'insufficient' : o.evidence_status === 'hypothesis' || hasHypothesis ? 'hypothesis' : 'insufficient'
  if (evidence === 'insufficient') { pw = [0, 1, 2].map(() => Array(10).fill(50)); for (const k of Object.keys(blend)) delete blend[k]; boost = []; avoid = [] }
  const rawConfidence = o.self_reported_confidence ?? o.confidence
  const parsedConfidence = rawConfidence == null ? NaN : Number(rawConfidence)
  const confidence = Number.isFinite(parsedConfidence) ? Math.max(0, Math.min(1, parsedConfidence)) : null
  return {
    regime: String(o.regime || (evidence === 'insufficient' ? '证据不足' : '待验证假设')).slice(0, 80),
    confidence: confidence ?? 0, self_reported_confidence: confidence, confidence_kind: 'self_reported_not_probability', calibrated: false, evidence_status: evidence,
    pos_weights: pw, strategy_blend: blend, boost, avoid,
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
export async function aiPick(db: D1Database, source: string, current: { expect: string; based_on: string; strategies: { strategy: string; numbers: string; count: number; coverage: number; weight: number }[] } | null, customN?: string | null) {
  if (!current) return null
  const fRow = await db.prepare('SELECT output, error, model, latency_ms, created_ms, prompt_tokens, completion_tokens FROM ai_forecasts WHERE source=? AND expect=?').bind(source, current.expect).first<any>()
  let forecast: AiForecast | null = null
  if (fRow && !fRow.error) { try { forecast = normalize(JSON.parse(fRow.output)) } catch {} }
  const aiRow = current.strategies.find(s => s.strategy === 'ai')
  const metaRow = current.strategies.find(s => s.strategy === 'meta')
  // A 方案 · 自我守门：AI 最近 AI_GUARD_K 期滚动 z 低于 AI_GUARD_Z → 本期推荐改用组合最优（AI 号码仍照常入榜结算，守门只影响「推荐给用户的那份」）
  const g = (await db.prepare(`SELECT hit, count FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL AND ${verifiedLiveSql()} ORDER BY expect DESC LIMIT ?`).bind(source, AI_GUARD_K).all<any>()).results
  const gn = g.length, gh = g.reduce((a, r) => a + (r.hit ? 1 : 0), 0), gexp = g.reduce((a, r) => a + r.count / SPACE, 0), gvar = g.reduce((a, r) => a + (r.count / SPACE) * (1 - r.count / SPACE), 0)
  const guardZ = gn >= 20 && gvar > 0 ? r3((gh - gexp) / Math.sqrt(gvar)) : null
  const guarded = guardZ != null && guardZ < AI_GUARD_Z && !!metaRow
  const status: 'ready' | 'thinking' | 'fallback' = aiRow ? 'ready' : (fRow?.error ? 'fallback' : 'thinking')
  const row = guarded && status !== 'thinking' ? metaRow! : (aiRow || (status === 'fallback' ? metaRow : null))
  const numbers = row ? row.numbers.split(' ') : []
  // 各档位：每档都是独立生成（不是 500 注前缀）——号码直接取该档自己的 arena_rounds 行；无行（改造前/AI 未就绪）时退化为主榜前缀并标注 from_prefix
  const customDefs = parseCustomNs(customN).map(n => ({ key: `ai-custom-${n}`, n, name: `AI 自定义 ${n} 注`, short: `AI·${n}`, color: '#a78bfa', custom: true, sharp: false }))
  const sharpDefs = AI_SHARP.map(x => ({ key: x.key, n: x.n, name: x.name, short: x.short, color: x.color, custom: false, sharp: true }))
  const allDefs = [...AI_SUBSETS.map(x => ({ key: x.key, n: x.n, name: x.name, short: x.short, color: x.color, custom: false, sharp: false })), ...customDefs, ...sharpDefs].sort((a, b) => a.n - b.n || (a.sharp ? -1 : 1))
  const subsets = await Promise.all(allDefs.map(async sub => {
    const st = await db.prepare(`SELECT COUNT(*) n, SUM(hit) h, SUM(pnl) pnl FROM arena_rounds WHERE source=? AND strategy=? AND scored_ms IS NOT NULL AND ${verifiedLiveSql()}`).bind(source, sub.key).first<any>()
    const streak = (await db.prepare(`SELECT hit FROM arena_rounds WHERE source=? AND strategy=? AND scored_ms IS NOT NULL AND ${verifiedLiveSql()} ORDER BY expect DESC LIMIT 20`).bind(source, sub.key).all<any>()).results.map(r => r.hit ? 1 : 0)
    const n = st?.n || 0, h = st?.h || 0, p = sub.n / SPACE
    const ownRow = current.strategies.find(s => s.strategy === sub.key)
    const nums = ownRow ? ownRow.numbers.split(' ') : (row ? numbers.slice(0, sub.n) : [])
    const overlapMain = ownRow && numbers.length ? nums.filter(x => numbers.includes(x)).length : null
    return { key: sub.key, n_pick: sub.n, name: sub.name, short: sub.short, color: sub.color, custom: sub.custom, sharp: sub.sharp, breakeven: r3(sub.n / 950), numbers: nums, from: ownRow ? 'own' : (row ? row.strategy + ':prefix' : null), independent: !!ownRow, overlap_main: overlapMain, record: n ? { n, hits: h, rate: r3(h / n), pnl: st.pnl || 0, z: r3((h - n * p) / Math.sqrt(n * p * (1 - p))), roi: r3((st.pnl || 0) / (n * sub.n)), streak } : null }
  }))
  return {
    expect: current.expect, based_on: current.based_on, status, subsets,
    strategy_used: row ? row.strategy : null, fallback: status === 'fallback', error: fRow?.error || null,
    guard: { k: AI_GUARD_K, min_z: AI_GUARD_Z, z: guardZ, n: gn, active: guarded },
    numbers, count: numbers.length, coverage: row?.coverage ?? null, baseline_probability: numbers.length / SPACE, calibrated_probability: null, probability_kind: 'uncalibrated_score',
    forecast, model: fRow?.model || null, latency_ms: fRow?.latency_ms ?? null, created_ms: fRow?.created_ms ?? null,
    tokens: fRow ? (fRow.prompt_tokens || 0) + (fRow.completion_tokens || 0) : null,
    breakdown: numbers.length ? explainPick(forecast, numbers, current.strategies) : null,
  }
}

// ------------------------------------------------------------ 预测 → 1000 维得分
/** vec：各基础策略的 1000 维概率向量（来自 generateRound 内部） */
/** AI 落地参数（A 方案）：
 *  These fixed experimental weights define a ranking, not calibrated probabilities.
 *  Positive recent z is only a compatibility filter, not evidence of predictive advantage. */
export const AI_POS_POW = 1.0, AI_OWN_SHARE = 0.65
/** 守门：AI 最近 K 期滚动 z < MIN_Z 时，推荐面板改用组合最优 */
export const AI_GUARD_K = 40, AI_GUARD_Z = -1.0
export function aiScores(f: AiForecast, vec: Record<string, number[]>, perf?: PerfMap): number[] {
  const norm = normalizeDistribution
  const pd = f.pos_weights.map(row => norm(row.map(v => Math.pow(v + 5, AI_POS_POW))))
  const own = new Array<number>(SPACE); for (let i = 0; i < SPACE; i++) own[i] = pd[0][Math.floor(i / 100)] * pd[1][Math.floor(i / 10) % 10] * pd[2][i % 10]
  // 只保留 z>0 的策略（有 perf 时）；perf 缺省（旧调用）则不过滤
  const blendW: Record<string, number> = {}
  for (const [k, w] of Object.entries(f.strategy_blend)) { if (!vec[k] || w <= 0) continue; if (perf && rollingZ(perf, k).z <= 0) continue; blendW[k] = w }
  const bsum = Object.values(blendW).reduce((a, b) => a + b, 0)
  const blend = new Array<number>(SPACE).fill(0)
  if (bsum > 0) for (const [k, w] of Object.entries(blendW)) { const v = vec[k]; for (let i = 0; i < SPACE; i++) blend[i] += (w / bsum) * v[i] }
  else for (let i = 0; i < SPACE; i++) blend[i] = 1 / SPACE
  const out = new Array<number>(SPACE)
  for (let i = 0; i < SPACE; i++) out[i] = Math.pow(own[i], AI_OWN_SHARE) * Math.pow(blend[i], 1 - AI_OWN_SHARE)
  for (const n of f.boost) out[Number(n)] *= 1.6
  for (const n of f.avoid) out[Number(n)] *= 0.4
  return norm(out)
}

// ------------------------------------------------------------ 持久化 + 编排
export interface AiRow { expect: string; based_on: string; output: string; reasoning: string; regime: string; confidence: number; error: string | null; created_ms: number; model: string; latency_ms: number; prompt_tokens: number; completion_tokens: number }

/** 取 AI 自己最近 k 期预测 + 结算结果（自我复盘素材） */
export async function aiHistory(db: D1Database, source: string, k = 6, beforeExpect?: string) {
  const rows = (await db.prepare(`SELECT f.expect, f.regime, f.confidence, f.reasoning, f.output, f.error, f.created_ms, f.model, f.latency_ms, a.actual, a.hit, a.rank, a.pnl, a.mode, a.prediction_status, a.prediction_version, a.cutoff_ms, a.created_ms AS round_created_ms
    FROM ai_forecasts f LEFT JOIN arena_rounds a ON a.source=f.source AND a.expect=f.expect AND a.strategy='ai'
    WHERE f.source=? ${beforeExpect ? 'AND f.expect<?' : ''} ORDER BY f.expect DESC LIMIT ?`).bind(...(beforeExpect ? [source, beforeExpect, k] : [source, k])).all<any>()).results
  return rows.map(r => { let o: any = null; try { o = JSON.parse(r.output) } catch {} return { ...r, confidence_kind: 'self_reported_not_probability', self_reported_confidence: r.confidence ?? null, calibrated: false, evidence_eligible: r.mode === 'live' && r.prediction_status === 'live' && typeof r.prediction_version === 'string' && r.prediction_version !== 'legacy-unverified' && r.cutoff_ms != null && r.round_created_ms < r.cutoff_ms, next_focus: o?.next_focus || '', pick_plan: o?.pick_plan || '', boost: o?.boost || [], avoid: o?.avoid || [], pos_weights: o?.pos_weights || null, strategy_blend: o?.strategy_blend || null, output: undefined } })
}

/** 档位学习摘要：AI 各精选档位（100/150/300/500 + 自定义）近 K 期与全历史的命中率 vs 保本、z、ROI，以及命中位次分布——反馈给模型，让它知道自己的信号集中在头部还是尾部 */
export async function tierDigest(db: D1Database, source: string, beforeExpect: string, customNs: number[]) {
  const rows = (await db.prepare(`SELECT hit, rank FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL AND ${verifiedLiveSql()} AND expect<? ORDER BY expect DESC LIMIT 400`).bind(source, beforeExpect).all<any>()).results
  if (!rows.length) return null
  // 各档位（独立生成 + 自定义 + 二级精准）用自己的真实结算行
  const defs = [...AI_SUBSETS.map(x => ({ key: x.key, N: x.n, kind: 'independent' })), ...customNs.map(n => ({ key: `ai-custom-${n}`, N: n, kind: 'custom' })), ...AI_SHARP.map(x => ({ key: x.key, N: x.n, kind: 'sharp' })), { key: 'ai', N: 500, kind: 'main' }].sort((a, b) => a.N - b.N)
  const statKey = async (key: string, N: number, limit: number) => {
    const rs = (await db.prepare(`SELECT hit FROM arena_rounds WHERE source=? AND strategy=? AND scored_ms IS NOT NULL AND ${verifiedLiveSql()} AND expect<? ORDER BY expect DESC LIMIT ?`).bind(source, key, beforeExpect, limit).all<any>()).results
    const n = rs.length, h = rs.filter(r => r.hit).length, p = N / SPACE
    return n ? { N, n, rate: r3(h / n), breakeven: r3(N / 950), edge: r3(h / n - N / 950), z: r3((h - n * p) / Math.sqrt(n * p * (1 - p) || 1)), roi: r3((h * (950 - N) - (n - h) * N) / (n * N)) } : { N, n: 0, rate: null, breakeven: r3(N / 950), edge: null, z: null, roi: null }
  }
  const tiers_all: any[] = [], tiers_recent60: any[] = []
  for (const d of defs) { tiers_all.push({ key: d.key, kind: d.kind, ...(await statKey(d.key, d.N, 400)) }); tiers_recent60.push({ key: d.key, kind: d.kind, ...(await statKey(d.key, d.N, 60)) }) }
  // 主榜命中位次分布：命中时落在前 100 / 101–200 / 201–300 / 301–500 的比例（衡量 500 注排序质量）
  const hits = rows.filter(r => r.hit && r.rank != null); const bucket = [0, 0, 0, 0]
  for (const r of hits) bucket[r.rank <= 100 ? 0 : r.rank <= 200 ? 1 : r.rank <= 300 ? 2 : 3]++
  return { periods: rows.length, tiers_all, tiers_recent60, hit_rank_distribution: { '1-100': bucket[0], '101-200': bucket[1], '201-300': bucket[2], '301-500': bucket[3], expected_if_uniform: [Math.round(hits.length * 0.2), Math.round(hits.length * 0.2), Math.round(hits.length * 0.2), Math.round(hits.length * 0.4)] },
    hint: '这些相关档位的历史差异仅供提出假设；回放与实时记录须分开评价。不要因短期正 edge 或单次命中调整集中度、放大权重或认定假设成立；规则须冻结后在未来样本验证。' }
}

/** 为目标期生成 AI 预测（含调用、落库）；返回 forecast（失败时 null，error 落库） */
export async function forecastFor(db: D1Database, env: AiEnv, source: string, next: string, draws: Draw[], perf: PerfMap, weights: Record<string, any>, opts: { lockByMs?: number; trigger?: string } = {}) {
  const startedMs = Date.now()
  const exists = await db.prepare('SELECT output, error FROM ai_forecasts WHERE source=? AND expect=?').bind(source, next).first<any>()
  if (exists) { if (exists.error) return null; try { return normalize(JSON.parse(exists.output)) } catch { return null } }
  const selfHist = await aiHistory(db, source, 6, next)
  const ctx = {
    task: `为期号 ${next} 给出结构化预测（三位号 = 万/千/百）。系统会把你的 pos_weights × strategy_blend × boost/avoid 折算为 1000 个三位号的得分，取 Top ${ARENA_N} 注作为本期推荐直接展示给用户（理论命中率 50%，保本 52.6%）。reasoning 和 pick_plan 要能让用户看懂这 500 注为什么这样选。`,
    market: digest(draws),
    strategy_leaderboard_rolling40: perfDigest(perf, weights),
    your_recent_forecasts_newest_first: selfHist.map(h => ({ expect: h.expect, regime: h.regime, self_reported_confidence: h.confidence, evidence_eligible: h.evidence_eligible, next_focus: h.next_focus, boost: h.boost.slice(0, 10), result: h.evidence_eligible && h.actual ? { actual: h.actual, hit: !!h.hit, rank: h.rank, pnl: h.pnl } : 'not_verified_live', reasoning: (h.reasoning || '').slice(0, 200) })),
    your_tier_performance: await tierDigest(db, source, next, parseCustomNs(env.AI_CUSTOM_N)),
  }
  // 报单窗口：必须在 lockByMs（下期开奖 − AI_LEAD_MS）前锁定；剩余不足 3s 直接放弃 → 本期走兜底，保证截止前有单可报
  const budget = opts.lockByMs ? opts.lockByMs - Date.now() : aiTimeoutMs(env)
  let r: AiCallResult
  // 思考模式在完整上下文下需 15–40s；预算不足 THINK_MIN_BUDGET 时本期自动降级为非思考（保证 AI 仍参与，而不是直接兜底）
  let callEnv: AiEnv = env; let degraded = false
  if (aiProvider(env)?.name === 'deepseek' && dsThinking(env) !== 'off' && budget < THINK_MIN_BUDGET_MS) { callEnv = { ...env, DEEPSEEK_THINKING: 'off' }; degraded = true }
  if (budget < 3000) r = { forecast: null, raw: '', usage: {}, latency_ms: 0, error: `skipped: lock window ${Math.round(budget / 1000)}s`, model: `${aiProviderName(env)}:${aiModel(env)}` }
  else r = await callAi(callEnv, ctx, { effort: aiEffort(env), timeoutMs: Math.min(aiTimeoutMs(env), budget) })
  if (degraded) r.model += ':degraded'
  const f = r.forecast
  await db.prepare(`INSERT OR IGNORE INTO ai_forecasts (source, expect, model, based_on, output, reasoning, regime, confidence, prompt_tokens, completion_tokens, latency_ms, created_ms, error, cot, reasoning_tokens, lock_by_ms, started_ms, trigger) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(source, next, r.model, draws[0].expect, f ? JSON.stringify(f) : r.raw.slice(0, 4000), f?.reasoning || null, f?.regime || null, f?.confidence ?? null, r.usage.prompt_tokens ?? null, r.usage.completion_tokens ?? null, r.latency_ms, Date.now(), r.error || null, r.cot ? r.cot.slice(0, 8000) : null, r.usage.reasoning_tokens ?? null, opts.lockByMs ?? null, startedMs, opts.trigger || null).run()
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
  const t0 = Date.now()
  const r = await llmChat(env, { system: REPORT_SYSTEM, user: JSON.stringify(ctx), maxTokens: aiProvider(env)?.name === 'deepseek' ? 3000 : 6000, effort: 'medium', timeoutMs: 90_000 })
  if (!r.ok) throw new Error(r.error || 'llm failed')
  const model = `${r.provider}:${r.model}`; const j: any = { usage: r.usage }
  const report = r.content
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
  const r = await llmChat(env, { system: RULE_SYSTEM, user: JSON.stringify({ schema_hint: RULE_HINT, report }), json: true, maxTokens: 2000, effort: 'low', timeoutMs: 60_000 })
  if (!r.ok) throw new Error(r.error || 'llm failed')
  const o = parseJson(r.content || '{}')
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

/** 回填 AI 精选（前 N 注）历史：从已存的 ai 500 注派生，rank ≤ N 即命中；幂等 */
export async function backfillAiSubsets(db: D1Database, source: string, max = 300) {
  const rows = (await db.prepare('SELECT a.expect, a.based_on, a.numbers, a.actual, a.scored_ms FROM arena_rounds a WHERE a.source=? AND a.strategy=\'ai\' AND NOT EXISTS (SELECT 1 FROM arena_rounds b WHERE b.source=a.source AND b.expect=a.expect AND b.strategy=?) ORDER BY a.expect DESC LIMIT ?').bind(source, AI_SUBSETS[AI_SUBSETS.length - 1].key, max).all<any>()).results
  for (const r of rows) {
    const nums = String(r.numbers).split(' ').filter(x => /^[0-9]{3}$/.test(x)).map(Number)
    await insertRounds(db, source, r.expect, r.based_on, 'replay', AI_SUBSETS.map(sub => ({ strategy: sub.key, numbers: nums.slice(0, sub.n), coverage: Math.min(nums.length, sub.n) / SPACE, weight: 1 })), r.scored_ms ? r.actual : undefined)
  }
  return rows.length
}

/**
 * 自定义注数档位的历史回填：从 ai 主榜（500 注排序）派生 ai-custom-N（N ≤ 500 才能派生；N > 500 只能从定义后的下一期开始积累）。
 * 让用户一定义就能看到该档位在过去几百期的表现，而不是从零起步。
 */
export async function backfillCustomTiers(db: D1Database, source: string, ns: number[], max = 400) {
  const todo = ns.filter(n => n >= 10 && n <= 500 && !AI_SUBSETS.some(s => s.n === n) && n !== 500)
  if (!todo.length) return { periods: 0, tiers: [] as string[] }
  let periods = 0
  for (const n of todo) {
    const key = 'ai-custom-' + n
    const rows = (await db.prepare('SELECT a.expect, a.based_on, a.numbers, a.actual, a.scored_ms FROM arena_rounds a WHERE a.source=? AND a.strategy=\'ai\' AND NOT EXISTS (SELECT 1 FROM arena_rounds b WHERE b.source=a.source AND b.expect=a.expect AND b.strategy=?) ORDER BY a.expect DESC LIMIT ?').bind(source, key, max).all<any>()).results
    for (const r of rows) {
      const nums = String(r.numbers).split(' ').filter(x => /^[0-9]{3}$/.test(x)).slice(0, n).map(Number)
      await insertRounds(db, source, r.expect, r.based_on, 'replay', [{ strategy: key, numbers: nums, coverage: nums.length / SPACE, weight: 1 }], r.scored_ms ? r.actual : undefined)
    }
    periods = Math.max(periods, rows.length)
  }
  return { periods, tiers: todo.map(n => 'ai-custom-' + n) }
}
