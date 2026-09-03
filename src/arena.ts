// ============ 策略竞技场（自动战绩榜）：多策略并行 · 每期自动生成 500 注三位号 · 开奖后自动结算 · 向前滚动自适应加权 ============
// 诚实声明：区块哈希逐期独立，任意三位号理论概率恒为 1/1000，500 注的理论命中率恒为 50%。
// 本竞技场把「各种选号思路」放到同一赛道，用只依赖过往数据（walk-forward）的方式生成、结算、打分，
// 并按滚动战绩给策略加权融合成「组合最优」。若长期没有策略能显著跑赢随机对照组，即说明信号无预测力。
import { type Draw } from './analysis'
import { weightsFor, ALL_KEYS, positionDists, comboSignals, comboFactor, type PickOpts } from './picker'

export const ARENA_N = 500                       // 每策略每期注数
export const ARENA_ODDS = 950                    // 三位直选参考赔率（公平赔率 1000，庄家抽水 5%）
export const ARENA_MIN_HIST = 120                // 生成所需最少历史期数
const SPACE = 1000
const r4 = (x: number) => Math.round(x * 10000) / 10000
const r3 = (x: number) => Math.round(x * 1000) / 1000
const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }
const no3 = (i: number) => String(i).padStart(3, '0')
const digitsOf = (d: Draw) => [d.n1, d.n2, d.n3]

export interface StrategyDef { key: string; name: string; short: string; desc: string; color: string; control?: boolean; meta?: boolean; ai?: boolean }
export const STRATEGIES: StrategyDef[] = [
  { key: 'quant', name: '量化集成·均衡', short: '量化均衡', desc: '20 机制集成 × 单双/大小倾斜 × 组合级信号（前三和/龙虎/形态），temp 1.5 分散取号', color: '#06b6d4' },
  { key: 'quant-focus', name: '量化集成·聚焦', short: '量化聚焦', desc: '同量化集成，temp 1.0，更集中押注高倾向号', color: '#0ea5e9' },
  { key: 'hot', name: '热号追击', short: '热号', desc: '近 60 期各位数字出现频率（拉普拉斯平滑）乘积排序', color: '#ef4444' },
  { key: 'cold', name: '冷号回补', short: '冷号', desc: '各位数字当前遗漏期数越大权重越高（追冷/回补思路）', color: '#3b82f6' },
  { key: 'parity-size', name: '单双大小倾向', short: '单双大小', desc: '近 60 期各位单双、大小经验频率乘积 → 数字权重', color: '#eab308' },
  { key: 'bayes', name: '贝叶斯衰减后验', short: '贝叶斯', desc: 'Dirichlet(1) 先验 + 指数衰减计数（半衰期 30 期）后验', color: '#a855f7' },
  { key: 'markov', name: '马尔可夫转移', short: '马尔可夫', desc: '各位一阶转移矩阵：上期数字 → 本期数字条件频率（近 300 期）', color: '#f97316' },
  { key: 'random', name: '随机对照组', short: '随机对照', desc: '以期号为种子随机取 500 注，理论命中率 50%，用于对照所有策略', color: '#64748b', control: true },
  { key: 'meta', name: '组合最优 · 自适应加权', short: '组合最优', desc: '只用「目标期之前」已结算战绩，按滚动 z 分数给各策略加权，融合概率后取 Top 500', color: '#22c55e', meta: true },
  { key: 'follow', name: '跟随最强 · 动态切换', short: '跟最强', desc: '每期整份复制「之前」滚动 40 期 z 最高的基础策略（样本 <10 期时退化为组合最优）', color: '#ec4899', meta: true },
  { key: 'vote', name: '多策略共识投票', short: '共识投票', desc: '按被多少个基础策略同时选中排序（并列以组合最优概率决胜），取 Top 500', color: '#84cc16', meta: true },
  { key: 'ai', name: 'AI 预测官 · 大模型推理', short: 'AI 预测', desc: '大模型阅读全部统计信号 + 各策略滚动战绩 + 自己近期预测复盘 → 输出每位权重/策略融合/加减号 → Top 500（仅实盘，每期自动调用）', color: '#f472b6', ai: true },
]
const BASE_KEYS = STRATEGIES.filter(s => !s.control && !s.meta && !s.ai).map(s => s.key)
/** 回放时不包含 AI（避免大量模型调用；且 AI 只在真实开奖前预测才有意义） */
const REPLAY_KEYS = STRATEGIES.filter(s => !s.ai).map(s => s.key)

// ------------------------------------------------------------ 各策略：输出 1000 维得分向量（越大越倾向）
const enumerate = (dists: number[][]) => { const s = new Array<number>(SPACE); for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) s[a * 100 + b * 10 + c] = dists[0][a] * dists[1][b] * dists[2][c]; return s }

function hotDist(hist: Draw[], win = 60) {
  return [0, 1, 2].map(pos => { const c = Array(10).fill(1); for (const d of hist.slice(0, win)) c[digitsOf(d)[pos]]++; return norm(c) })
}
function coldDist(hist: Draw[]) {
  return [0, 1, 2].map(pos => {
    const gap = Array(10).fill(hist.length)
    for (let d = 0; d < 10; d++) { const i = hist.findIndex(x => digitsOf(x)[pos] === d); if (i >= 0) gap[d] = i }
    return norm(gap.map(g => Math.pow(g + 1, 1.2)))
  })
}
function paritySizeDist(hist: Draw[], win = 60) {
  return [0, 1, 2].map(pos => {
    let n = 0, odd = 0, big = 0
    for (const d of hist.slice(0, win)) { const v = digitsOf(d)[pos]; n++; if (v % 2) odd++; if (v >= 5) big++ }
    const pOdd = (odd + 10) / (n + 20), pBig = (big + 10) / (n + 20)
    return norm([...Array(10).keys()].map(v => (v % 2 ? pOdd : 1 - pOdd) * (v >= 5 ? pBig : 1 - pBig)))
  })
}
function bayesDist(hist: Draw[], halfLife = 30) {
  const lam = Math.log(2) / halfLife
  return [0, 1, 2].map(pos => { const c = Array(10).fill(1); hist.slice(0, 300).forEach((d, age) => { c[digitsOf(d)[pos]] += Math.exp(-lam * age) }); return norm(c) })
}
function markovDist(hist: Draw[], win = 300) {
  return [0, 1, 2].map(pos => {
    const last = digitsOf(hist[0])[pos]; const c = Array(10).fill(0.5)
    const seq = hist.slice(0, win).map(d => digitsOf(d)[pos])   // 最新在前：seq[i] 的上一期是 seq[i+1]
    for (let i = 0; i + 1 < seq.length; i++) if (seq[i + 1] === last) c[seq[i]]++
    return norm(c)
  })
}
function seeded(seedStr: string) {   // mulberry32
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function quantScores(hist: Draw[], W: ReturnType<typeof weightsFor>, temp: number) {
  const opt: PickOpts = { count: ARENA_N, steps: 60, wParity: 0.6, wSize: 0.4, wCombo: 0.35, btSteps: 0, temp }
  const pd = positionDists(hist, opt, W); const sig = comboSignals(hist, W)
  const base = enumerate(pd.map(p => p.dist))
  return base.map((p, i) => p * comboFactor([Math.floor(i / 100), Math.floor(i / 10) % 10, i % 10], sig, opt.wCombo))
}

/** 单策略得分向量（归一化为概率估计） */
export function strategyScores(key: string, hist: Draw[], ctx: { W: ReturnType<typeof weightsFor>; seed: string }): number[] {
  switch (key) {
    case 'quant': return norm(quantScores(hist, ctx.W, 1.5))
    case 'quant-focus': return norm(quantScores(hist, ctx.W, 1.0))
    case 'hot': return enumerate(hotDist(hist))
    case 'cold': return enumerate(coldDist(hist))
    case 'parity-size': return enumerate(paritySizeDist(hist))
    case 'bayes': return enumerate(bayesDist(hist))
    case 'markov': return enumerate(markovDist(hist))
    case 'random': { const rnd = seeded(ctx.seed); return norm([...Array(SPACE)].map(() => 0.5 + rnd())) }
  }
  throw new Error('unknown strategy ' + key)
}
const topN = (scores: number[], N: number) => [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, N)

// ------------------------------------------------------------ 向前滚动自适应权重
export interface PerfRow { expect: string; hit: number; p: number }
export type PerfMap = Record<string, PerfRow[]>   // 各策略已结算记录（按期号升序，仅含目标期之前）
export const META_K = 40           // 滚动窗口期数
export const META_SHRINK = 20      // 样本收缩：n/(n+20) 权重信任度

/** 按滚动 z 分数给基础策略加权：w = shrink·exp(0.6·clamp(z,-2,2)) + (1-shrink)·1，再归一化 */
export function metaWeights(perf: PerfMap) {
  const raw: Record<string, { w: number; n: number; hits: number; exp: number; z: number; lift: number }> = {}
  for (const k of BASE_KEYS) {
    const rows = (perf[k] || []).slice(-META_K)
    const n = rows.length, hits = rows.reduce((s, r) => s + r.hit, 0), exp = rows.reduce((s, r) => s + r.p, 0)
    const varr = rows.reduce((s, r) => s + r.p * (1 - r.p), 0)
    const z = n && varr > 0 ? (hits - exp) / Math.sqrt(varr) : 0
    const trust = n / (n + META_SHRINK)
    const w = trust * Math.exp(0.6 * Math.max(-2, Math.min(2, z))) + (1 - trust)
    raw[k] = { w, n, hits, exp: r3(exp), z: r3(z), lift: exp > 0 ? r3(hits / exp) : 1 }
  }
  const sum = Object.values(raw).reduce((s, x) => s + x.w, 0) || 1
  for (const k of BASE_KEYS) raw[k].w = r4(raw[k].w / sum)
  return raw
}

// ------------------------------------------------------------ 生成一期（全部策略）
export interface RoundGen { strategy: string; numbers: number[]; coverage: number; weight: number }
/** hist：目标期之前的全部历史（最新在前）；perf：目标期之前已结算战绩；返回 vec 供外部（AI）融合 */
export function generateRound(hist: Draw[], seed: string, perf: PerfMap, W?: ReturnType<typeof weightsFor>): { rounds: RoundGen[]; weights: ReturnType<typeof metaWeights>; vec: Record<string, number[]> } {
  W ||= weightsFor(hist, 60, ALL_KEYS)
  const weights = metaWeights(perf)
  const vec: Record<string, number[]> = {}
  const rounds: RoundGen[] = []
  for (const s of STRATEGIES) {
    if (s.meta || s.ai) continue
    vec[s.key] = strategyScores(s.key, hist, { W, seed })
    const idx = topN(vec[s.key], ARENA_N)
    rounds.push({ strategy: s.key, numbers: idx, coverage: r4(idx.reduce((a, i) => a + vec[s.key][i], 0)), weight: weights[s.key]?.w ?? 0 })
  }
  const meta = new Array<number>(SPACE).fill(0)
  for (const k of BASE_KEYS) { const w = weights[k].w; const v = vec[k]; for (let i = 0; i < SPACE; i++) meta[i] += w * v[i] }
  const mi = topN(meta, ARENA_N)
  rounds.push({ strategy: 'meta', numbers: mi, coverage: r4(mi.reduce((a, i) => a + meta[i], 0)), weight: 1 })
  // 跟随最强：只看之前滚动战绩，整份复制 z 最高的基础策略
  let bestK: string | null = null, bestZ = -Infinity
  for (const k of BASE_KEYS) { const w = weights[k]; if (w.n >= 10 && w.z > bestZ) { bestZ = w.z; bestK = k } }
  const src = rounds.find(r => r.strategy === (bestK || 'meta'))!
  rounds.push({ strategy: 'follow', numbers: [...src.numbers], coverage: src.coverage, weight: bestK ? weights[bestK].w : 1 })
  // 共识投票：被几个基础策略选中 + 组合最优概率决胜
  const votes = new Array<number>(SPACE).fill(0)
  for (const k of BASE_KEYS) for (const i of rounds.find(r => r.strategy === k)!.numbers) votes[i]++
  const vscore = votes.map((v, i) => v + meta[i] / (Math.max(...meta) || 1))
  const vi = topN(vscore, ARENA_N)
  rounds.push({ strategy: 'vote', numbers: vi, coverage: r4(vi.reduce((a, i) => a + meta[i], 0)), weight: 1 })
  return { rounds, weights, vec }
}
/** 用外部得分向量（如 AI）组装一份 RoundGen */
export function roundFromScores(strategy: string, scores: number[], weight = 1): RoundGen {
  const idx = topN(scores, ARENA_N)
  return { strategy, numbers: idx, coverage: r4(idx.reduce((a, i) => a + scores[i], 0)), weight }
}

// ------------------------------------------------------------ 持久化 / 结算
export const pnlOf = (hit: boolean, count: number) => hit ? ARENA_ODDS - count : -count

async function insertRounds(db: D1Database, source: string, expect: string, basedOn: string, mode: 'live' | 'replay', gen: RoundGen[], actual?: string) {
  const ts = Date.now()
  const stmts = gen.map(g => {
    const nums = g.numbers.map(no3)
    if (actual) {
      const idx = nums.indexOf(actual); const hit = idx >= 0
      return db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms, actual, hit, rank, pnl, scored_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(source, expect, g.strategy, mode, basedOn, nums.join(' '), nums.length, g.coverage, g.weight, ts, actual, hit ? 1 : 0, hit ? idx + 1 : null, pnlOf(hit, nums.length), ts)
    }
    return db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(source, expect, g.strategy, mode, basedOn, nums.join(' '), nums.length, g.coverage, g.weight, ts)
  })
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40))
}

/** 对已开奖但未结算的记录打分 */
export async function settleArena(db: D1Database, source: string) {
  const pend = (await db.prepare(`SELECT a.expect, a.strategy, a.numbers, a.count, d.n1, d.n2, d.n3 FROM arena_rounds a
    JOIN draws d ON d.source = a.source AND d.expect = a.expect WHERE a.source = ? AND a.scored_ms IS NULL LIMIT 400`).bind(source).all<any>()).results
  if (!pend.length) return 0
  const ts = Date.now()
  const stmts = pend.map(r => {
    const actual = `${r.n1}${r.n2}${r.n3}`; const idx = (r.numbers as string).split(' ').indexOf(actual); const hit = idx >= 0
    return db.prepare('UPDATE arena_rounds SET actual=?, hit=?, rank=?, pnl=?, scored_ms=? WHERE source=? AND expect=? AND strategy=?')
      .bind(actual, hit ? 1 : 0, hit ? idx + 1 : null, pnlOf(hit, r.count), ts, source, r.expect, r.strategy)
  })
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40))
  return pend.length
}

/** 加载目标期之前的已结算战绩（各策略最近 META_K 条，升序） */
async function loadPerf(db: D1Database, source: string, beforeExpect: string): Promise<PerfMap> {
  const rows = (await db.prepare(`SELECT strategy, expect, hit, count FROM arena_rounds WHERE source=? AND expect<? AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT ?`)
    .bind(source, beforeExpect, META_K * STRATEGIES.length).all<any>()).results
  const perf: PerfMap = {}
  for (const r of rows.reverse()) (perf[r.strategy] ||= []).push({ expect: r.expect, hit: r.hit, p: r.count / SPACE })
  return perf
}

const nextOf = (expect: string) => /^\d+$/.test(expect) ? String(BigInt(expect) + 1n) : ''
const arenaDone = new Map<string, string>()   // source → 已生成的下一期（进程内去重）

/** 外部（AI）选手：给定上下文，返回 1000 维得分；null = 本期不参赛 */
export type ExternalScorer = (ctx: { next: string; hist: Draw[]; perf: PerfMap; weights: ReturnType<typeof metaWeights>; vec: Record<string, number[]> }) => Promise<number[] | null>

/** 每期自动：先结算 → 为下一期生成全部策略（INSERT OR IGNORE） → 顺带回放补齐最近漏掉的期（每次最多 backfill 期） */
export async function autoArena(db: D1Database, source: string, draws: Draw[], backfill = 2, external?: { key: string; scorer: ExternalScorer }) {
  if (draws.length < ARENA_MIN_HIST) return { generated: false }
  await settleArena(db, source)
  const latest = draws[0].expect; const next = nextOf(latest)
  let generated = false, externalDone = false
  if (next) {
    const haveRows = (await db.prepare('SELECT strategy FROM arena_rounds WHERE source=? AND expect=?').bind(source, next).all<any>()).results.map(r => r.strategy)
    const have = new Set<string>(haveRows)
    const needBase = REPLAY_KEYS.some(k => !have.has(k))
    const needExt = !!external && !have.has(external.key)
    if ((needBase || needExt) && arenaDone.get(source) !== next + (needExt ? '|ext' : '')) {
      const perf = await loadPerf(db, source, next)
      const gen = generateRound(draws, `${source}|${next}`, perf)
      if (needBase) { await insertRounds(db, source, next, latest, 'live', gen.rounds); generated = true }
      if (needExt) {
        const scores = await external!.scorer({ next, hist: draws, perf, weights: gen.weights, vec: gen.vec })
        if (scores) { await insertRounds(db, source, next, latest, 'live', [roundFromScores(external!.key, scores)]); externalDone = true }
      }
      arenaDone.set(source, next + (needExt && !externalDone ? '' : '|ext'))
    }
  }
  let replayed = 0
  if (backfill > 0) replayed = await replayArena(db, source, draws, backfill, 60)
  return { generated, replayed, externalDone }
}

/** 回放补齐：在最近 lookback 期内找没有竞技场记录的已开奖期，按时间正序生成并即时结算（严格只用该期之前的数据） */
export async function replayArena(db: D1Database, source: string, draws: Draw[], maxPeriods: number, lookback: number) {
  const maxIdx = Math.min(lookback, draws.length - ARENA_MIN_HIST - 1)
  if (maxIdx < 0) return 0
  const cand = draws.slice(0, maxIdx + 1).map(d => d.expect)
  const have = new Set((await db.prepare(`SELECT expect FROM arena_rounds WHERE source=? AND expect>=? AND expect<=? AND strategy<>'ai' GROUP BY expect HAVING COUNT(*) >= ?`)
    .bind(source, cand[cand.length - 1], cand[0], REPLAY_KEYS.length).all<any>()).results.map(r => r.expect))
  const targets: number[] = []
  for (let k = maxIdx; k >= 0 && targets.length < maxPeriods; k--) if (!have.has(draws[k].expect)) targets.push(k)   // 旧 → 新
  if (!targets.length) return 0
  // 机制权重按本批最旧目标之前的历史计算一次（对更新的目标无前视），其余信号逐期严格滚动
  const W = weightsFor(draws.slice(targets[0] + 1), 60, ALL_KEYS)
  const perf = await loadPerf(db, source, draws[targets[0]].expect)
  for (const k of targets) {
    const target = draws[k]; const hist = draws.slice(k + 1)
    const { rounds } = generateRound(hist, `${source}|${target.expect}`, perf, W)
    const actual = `${target.n1}${target.n2}${target.n3}`
    await insertRounds(db, source, target.expect, hist[0].expect, 'replay', rounds, actual)
    for (const g of rounds) (perf[g.strategy] ||= []).push({ expect: target.expect, hit: g.numbers.map(no3).includes(actual) ? 1 : 0, p: g.numbers.length / SPACE })
  }
  return targets.length
}

// ------------------------------------------------------------ 战绩榜
export async function arenaBoard(db: D1Database, source: string, opt: { mode?: 'all' | 'live' | 'replay'; limit?: number }) {
  await settleArena(db, source)
  const mode = opt.mode && opt.mode !== 'all' ? opt.mode : null
  const limit = Math.max(20, Math.min(600, opt.limit ?? 200))
  const mw = mode ? ' AND mode=?' : ''; const mb = mode ? [mode] : []
  // 总体：按策略聚合（AI 选手仅实盘参赛，其 n 自然少于其他策略）
  const agg = (await db.prepare(`SELECT strategy, COUNT(*) n, SUM(hit) hits, SUM(count)/1000.0 exp, SUM(pnl) pnl, AVG(coverage) cov, AVG(rank) avg_rank, MIN(expect) first_expect, MAX(expect) last_expect
    FROM arena_rounds WHERE source=? AND scored_ms IS NOT NULL${mw} GROUP BY strategy`).bind(source, ...mb).all<any>()).results
  // 序列：最近 limit 期（每期全部策略）
  const rows = (await db.prepare(`SELECT expect, strategy, mode, count, coverage, weight, actual, hit, rank, pnl FROM arena_rounds
    WHERE source=? AND scored_ms IS NOT NULL${mw} ORDER BY expect DESC LIMIT ?`).bind(source, ...mb, limit * STRATEGIES.length).all<any>()).results
  const byExpect = new Map<string, any[]>()
  for (const r of rows) { if (!byExpect.has(r.expect)) byExpect.set(r.expect, []); byExpect.get(r.expect)!.push(r) }
  const expects = [...byExpect.keys()].sort()   // 升序
  const periods = expects.map(e => { const rs = byExpect.get(e)!; const o: any = { expect: e, actual: rs[0].actual, mode: rs[0].mode, hit: {}, pnl: {}, rank: {}, weight: {} }; for (const r of rs) { o.hit[r.strategy] = r.hit; o.pnl[r.strategy] = r.pnl; o.rank[r.strategy] = r.rank; o.weight[r.strategy] = r.weight } return o })
  // 每策略：累计曲线 + 滚动 + 回撤 + 连败
  const strategies = STRATEGIES.map(s => {
    const a = agg.find(x => x.strategy === s.key)
    const n = a?.n || 0, hits = a?.hits || 0, exp = a?.exp || 0
    const pBar = n ? exp / n : ARENA_N / SPACE
    const z = n ? (hits - exp) / Math.sqrt(n * pBar * (1 - pBar)) : 0
    let cum = 0, peak = 0, dd = 0, streak = 0, streakBroken = false
    const cumPnl: (number | null)[] = [], cumRate: (number | null)[] = []; let ch = 0, cn = 0
    periods.forEach((p) => {
      const h = p.hit[s.key]; if (h === undefined) { cumPnl.push(cn ? cum : null); cumRate.push(cn ? ch / cn : null); return }
      cum += p.pnl[s.key]; ch += h; cn++; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum)
      cumPnl.push(cum); cumRate.push(ch / cn)
    })
    for (let i = periods.length - 1; i >= 0 && !streakBroken; i--) { const h = periods[i].hit[s.key]; if (h === undefined) continue; if (h) streakBroken = true; else streak++ }
    const roll = periods.slice(-META_K).map(p => p.hit[s.key]).filter(h => h !== undefined) as number[]
    const rollHits = roll.reduce((x, y) => x + y, 0)
    const rollZ = roll.length ? (rollHits - roll.length * 0.5) / Math.sqrt(roll.length * 0.25) : 0
    return {
      ...s, n, hits, rate: n ? r4(hits / n) : null, baseline: r4(pBar), lift: exp ? r3(hits / exp) : null, z: r3(z), pnl: a?.pnl || 0, roi: n ? r4((a?.pnl || 0) / (n * ARENA_N)) : null,
      coverage: a ? r4(a.cov) : null, avg_rank: a?.avg_rank ? Math.round(a.avg_rank) : null, max_dd: dd, streak_miss: streak,
      rolling: { k: roll.length, hits: rollHits, rate: roll.length ? r4(rollHits / roll.length) : null, z: r3(rollZ) },
      ev_per_period: n ? r3((hits / n) * ARENA_ODDS - ARENA_N) : null,
      cum_pnl: cumPnl, cum_rate: cumRate.map(v => v === null ? null : r4(v)),
      verdict: n < 30 ? '样本不足' : z > 1.96 ? '显著优于基线' : z < -1.96 ? '显著劣于基线' : '与基线无显著差异',
    }
  })
  // 当前期（未结算的最新一期）
  const pendRows = (await db.prepare(`SELECT expect, strategy, based_on, numbers, count, coverage, weight, created_ms FROM arena_rounds WHERE source=? AND scored_ms IS NULL ORDER BY expect DESC LIMIT ?`).bind(source, STRATEGIES.length * 3).all<any>()).results
  const curExpect = pendRows[0]?.expect
  const current = curExpect ? {
    expect: curExpect, based_on: pendRows[0].based_on, created_ms: pendRows[0].created_ms,
    strategies: pendRows.filter(r => r.expect === curExpect).map(r => ({ strategy: r.strategy, numbers: r.numbers, count: r.count, coverage: r.coverage, weight: r.weight })),
  } : null
  const pending = (await db.prepare(`SELECT COUNT(DISTINCT expect) n FROM arena_rounds WHERE source=? AND scored_ms IS NULL`).bind(source).first<any>())?.n || 0
  // 当前权重（用于下一期）
  const perf = await loadPerf(db, source, curExpect || '99999999999999')
  const weights = metaWeights(perf)
  // ---- 投资策略模拟：选哪套 × 何时下注，每期决策只用之前已结算数据（walk-forward）
  const rollZ = (key: string, i: number, k: number) => { const rows = periods.slice(Math.max(0, i - k), i).map(p => p.hit[key]).filter(h => h !== undefined) as number[]; const n = rows.length; if (!n) return { z: 0, n: 0 }; const h = rows.reduce((a, b) => a + b, 0); return { z: (h - n * 0.5) / Math.sqrt(n * 0.25), n } }
  const extremeBy = (i: number, k: number, min: number, sign: 1 | -1) => { let key: string | null = null, best = -Infinity; for (const b of BASE_KEYS) { const r = rollZ(b, i, k); if (r.n >= min && sign * r.z > best) { best = sign * r.z; key = b } } return { key, z: sign * best } }
  const missRun = (key: string, i: number) => { let m = 0; for (let j = i - 1; j >= 0; j--) { const h = periods[j].hit[key]; if (h === undefined) continue; if (h) break; m++ } return m }
  const PLANS: { key: string; name: string; desc: string; pick: (i: number) => string | null; control?: boolean }[] = [
    { key: 'meta-always', name: '组合最优 · 每期必投', desc: '基准：每期投组合最优 500 注', pick: () => 'meta' },
    { key: 'follow-always', name: '跟随最强 · 每期必投', desc: '每期投滚动 40 期 z 最高的基础策略', pick: (i) => extremeBy(i, 40, 10, 1).key || 'meta' },
    { key: 'meta-timing', name: '组合最优 · 择时', desc: '仅当组合最优近 20 期滚动 z > 0.5 时下注，否则观望', pick: (i) => { const r = rollZ('meta', i, 20); return r.n >= 10 && r.z > 0.5 ? 'meta' : null } },
    { key: 'follow-timing', name: '跟随最强 · 择时', desc: '仅当最强基础策略近 20 期滚动 z > 1 时跟投，否则观望', pick: (i) => { const b = extremeBy(i, 20, 10, 1); return b.key && b.z > 1 ? b.key : null } },
    { key: 'meta-stoploss', name: '组合最优 · 连败止损', desc: '组合最优连续 2 期未中后暂停，直到它（虚拟）命中一期再恢复', pick: (i) => missRun('meta', i) >= 2 ? null : 'meta' },
    { key: 'contrarian', name: '逆向 · 跟最弱（对照）', desc: '投滚动 40 期 z 最低的基础策略，检验“均值回归”是否存在', pick: (i) => extremeBy(i, 40, 10, -1).key || 'meta', control: true },
  ]
  const plans = PLANS.map(pl => {
    let bets = 0, skips = 0, hits = 0, cum = 0, peak = 0, dd = 0; const curve: number[] = []; const picks: Record<string, number> = {}
    periods.forEach((p, i) => {
      const k = pl.pick(i)
      if (k && p.hit[k] !== undefined) { bets++; hits += p.hit[k]; cum += p.pnl[k]; picks[k] = (picks[k] || 0) + 1 } else skips++
      peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); curve.push(cum)
    })
    const pBar = ARENA_N / SPACE
    return { key: pl.key, name: pl.name, desc: pl.desc, control: !!pl.control, bets, skips, hits, rate: bets ? r4(hits / bets) : null, z: bets ? r3((hits - bets * pBar) / Math.sqrt(bets * pBar * (1 - pBar))) : 0, pnl: cum, roi: bets ? r4(cum / (bets * ARENA_N)) : null, max_dd: dd, curve, picks }
  })
  const planBest = [...plans].filter(p => !p.control && p.bets >= 20).sort((a, b) => b.pnl - a.pnl)[0] || null
  // 投资策略建议（诚实版）
  const ranked = strategies.filter(s => !s.control).sort((a, b) => (b.rolling.z - a.rolling.z) || (b.z - a.z))
  const best = ranked[0]; const ctrl = strategies.find(s => s.control)!
  const breakEven = r4(ARENA_N / ARENA_ODDS)
  const advice: string[] = []
  if (!best || best.n < 30) advice.push(`样本不足（已结算 ${best?.n || 0} 期，至少 30 期才做判断），先让竞技场自动跑，或用「回放补齐」把历史期一次性补齐。`)
  else {
    advice.push(`滚动 ${META_K} 期表现最好：「${best.name}」命中率 ${((best.rolling.rate || 0) * 100).toFixed(1)}%（z=${best.rolling.z}），累计 ${best.n} 期 ${((best.rate || 0) * 100).toFixed(1)}% vs 基线 ${(best.baseline * 100).toFixed(0)}%，累计盈亏 ${best.pnl >= 0 ? '+' : ''}${best.pnl}。`)
    advice.push(`随机对照组 ${ctrl.n} 期命中率 ${((ctrl.rate || 0) * 100).toFixed(1)}%（盈亏 ${ctrl.pnl}）。任何策略必须长期显著跑赢对照组（z>1.96）才算有信号。`)
    const meta = strategies.find(s => s.key === 'meta')!
    advice.push(`组合最优（自适应加权）：${meta.n} 期命中率 ${((meta.rate || 0) * 100).toFixed(1)}%，z=${meta.z}，最大回撤 ${meta.max_dd}，${meta.verdict}。`)
    if (planBest) { const ctrlPlan = plans.find(p => p.control)!; advice.push(`投资策略模拟（全部 walk-forward）盈亏最好：「${planBest.name}」下注 ${planBest.bets} 期 / 观望 ${planBest.skips} 期，命中率 ${((planBest.rate || 0) * 100).toFixed(1)}%，盈亏 ${planBest.pnl >= 0 ? '+' : ''}${planBest.pnl}，ROI ${((planBest.roi || 0) * 100).toFixed(2)}%，最大回撤 ${planBest.max_dd}；逆向对照方案盈亏 ${ctrlPlan.pnl}。择时/切换在独立序列上没有理论优势，多方案中挑最好的一套本身就带有选择偏差，需要它在后续实盘持续领先才算成立。`) }
    const sig = ranked.filter(s => s.n >= 30 && s.z > 1.96)
    advice.push(sig.length ? `目前统计显著跑赢基线的策略：${sig.map(s => s.name).join('、')}。` : `目前没有任何策略在统计上显著跑赢 50% 基线——这与「哈希逐期独立」的理论一致。`)
  }
  advice.push(`按参考赔率 ${ARENA_ODDS}× 计算，500 注的保本命中率为 ${(breakEven * 100).toFixed(1)}%（理论命中率 50%，每期期望 −${ARENA_N - ARENA_ODDS / 2}），任何投注在数学期望上都是负的；本页只做统计验证，不构成投资建议。`)
  return {
    n_periods: periods.length, pending, odds: ARENA_ODDS, per_strategy_count: ARENA_N, break_even_rate: breakEven, meta_k: META_K,
    strategies, periods: periods.map(p => ({ expect: p.expect, actual: p.actual, mode: p.mode, hit: p.hit, pnl: p.pnl, rank: p.rank })),
    current, weights, best: best?.key || null, advice, plans, plan_best: planBest?.key || null,
    disclaimer: '区块哈希逐期独立，任意三位号概率恒为 1/1000；竞技场是对各类选号思路的统计验证，不是预测。',
  }
}

/** 单期单策略详情 */
export async function arenaRound(db: D1Database, source: string, expect: string, strategy: string) {
  return db.prepare('SELECT * FROM arena_rounds WHERE source=? AND expect=? AND strategy=?').bind(source, expect, strategy).first<any>()
}
