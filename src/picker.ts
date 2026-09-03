// ============ 量化选号器：把全部量化信号折算为「每位 0-9 权重」→ 联合概率 Top-N 前三位（万千百）号码 ============
// 声明：区块哈希逐期独立，任意三位号理论概率恒为 1/1000。本引擎输出的是「统计倾向排序」，
// 回测面板会给出 Top-N 的真实覆盖率 vs N/1000 基线——若长期无显著差异，说明信号无预测力。
import { MARKETS, buildSeries, backtest, ensemble, type Draw } from './analysis'
import { computeOutcomes5, POS_NAMES } from './engine5'
import { parityKline } from './parity_kline'

const r4 = (x: number) => Math.round(x * 10000) / 10000
const r3 = (x: number) => Math.round(x * 1000) / 1000
const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }
const SHAPE_PRIOR: Record<string, number> = { leopard: 0.01, straight: 0.048, pair: 0.27, mixed: 0.672 }
/** 选号位数：前三位（万/千/百） */
export const PICK_DIGITS = 3
const SPACE = Math.pow(10, PICK_DIGITS)           // 1000
const POSN = [...Array(PICK_DIGITS).keys()]        // [0,1,2]
const SHAPES = ['leopard', 'straight', 'pair', 'mixed'] as const
const SHAPE_CN = ['豹子', '顺子', '对子', '杂六']
/** 前三形态（与 engine5 规则一致） */
function shape3(a: number, b: number, c: number): typeof SHAPES[number] {
  if (a === b && b === c) return 'leopard'
  const s = [a, b, c].sort((x, y) => x - y)
  if (s[2] - s[1] === 1 && s[1] - s[0] === 1) return 'straight'
  if (a === b || b === c || a === c) return 'pair'
  return 'mixed'
}
/** 最近窗口经验频率（拉普拉斯收缩，避免小样本极端值） */
function recentRate(draws: Draw[], f: (nums: number[]) => boolean, win = 60) {
  let n = 0, k = 0
  for (const d of draws.slice(0, win)) { const o = computeOutcomes5(d.hash); if (!o) continue; n++; if (f(o.nums)) k++ }
  return (k + 10) / (n + 20)
}

export interface PickOpts { count: number; steps: number; wParity: number; wSize: number; wCombo: number; btSteps: number; temp: number }
export interface PickNumber { no: string; digits: number[]; p: number; lift: number; rank: number; tier: 'core' | 'main' | 'edge'; tags: string[] }

type Weights = Record<string, ReturnType<typeof backtest>['res']>
/** 机制权重（回测一次，后续历史步复用，避免 O(steps²)） */
export function weightsFor(draws: Draw[], steps: number, keys: string[]): Weights {
  const w: Weights = {}
  for (const key of keys) { const m = MARKETS.find(x => x.key === key)!; w[key] = backtest(buildSeries(draws, m), m, steps).res }
  return w
}
export const ALL_KEYS = [...POSN.flatMap(i => [`pos-digit-${i}`, `pos-size-${i}`]), 'shape']

/** 每位 0-9 分布：机制集成 × 单双预判 × 大小倾向 */
export function positionDists(draws: Draw[], opt: PickOpts, W: Weights) {
  const out: { pos: number; posName: string; base: number[]; parity: { pOdd: number; side: string; level: string }; size: { pBig: number; tilt: number }; dist: number[]; order: number[]; hot: number[]; cold: number[]; gaps: number[] }[] = []
  for (const i of POSN) {
    const mD = MARKETS.find(m => m.key === `pos-digit-${i}`)!, mS = MARKETS.find(m => m.key === `pos-size-${i}`)!
    const sD = buildSeries(draws, mD); const enD = ensemble(sD, mD, W[mD.key])
    const sS = buildSeries(draws, mS); const enS = ensemble(sS, mS, W[mS.key])
    const pk = parityKline(draws, { pos: i, bucket: 1 }).forecast
    const pBig = enS.p[0]
    const dist = norm(enD.p.map((p, d) => {
      const fParity = 1 + opt.wParity * ((d % 2 ? pk.pOdd : pk.pEven) * 2 - 1)   // 单双倾斜
      const fSize = 1 + opt.wSize * ((d >= 5 ? pBig : 1 - pBig) * 2 - 1)         // 大小倾斜
      return Math.pow(p * fParity * fSize, 1 / opt.temp)                          // temp>1 → 分布更平 → 号码更分散
    }))
    const order = [...dist.keys()].sort((a, b) => dist[b] - dist[a])
    const recent = sD.seq.slice(-30); const cnt = Array(10).fill(0); for (const v of recent) cnt[v]++
    out.push({ pos: i, posName: POS_NAMES[i] + '位', base: enD.p.map(r4), parity: { pOdd: pk.pOdd, side: pk.side, level: pk.level }, size: { pBig: r3(pBig), tilt: enS.tilt }, dist: dist.map(r4), order, hot: [...cnt.keys()].filter(d => cnt[d] >= 5), cold: [...cnt.keys()].filter(d => cnt[d] <= 1), gaps: enD.gaps })
  }
  return out
}

/** 组合级信号：前三和值大小/单双（近 60 期经验频率）、前三形态（机制集成）→ 对候选号做温和再加权 */
export function comboSignals(draws: Draw[], W: Weights) {
  const mSh = MARKETS.find(x => x.key === 'shape')!; const sh = ensemble(buildSeries(draws, mSh), mSh, W['shape'])
  const sum3 = (n: number[]) => n[0] + n[1] + n[2]
  const sumBig = recentRate(draws, n => sum3(n) >= 14)      // 0~27，≥14 为大
  const sumOdd = recentRate(draws, n => sum3(n) % 2 === 1)
  const dragon = recentRate(draws, n => n[0] > n[2]) / Math.max(1e-6, recentRate(draws, n => n[0] !== n[2]))  // 万 vs 百，排除和
  const pc = (x: number) => (Math.max(x, 1 - x) * 100).toFixed(0) + '%'
  return {
    sumBig, sumOdd, dragon, shape: sh.p,
    text: [`前三和 ${sumBig >= 0.5 ? '大(≥14)' : '小(≤13)'} ${pc(sumBig)}`, `前三和 ${sumOdd >= 0.5 ? '单' : '双'} ${pc(sumOdd)}`, `万vs百 ${dragon >= 0.5 ? '龙' : '虎'} ${pc(dragon)}`, `形态 ${SHAPE_CN[sh.p.indexOf(Math.max(...sh.p))]}`],
  }
}

export function comboFactor(d: number[], sig: ReturnType<typeof comboSignals>, w: number) {
  const [a, b, c] = d; const sum = a + b + c
  let f = 1
  f *= 1 + w * ((sum >= 14 ? sig.sumBig : 1 - sig.sumBig) * 2 - 1)
  f *= 1 + w * ((sum % 2 ? sig.sumOdd : 1 - sig.sumOdd) * 2 - 1)
  if (a !== c) f *= 1 + w * ((a > c ? sig.dragon : 1 - sig.dragon) * 2 - 1)
  const shp = shape3(a, b, c)
  f *= Math.pow(Math.max(0.6, Math.min(1.5, sig.shape[SHAPES.indexOf(shp)] / SHAPE_PRIOR[shp])), w)   // 形态：相对先验的提升（夹紧，防止豹子等稀有形态被小样本噪音放大）
  return f
}

/** K-best：3 个独立分布乘积的前 K 大组合（最大堆 + 去重） */
function kBest(dists: number[][], orders: number[][], K: number) {
  type Node = { idx: number[]; p: number }
  const heap: Node[] = []
  const push = (n: Node) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const par = (i - 1) >> 1; if (heap[par].p >= heap[i].p) break; [heap[par], heap[i]] = [heap[i], heap[par]]; i = par } }
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l].p > heap[m].p) m = l; if (r < heap.length && heap[r].p > heap[m].p) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
  const pOf = (idx: number[]) => idx.reduce((s, k, pos) => s * dists[pos][orders[pos][k]], 1)
  const seen = new Set<string>(); const start = POSN.map(() => 0)
  push({ idx: start, p: pOf(start) }); seen.add(start.join(''))
  const out: { digits: number[]; p: number }[] = []
  while (heap.length && out.length < K) {
    const n = pop(); out.push({ digits: n.idx.map((k, pos) => orders[pos][k]), p: n.p })
    for (let pos = 0; pos < PICK_DIGITS; pos++) { if (n.idx[pos] >= 9) continue; const nx = [...n.idx]; nx[pos]++; const key = nx.join(''); if (seen.has(key)) continue; seen.add(key); push({ idx: nx, p: pOf(nx) }) }
  }
  return out
}

/** 复式方案：每位取若干数字，使组合数 ≈ N 且覆盖概率最大（贪心） */
function duplex(dists: number[][], orders: number[][], N: number) {
  const sizes = POSN.map(() => 1)
  const cum = (pos: number, k: number) => orders[pos].slice(0, k).reduce((s, d) => s + dists[pos][d], 0)
  for (;;) {
    let best = -1, bestGain = 0
    for (let pos = 0; pos < PICK_DIGITS; pos++) {
      if (sizes[pos] >= 10) continue
      const newCount = sizes.reduce((s, x, i) => s * (i === pos ? x + 1 : x), 1)
      if (newCount > N) continue
      const gain = Math.log(cum(pos, sizes[pos] + 1) / cum(pos, sizes[pos])) / Math.log((sizes[pos] + 1) / sizes[pos])  // 概率增益 / 注数增益
      if (gain > bestGain) { bestGain = gain; best = pos }
    }
    if (best < 0) break
    sizes[best]++
  }
  const sets = sizes.map((k, pos) => orders[pos].slice(0, k).sort((a, b) => a - b))
  const count = sizes.reduce((s, x) => s * x, 1)
  const coverage = sizes.reduce((s, k, pos) => s * cum(pos, k), 1)
  return { sets, sizes, count, coverage: r4(coverage), baseline: r4(count / SPACE), lift: r3(coverage / (count / SPACE)), text: sets.map((s, i) => `${POS_NAMES[i]}[${s.join('')}]`).join(' ') }
}

export function pick(draws: Draw[], o: Partial<PickOpts> = {}) {
  const opt: PickOpts = { count: 500, steps: 60, wParity: 0.6, wSize: 0.4, wCombo: 0.35, btSteps: 30, temp: 1, ...o }
  opt.temp = Math.max(0.5, Math.min(3, opt.temp))
  opt.count = Math.max(10, Math.min(SPACE, Math.round(opt.count)))
  const W = weightsFor(draws, opt.steps, ALL_KEYS)
  const positions = positionDists(draws, opt, W)
  const sig = comboSignals(draws, W)
  const dists = positions.map(p => p.dist), orders = positions.map(p => p.order)
  // 先取 3N 候选（乘积概率），再叠加组合级信号重排
  const raw = kBest(dists, orders, Math.min(SPACE, opt.count * 3))
  const scored = raw.map(x => ({ ...x, s: x.p * comboFactor(x.digits, sig, opt.wCombo) })).sort((a, b) => b.s - a.s).slice(0, opt.count)
  const sumS = scored.reduce((a, b) => a + b.s, 0)
  // 用「重排后的分数」按原乘积概率总质量归一，作为该号的倾向概率
  const massP = raw.reduce((a, b) => a + b.p, 0) * (scored.reduce((a, b) => a + b.p, 0) / raw.reduce((a, b) => a + b.p, 0))
  const nCore = Math.max(1, Math.round(opt.count * 0.1)), nMain = Math.max(nCore, Math.round(opt.count * 0.5))
  const numbers: PickNumber[] = scored.map((x, i) => {
    const p = massP * (x.s / sumS)
    const tags: string[] = []
    x.digits.forEach((d, pos) => { if (positions[pos].order[0] === d) tags.push(`${POS_NAMES[pos]}首选`) })
    const shp = shape3(x.digits[0], x.digits[1], x.digits[2])
    if (shp !== 'mixed') tags.push(SHAPE_CN[SHAPES.indexOf(shp)])
    return { no: x.digits.join(''), digits: x.digits, p: r4(p), lift: r3(p / (1 / SPACE)), rank: i + 1, tier: i < nCore ? 'core' : i < nMain ? 'main' : 'edge', tags }
  })
  const coverage = numbers.reduce((a, b) => a + b.p, 0)
  const diversity = POSN.map(pos => { const c = Array(10).fill(0); for (const x of numbers) c[x.digits[pos]]++; const top = Math.max(...c) / numbers.length; return { pos, distinct: c.filter(v => v > 0).length, topShare: r3(top), topDigit: c.indexOf(Math.max(...c)) } })
  const dup = duplex(dists, orders, opt.count)
  // ---- 诚实回测：最近 btSteps 期，用「之前数据」生成 Top-N，看真实号是否落入
  const bt = { n: 0, hit: 0, ranks: [] as { expect: string; actual: string; hit: boolean; rank: number | null }[] }
  const total = draws.length
  for (let k = opt.btSteps; k >= 1 && total - k >= 120; k--) {
    const hist = draws.slice(k)                 // 最新在前 → slice(k) = 不含最近 k 期
    const truth = draws[k - 1]; const oc = computeOutcomes5(truth.hash); if (!oc) continue
    const pd = positionDists(hist, opt, W)   // 复用当前权重（轻微前视，仅作量级检验）
    const sg = comboSignals(hist, W)
    const rw = kBest(pd.map(p => p.dist), pd.map(p => p.order), Math.min(SPACE, opt.count * 3))
    const sc = rw.map(x => ({ no: x.digits.join(''), s: x.p * comboFactor(x.digits, sg, opt.wCombo) })).sort((a, b) => b.s - a.s).slice(0, opt.count)
    const actual = oc.nums.slice(0, PICK_DIGITS).join('')
    const idx = sc.findIndex(x => x.no === actual)
    bt.n++; if (idx >= 0) bt.hit++
    bt.ranks.push({ expect: truth.expect, actual, hit: idx >= 0, rank: idx >= 0 ? idx + 1 : null })
  }
  const latest = draws[0]?.expect || ''
  return {
    count: opt.count, digits: PICK_DIGITS, space: SPACE, params: { steps: opt.steps, wParity: opt.wParity, wSize: opt.wSize, wCombo: opt.wCombo, temp: opt.temp },
    latest_expect: latest, next_expect: latest && /^\d+$/.test(latest) ? String(BigInt(latest) + 1n) : '',
    positions: positions.map(p => ({ pos: p.pos, posName: p.posName, dist: p.dist, order: p.order, top: p.order.slice(0, 3), parity: p.parity, size: p.size, hot: p.hot, cold: p.cold, gaps: p.gaps })),
    signals: sig.text,
    numbers,
    coverage: { p: r4(coverage), baseline: r4(opt.count / SPACE), lift: r3(coverage / (opt.count / SPACE)) },
    tiers: { core: nCore, main: nMain - nCore, edge: opt.count - nMain },
    diversity,
    duplex: dup,
    backtest: { n: bt.n, hit: bt.hit, rate: bt.n ? r4(bt.hit / bt.n) : null, baseline: r4(opt.count / SPACE), expected_hits: r3(bt.n * opt.count / SPACE), recent: bt.ranks.slice(-20) },
    disclaimer: `理论上任意前三位号（万千百）概率恒为 1/1000，${opt.count} 注的理论覆盖率 = ${(opt.count / 10).toFixed(1)}%。本列表按量化信号排序，回测面板给出真实覆盖率；若与基线无显著差异，请把它当作「有据可循的随机选号器」而非预测。`,
  }
}
