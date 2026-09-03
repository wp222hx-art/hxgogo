// ============ 量化选号器：把全部量化信号折算为「每位 0-9 权重」→ 联合概率 Top-N 五位号码 ============
// 声明：区块哈希逐期独立，任意五位号理论概率恒为 1/100000。本引擎输出的是「统计倾向排序」，
// 回测面板会给出 Top-N 的真实覆盖率 vs N/100000 基线——若长期无显著差异，说明信号无预测力。
import { MARKETS, buildSeries, backtest, ensemble, type Draw } from './analysis'
import { computeOutcomes5, POS_NAMES } from './engine5'
import { parityKline } from './parity_kline'

const r4 = (x: number) => Math.round(x * 10000) / 10000
const r3 = (x: number) => Math.round(x * 1000) / 1000
const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }
const SHAPE_PRIOR: Record<string, number> = { leopard: 0.01, straight: 0.048, pair: 0.27, mixed: 0.672 }

export interface PickOpts { count: number; steps: number; wParity: number; wSize: number; wCombo: number; btSteps: number; temp: number }
export interface PickNumber { no: string; digits: number[]; p: number; lift: number; rank: number; tier: 'core' | 'main' | 'edge'; tags: string[] }

type Weights = Record<string, ReturnType<typeof backtest>['res']>
/** 机制权重（回测一次，后续历史步复用，避免 O(steps²)） */
function weightsFor(draws: Draw[], steps: number, keys: string[]): Weights {
  const w: Weights = {}
  for (const key of keys) { const m = MARKETS.find(x => x.key === key)!; w[key] = backtest(buildSeries(draws, m), m, steps).res }
  return w
}
const ALL_KEYS = [...[0, 1, 2, 3, 4].flatMap(i => [`pos-digit-${i}`, `pos-size-${i}`]), 'sum-size', 'sum-parity', 'dragon', 'shape']

/** 每位 0-9 分布：机制集成 × 单双预判 × 大小倾向 */
function positionDists(draws: Draw[], opt: PickOpts, W: Weights) {
  const out: { pos: number; posName: string; base: number[]; parity: { pOdd: number; side: string; level: string }; size: { pBig: number; tilt: number }; dist: number[]; order: number[]; hot: number[]; cold: number[]; gaps: number[] }[] = []
  for (let i = 0; i < 5; i++) {
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

/** 组合级信号：总和大小/单双、龙虎、前三形态 → 对候选号做温和再加权 */
function comboSignals(draws: Draw[], W: Weights) {
  const get = (key: string) => { const m = MARKETS.find(x => x.key === key)!; const s = buildSeries(draws, m); return { m, en: ensemble(s, m, W[key]) } }
  const ss = get('sum-size'), sp = get('sum-parity'), dr = get('dragon'), sh = get('shape')
  return {
    sumBig: ss.en.p[0], sumOdd: sp.en.p[0], dragon: dr.en.p[0], shape: sh.en.p,
    text: [`总和 ${ss.en.p[0] >= 0.5 ? '大' : '小'} ${(Math.max(ss.en.p[0], 1 - ss.en.p[0]) * 100).toFixed(0)}%`, `总和 ${sp.en.p[0] >= 0.5 ? '单' : '双'} ${(Math.max(sp.en.p[0], 1 - sp.en.p[0]) * 100).toFixed(0)}%`, `${dr.en.p[0] >= 0.5 ? '龙' : '虎'} ${(Math.max(dr.en.p[0], 1 - dr.en.p[0]) * 100).toFixed(0)}%`, `形态 ${['豹子', '顺子', '对子', '杂六'][sh.en.p.indexOf(Math.max(...sh.en.p))]}`],
  }
}

function comboFactor(d: number[], sig: ReturnType<typeof comboSignals>, w: number) {
  const o = computeOutcomes5(d.join('') + 'a')!  // 末 5 位数字即号码；补一位字母不影响提取
  let f = 1
  f *= 1 + w * ((o.sumSize === 'big' ? sig.sumBig : 1 - sig.sumBig) * 2 - 1)
  f *= 1 + w * ((o.sumParity === 'odd' ? sig.sumOdd : 1 - sig.sumOdd) * 2 - 1)
  if (o.dragon !== 'tie') f *= 1 + w * ((o.dragon === 'dragon' ? sig.dragon : 1 - sig.dragon) * 2 - 1)
  const si = ['leopard', 'straight', 'pair', 'mixed'].indexOf(o.shape)
  f *= Math.pow(sig.shape[si] / SHAPE_PRIOR[o.shape], w)   // 形态：相对先验的提升
  return f
}

/** K-best：5 个独立分布乘积的前 K 大组合（最大堆 + 去重） */
function kBest(dists: number[][], orders: number[][], K: number) {
  type Node = { idx: number[]; p: number }
  const heap: Node[] = []
  const push = (n: Node) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const par = (i - 1) >> 1; if (heap[par].p >= heap[i].p) break; [heap[par], heap[i]] = [heap[i], heap[par]]; i = par } }
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l].p > heap[m].p) m = l; if (r < heap.length && heap[r].p > heap[m].p) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
  const pOf = (idx: number[]) => idx.reduce((s, k, pos) => s * dists[pos][orders[pos][k]], 1)
  const seen = new Set<string>(); const start = [0, 0, 0, 0, 0]
  push({ idx: start, p: pOf(start) }); seen.add(start.join(''))
  const out: { digits: number[]; p: number }[] = []
  while (heap.length && out.length < K) {
    const n = pop(); out.push({ digits: n.idx.map((k, pos) => orders[pos][k]), p: n.p })
    for (let pos = 0; pos < 5; pos++) { if (n.idx[pos] >= 9) continue; const nx = [...n.idx]; nx[pos]++; const key = nx.join(''); if (seen.has(key)) continue; seen.add(key); push({ idx: nx, p: pOf(nx) }) }
  }
  return out
}

/** 复式方案：每位取若干数字，使组合数 ≈ N 且覆盖概率最大（贪心） */
function duplex(dists: number[][], orders: number[][], N: number) {
  const sizes = [1, 1, 1, 1, 1]
  const cum = (pos: number, k: number) => orders[pos].slice(0, k).reduce((s, d) => s + dists[pos][d], 0)
  for (;;) {
    let best = -1, bestGain = 0
    for (let pos = 0; pos < 5; pos++) {
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
  return { sets, sizes, count, coverage: r4(coverage), baseline: r4(count / 100000), lift: r3(coverage / (count / 100000)), text: sets.map((s, i) => `${POS_NAMES[i]}[${s.join('')}]`).join(' ') }
}

export function pick(draws: Draw[], o: Partial<PickOpts> = {}) {
  const opt: PickOpts = { count: 500, steps: 60, wParity: 0.6, wSize: 0.4, wCombo: 0.35, btSteps: 30, temp: 1, ...o }
  opt.temp = Math.max(0.5, Math.min(3, opt.temp))
  opt.count = Math.max(10, Math.min(2000, Math.round(opt.count)))
  const W = weightsFor(draws, opt.steps, ALL_KEYS)
  const positions = positionDists(draws, opt, W)
  const sig = comboSignals(draws, W)
  const dists = positions.map(p => p.dist), orders = positions.map(p => p.order)
  // 先取 3N 候选（乘积概率），再叠加组合级信号重排
  const raw = kBest(dists, orders, Math.min(20000, opt.count * 3))
  const scored = raw.map(x => ({ ...x, s: x.p * comboFactor(x.digits, sig, opt.wCombo) })).sort((a, b) => b.s - a.s).slice(0, opt.count)
  const sumS = scored.reduce((a, b) => a + b.s, 0)
  // 用「重排后的分数」按原乘积概率总质量归一，作为该号的倾向概率
  const massP = raw.reduce((a, b) => a + b.p, 0) * (scored.reduce((a, b) => a + b.p, 0) / raw.reduce((a, b) => a + b.p, 0))
  const nCore = Math.max(1, Math.round(opt.count * 0.1)), nMain = Math.max(nCore, Math.round(opt.count * 0.5))
  const numbers: PickNumber[] = scored.map((x, i) => {
    const p = massP * (x.s / sumS)
    const tags: string[] = []
    x.digits.forEach((d, pos) => { if (positions[pos].order[0] === d) tags.push(`${POS_NAMES[pos]}首选`) })
    const oc = computeOutcomes5(x.digits.join('') + 'a')!
    if (oc.shape !== 'mixed') tags.push(['豹子', '顺子', '对子', '杂六'][['leopard', 'straight', 'pair', 'mixed'].indexOf(oc.shape)])
    return { no: x.digits.join(''), digits: x.digits, p: r4(p * 1000) / 1000, lift: r3(p / 1e-5), rank: i + 1, tier: i < nCore ? 'core' : i < nMain ? 'main' : 'edge', tags }
  })
  const coverage = numbers.reduce((a, b) => a + b.p, 0)
  const diversity = [0, 1, 2, 3, 4].map(pos => { const c = Array(10).fill(0); for (const x of numbers) c[x.digits[pos]]++; const top = Math.max(...c) / numbers.length; return { pos, distinct: c.filter(v => v > 0).length, topShare: r3(top), topDigit: c.indexOf(Math.max(...c)) } })
  const dup = duplex(dists, orders, opt.count)
  // ---- 诚实回测：最近 btSteps 期，用「之前数据」生成 Top-N，看真实号是否落入
  const bt = { n: 0, hit: 0, ranks: [] as { expect: string; actual: string; hit: boolean; rank: number | null }[] }
  const total = draws.length
  for (let k = opt.btSteps; k >= 1 && total - k >= 120; k--) {
    const hist = draws.slice(k)                 // 最新在前 → slice(k) = 不含最近 k 期
    const truth = draws[k - 1]; const oc = computeOutcomes5(truth.hash); if (!oc) continue
    const pd = positionDists(hist, opt, W)   // 复用当前权重（轻微前视，仅作量级检验）
    const sg = comboSignals(hist, W)
    const rw = kBest(pd.map(p => p.dist), pd.map(p => p.order), Math.min(20000, opt.count * 3))
    const sc = rw.map(x => ({ no: x.digits.join(''), s: x.p * comboFactor(x.digits, sg, opt.wCombo) })).sort((a, b) => b.s - a.s).slice(0, opt.count)
    const idx = sc.findIndex(x => x.no === oc.nums.join(''))
    bt.n++; if (idx >= 0) bt.hit++
    bt.ranks.push({ expect: truth.expect, actual: oc.nums.join(''), hit: idx >= 0, rank: idx >= 0 ? idx + 1 : null })
  }
  const latest = draws[0]?.expect || ''
  return {
    count: opt.count, params: { steps: opt.steps, wParity: opt.wParity, wSize: opt.wSize, wCombo: opt.wCombo, temp: opt.temp },
    latest_expect: latest, next_expect: latest && /^\d+$/.test(latest) ? String(BigInt(latest) + 1n) : '',
    positions: positions.map(p => ({ pos: p.pos, posName: p.posName, dist: p.dist, order: p.order, top: p.order.slice(0, 3), parity: p.parity, size: p.size, hot: p.hot, cold: p.cold, gaps: p.gaps })),
    signals: sig.text,
    numbers,
    coverage: { p: r4(coverage), baseline: r4(opt.count / 100000), lift: r3(coverage / (opt.count / 100000)) },
    tiers: { core: nCore, main: nMain - nCore, edge: opt.count - nMain },
    diversity,
    duplex: dup,
    backtest: { n: bt.n, hit: bt.hit, rate: bt.n ? r4(bt.hit / bt.n) : null, baseline: r4(opt.count / 100000), expected_hits: r3(bt.n * opt.count / 100000), recent: bt.ranks.slice(-20) },
    disclaimer: `理论上任意五位号概率恒为 1/100000，${opt.count} 注的理论覆盖率 = ${(opt.count / 1000).toFixed(2)}%。本列表按量化信号排序，回测面板给出真实覆盖率；若与基线无显著差异，请把它当作「有据可循的随机选号器」而非预测。`,
  }
}
