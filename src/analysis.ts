// ============ 20 种分析机制 + 集成量化 + 滚动回测 ============
// 重要声明：哈希输出是密码学随机数，任何机制在长期回测中都应收敛于基线 1/k。
// 本模块的价值是「量化展示这一事实」并提供多维统计视角，而非产生真实预测优势。
import { computeOutcomes5, type Outcomes5, POS_NAMES } from './engine5'

export interface Draw { source: string; expect: string; block: number | null; hash: string; n1: number; n2: number; n3: number; n4: number; n5: number; open_ms: number }

// ------------------------------------------------------------ 市场定义
export interface Market { key: string; name: string; classes: string[]; labels: string[]; label: (o: Outcomes5) => number | null }
const bs = ['big', 'small'], oe = ['odd', 'even']
export const MARKETS: Market[] = [
  ...[0, 1, 2, 3, 4].map(i => ({ key: `pos-size-${i}`, name: `${POS_NAMES[i]}位 大小`, classes: bs, labels: ['大', '小'], label: (o: Outcomes5) => bs.indexOf(o.pos.size[i]) })),
  ...[0, 1, 2, 3, 4].map(i => ({ key: `pos-parity-${i}`, name: `${POS_NAMES[i]}位 单双`, classes: oe, labels: ['单', '双'], label: (o: Outcomes5) => oe.indexOf(o.pos.parity[i]) })),
  ...[0, 1, 2, 3, 4].map(i => ({ key: `pos-digit-${i}`, name: `${POS_NAMES[i]}位 定位胆`, classes: '0123456789'.split(''), labels: '0123456789'.split(''), label: (o: Outcomes5) => o.nums[i] })),
  { key: 'sum-size', name: '总和 大小', classes: bs, labels: ['大(≥23)', '小(≤22)'], label: o => bs.indexOf(o.sumSize) },
  { key: 'sum-parity', name: '总和 单双', classes: oe, labels: ['单', '双'], label: o => oe.indexOf(o.sumParity) },
  { key: 'dragon', name: '龙虎（万 vs 个）', classes: ['dragon', 'tiger'], labels: ['龙', '虎'], label: o => o.dragon === 'tie' ? null : (o.dragon === 'dragon' ? 0 : 1) },
  { key: 'shape', name: '前三形态', classes: ['leopard', 'straight', 'pair', 'mixed'], labels: ['豹子', '顺子', '对子', '杂六'], label: o => ['leopard', 'straight', 'pair', 'mixed'].indexOf(o.shape) },
]
export const marketByKey = (k: string) => MARKETS.find(m => m.key === k)

// 理论先验（均匀 or 组合概率）
function prior(m: Market): number[] {
  if (m.key === 'shape') return [0.01, 0.048, 0.27, 0.672]           // 3 位 0-9：豹子 10/1000，顺子 48/1000，对子 270/1000
  if (m.key === 'sum-size') return [0.5, 0.5]                         // 和 22.5 中心近似对称
  return Array(m.classes.length).fill(1 / m.classes.length)
}

// ------------------------------------------------------------ 机制
export interface Ctx { seq: number[]; hours: number[]; hashes: string[]; prevSumBig: number[]; k: number; prior: number[] }
export interface Mechanism { id: number; name: string; group: string; desc: string; predict: (c: Ctx) => number[] }

const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }
const uniform = (k: number) => Array(k).fill(1 / k)
const smooth = (counts: number[], alpha = 1) => norm(counts.map(c => c + alpha))
function countWin(seq: number[], k: number, n: number) { const c = Array(k).fill(0); for (const v of seq.slice(-n)) c[v]++; return c }
function streak(seq: number[]) { if (!seq.length) return { v: -1, len: 0 }; const v = seq[seq.length - 1]; let len = 1; for (let i = seq.length - 2; i >= 0 && seq[i] === v; i--) len++; return { v, len } }
function gaps(seq: number[], k: number) { const g = Array(k).fill(seq.length); for (let i = seq.length - 1; i >= 0; i--) { if (g[seq[i]] === seq.length) g[seq[i]] = seq.length - 1 - i } return g }
function mix(p: number[], q: number[], w: number) { return p.map((x, i) => x * (1 - w) + q[i] * w) }

export const MECHANISMS: Mechanism[] = [
  { id: 1, name: '全量频率', group: '频率', desc: '全部历史出现频率（拉普拉斯平滑）', predict: c => smooth(countWin(c.seq, c.k, c.seq.length)) },
  { id: 2, name: '近 30 期频率', group: '频率', desc: '最近 30 期出现频率', predict: c => smooth(countWin(c.seq, c.k, 30)) },
  { id: 3, name: '近 100 期频率', group: '频率', desc: '最近 100 期出现频率', predict: c => smooth(countWin(c.seq, c.k, 100)) },
  { id: 4, name: '指数加权频率', group: '频率', desc: 'EWMA α=0.05，越近权重越高', predict: c => { const w = Array(c.k).fill(0.5); let a = 1; for (let i = c.seq.length - 1; i >= 0 && a > 1e-4; i--) { w[c.seq[i]] += a; a *= 0.95 } return norm(w) } },
  { id: 5, name: '遗漏回补', group: '遗漏', desc: '当前遗漏越久，权重越高（追冷）', predict: c => { const g = gaps(c.seq, c.k); return norm(g.map(x => 1 + x)) } },
  { id: 6, name: '热号延续', group: '遗漏', desc: '近 20 期出现越多权重越高（追热）', predict: c => { const cnt = countWin(c.seq, c.k, 20); return norm(cnt.map(x => (x + 0.5) ** 1.5)) } },
  { id: 7, name: '长龙反转', group: '形态', desc: '连续 ≥3 期同结果时押反转，长度越长越强', predict: c => { const s = streak(c.seq); const p = uniform(c.k); if (s.len >= 3 && c.k <= 4) { const shift = Math.min(0.35, 0.08 * s.len); p[s.v] -= shift; const others = c.k - 1; for (let i = 0; i < c.k; i++) if (i !== s.v) p[i] += shift / others } return p } },
  { id: 8, name: '长龙跟随', group: '形态', desc: '连续 ≥3 期同结果时跟随（顺龙）', predict: c => { const s = streak(c.seq); const p = uniform(c.k); if (s.len >= 3 && c.k <= 4) { const shift = Math.min(0.35, 0.08 * s.len); p[s.v] += shift; for (let i = 0; i < c.k; i++) if (i !== s.v) p[i] -= shift / (c.k - 1) } return p } },
  { id: 9, name: '一阶马尔可夫', group: '转移', desc: 'P(下一期 | 上一期) 转移矩阵', predict: c => { if (c.seq.length < 2) return uniform(c.k); const last = c.seq[c.seq.length - 1]; const cnt = Array(c.k).fill(0); for (let i = 0; i < c.seq.length - 1; i++) if (c.seq[i] === last) cnt[c.seq[i + 1]]++; return smooth(cnt) } },
  { id: 10, name: '二阶马尔可夫', group: '转移', desc: 'P(下一期 | 前两期)', predict: c => { const n = c.seq.length; if (n < 3) return uniform(c.k); const a = c.seq[n - 2], b = c.seq[n - 1]; const cnt = Array(c.k).fill(0); for (let i = 0; i < n - 2; i++) if (c.seq[i] === a && c.seq[i + 1] === b) cnt[c.seq[i + 2]]++; return smooth(cnt, 0.5) } },
  { id: 11, name: '最佳滞后周期', group: '周期', desc: '在 lag 2~12 中找历史吻合率最高的周期，按该 lag 取值', predict: c => { const n = c.seq.length; if (n < 40) return uniform(c.k); let best = 2, bestAcc = -1; for (let lag = 2; lag <= 12; lag++) { let hit = 0, tot = 0; for (let i = lag; i < n; i++) { tot++; if (c.seq[i] === c.seq[i - lag]) hit++ } const acc = hit / tot; if (acc > bestAcc) { bestAcc = acc; best = lag } } const p = uniform(c.k); const v = c.seq[n - best]; const w = Math.max(0, Math.min(0.3, (bestAcc - 1 / c.k) * 2)); p[v] += w; for (let i = 0; i < c.k; i++) if (i !== v) p[i] -= w / (c.k - 1); return p } },
  { id: 12, name: '交替模式', group: '形态', desc: '检测 ABAB 交替，若近 4 期严格交替则预测继续交替', predict: c => { const n = c.seq.length; const p = uniform(c.k); if (n < 4 || c.k !== 2) return p; const t = c.seq.slice(-4); if (t[0] !== t[1] && t[1] !== t[2] && t[2] !== t[3]) { const v = 1 - t[3]; p[v] += 0.2; p[1 - v] -= 0.2 } return p } },
  { id: 13, name: '均值回归', group: '统计', desc: '近 100 期频率偏离理论值越多，越押向理论值回归', predict: c => { const f = norm(countWin(c.seq, c.k, Math.min(100, c.seq.length)).map(x => x + 1e-9)); return norm(c.prior.map((pr, i) => Math.max(1e-6, 2 * pr - f[i]))) } },
  { id: 14, name: '卡方偏差跟随', group: '统计', desc: '近 200 期卡方检验显著（p<0.05）则跟随偏差，否则回归先验', predict: c => { const n = Math.min(200, c.seq.length); if (n < 30) return c.prior; const cnt = countWin(c.seq, c.k, n); let chi = 0; for (let i = 0; i < c.k; i++) { const e = n * c.prior[i]; chi += (cnt[i] - e) ** 2 / e } const crit = [0, 3.84, 5.99, 7.81, 9.49, 11.07, 12.59, 14.07, 15.51, 16.92][c.k - 1] ?? 16.92; return chi > crit ? norm(cnt.map(x => x + 1)) : c.prior } },
  { id: 15, name: '熵收缩', group: '统计', desc: '计算近 50 期香农熵，熵越接近最大值越收缩至先验（随机性检测）', predict: c => { const n = Math.min(50, c.seq.length); if (n < 10) return c.prior; const f = norm(countWin(c.seq, c.k, n)); const H = -f.reduce((s, x) => s + (x > 0 ? x * Math.log2(x) : 0), 0); const Hmax = Math.log2(c.k); const rnd = H / Hmax; return mix(f, c.prior, rnd) } },
  { id: 16, name: '时段条件频率', group: '条件', desc: '仅统计与当前同一小时（UTC+8）的历史期次', predict: c => { const h = c.hours[c.hours.length - 1]; const cnt = Array(c.k).fill(0); for (let i = 0; i < c.seq.length; i++) if (c.hours[i] === h) cnt[c.seq[i]]++; return smooth(cnt, 2) } },
  { id: 17, name: '哈希字母密度条件', group: '条件', desc: '按上一期哈希末 10 位中字母 (a-f) 数量分桶，统计条件频率', predict: c => { const n = c.hashes.length; if (n < 2) return uniform(c.k); const bucket = (h: string) => Math.min(3, Math.floor((h.slice(-10).replace(/[0-9]/g, '').length) / 2)); const b = bucket(c.hashes[n - 1]); const cnt = Array(c.k).fill(0); for (let i = 0; i < n - 1; i++) if (bucket(c.hashes[i]) === b) cnt[c.seq[i + 1]]++; return smooth(cnt, 2) } },
  { id: 18, name: '跨维联动', group: '条件', desc: '以上一期「总和大小」为条件的条件频率', predict: c => { const n = c.seq.length; if (n < 2) return uniform(c.k); const cond = c.prevSumBig[n - 1]; const cnt = Array(c.k).fill(0); for (let i = 0; i < n - 1; i++) if (c.prevSumBig[i] === cond) cnt[c.seq[i + 1]]++; return smooth(cnt, 2) } },
  { id: 19, name: '贝叶斯后验', group: '统计', desc: 'Dirichlet 先验(强度 20) + 近 200 期计数的后验均值', predict: c => { const cnt = countWin(c.seq, c.k, 200); return norm(cnt.map((x, i) => x + 20 * c.prior[i])) } },
  { id: 20, name: '块 Bootstrap', group: '统计', desc: '对近 200 期做 40 次块重采样（块长 5），取重采样频率均值', predict: c => { const src = c.seq.slice(-200); if (src.length < 20) return c.prior; const acc = Array(c.k).fill(0); let seed = src.length * 7919 + (src[src.length - 1] + 1) * 104729; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }; for (let r = 0; r < 40; r++) { const cnt = Array(c.k).fill(0); let got = 0; while (got < src.length) { const s = Math.floor(rnd() * (src.length - 5)); for (let j = 0; j < 5 && got < src.length; j++, got++) cnt[src[s + j]]++ } const f = norm(cnt); for (let i = 0; i < c.k; i++) acc[i] += f[i] } return norm(acc) } },
]

// ------------------------------------------------------------ 构建上下文
export function buildSeries(draws: Draw[], m: Market) {
  // draws: 最新在前 -> 转为最旧在前
  const asc = [...draws].reverse()
  const seq: number[] = [], hours: number[] = [], hashes: string[] = [], prevSumBig: number[] = [], expects: string[] = []
  for (const d of asc) {
    const o = computeOutcomes5(d.hash); if (!o) continue
    const l = m.label(o); if (l === null) continue
    seq.push(l); hours.push(new Date(d.open_ms + 8 * 3600_000).getUTCHours()); hashes.push(d.hash); prevSumBig.push(o.sumSize === 'big' ? 1 : 0); expects.push(d.expect)
  }
  return { seq, hours, hashes, prevSumBig, expects }
}

export interface Backtest { id: number; name: string; group: string; desc: string; acc: number; logloss: number; n: number; edge: number; weight: number; recent: number[] }

/** 滚动回测：对最近 steps 期逐期用「之前所有数据」预测，评估命中率与 log-loss */
export function backtest(series: ReturnType<typeof buildSeries>, m: Market, steps = 150) {
  const k = m.classes.length, pr = prior(m)
  const n = series.seq.length
  const start = Math.max(30, n - steps)
  const res: Backtest[] = MECHANISMS.map(mc => ({ id: mc.id, name: mc.name, group: mc.group, desc: mc.desc, acc: 0, logloss: 0, n: 0, edge: 0, weight: 0, recent: [] }))
  const baseLL = -Math.log(1 / k)
  for (let t = start; t < n; t++) {
    const ctx: Ctx = { seq: series.seq.slice(0, t), hours: series.hours.slice(0, t + 1), hashes: series.hashes.slice(0, t), prevSumBig: series.prevSumBig.slice(0, t), k, prior: pr }
    const truth = series.seq[t]
    MECHANISMS.forEach((mc, i) => {
      const p = mc.predict(ctx); const pick = p.indexOf(Math.max(...p))
      const hit = pick === truth ? 1 : 0
      res[i].acc += hit; res[i].logloss += -Math.log(Math.max(1e-6, p[truth])); res[i].n++
      if (res[i].recent.length < 30) res[i].recent.push(hit)
    })
  }
  for (const r of res) {
    if (r.n) { r.acc /= r.n; r.logloss /= r.n }
    r.edge = r.acc - 1 / k
    // 权重：log-loss 优于基线的程度（softmax 温度 5），最低 0.2 防止归零
    r.weight = Math.max(0.2, Math.exp(5 * (baseLL - r.logloss)))
    r.recent.reverse()
  }
  const ws = res.reduce((s, r) => s + r.weight, 0); for (const r of res) r.weight /= ws
  return { res, steps: n - start, baseline: 1 / k }
}

/** 集成预测 + 量化倾向 */
export function ensemble(series: ReturnType<typeof buildSeries>, m: Market, bt: Backtest[]) {
  const k = m.classes.length, pr = prior(m)
  const ctx: Ctx = { seq: series.seq, hours: [...series.hours, new Date(Date.now() + 8 * 3600_000).getUTCHours()], hashes: series.hashes, prevSumBig: series.prevSumBig, k, prior: pr }
  const per = MECHANISMS.map((mc, i) => ({ id: mc.id, name: mc.name, p: mc.predict(ctx), weight: bt[i].weight }))
  const agg = Array(k).fill(0); for (const x of per) for (let i = 0; i < k; i++) agg[i] += x.p[i] * x.weight
  const p = norm(agg)
  const top = p.indexOf(Math.max(...p))
  const tilt = Math.round(((p[top] - 1 / k) / (1 - 1 / k)) * 1000) / 10   // 倾向指数 0~100
  const votes = Array(k).fill(0); for (const x of per) votes[x.p.indexOf(Math.max(...x.p))]++
  // 一致性：机制间投票熵
  const vf = norm(votes); const H = -vf.reduce((s, x) => s + (x > 0 ? x * Math.log2(x) : 0), 0)
  const consensus = Math.round((1 - H / Math.log2(k)) * 100)
  return { p, top, tilt, votes, consensus, per, streak: streak(series.seq), gaps: gaps(series.seq, k), n: series.seq.length }
}

// ------------------------------------------------------------ 多维统计（图表用）
export function stats(draws: Draw[]) {
  const asc = [...draws].reverse().map(d => ({ d, o: computeOutcomes5(d.hash)! })).filter(x => x.o)
  const n = asc.length
  const digitFreq = [0, 1, 2, 3, 4].map(() => Array(10).fill(0))
  const sumDist = Array(46).fill(0)
  const shape = { leopard: 0, straight: 0, pair: 0, mixed: 0 }
  const dragon = { dragon: 0, tiger: 0, tie: 0 }
  const hourly: Record<number, { n: number; big: number; odd: number }> = {}
  const gapsNow = [0, 1, 2, 3, 4].map(() => Array(10).fill(n)); const maxGap = [0, 1, 2, 3, 4].map(() => Array(10).fill(0)); const lastSeen = [0, 1, 2, 3, 4].map(() => Array(10).fill(-1))
  const roll: { expect: string; sum: number; bigRate: number; oddRate: number }[] = []
  let winBig = 0, winOdd = 0; const W = 30; const bigQ: number[] = [], oddQ: number[] = []
  const maxStreak: Record<string, number> = {}; const cur: Record<string, { v: any; len: number }> = {}
  asc.forEach(({ d, o }, idx) => {
    o.nums.forEach((v, i) => { digitFreq[i][v]++; if (lastSeen[i][v] >= 0) maxGap[i][v] = Math.max(maxGap[i][v], idx - lastSeen[i][v] - 1); lastSeen[i][v] = idx })
    sumDist[o.sum]++; shape[o.shape]++; dragon[o.dragon]++
    const h = new Date(d.open_ms + 8 * 3600_000).getUTCHours(); hourly[h] ??= { n: 0, big: 0, odd: 0 }; hourly[h].n++; if (o.sumSize === 'big') hourly[h].big++; if (o.sumParity === 'odd') hourly[h].odd++
    const b = o.sumSize === 'big' ? 1 : 0, od = o.sumParity === 'odd' ? 1 : 0
    bigQ.push(b); oddQ.push(od); winBig += b; winOdd += od; if (bigQ.length > W) { winBig -= bigQ.shift()!; winOdd -= oddQ.shift()! }
    if (idx % Math.max(1, Math.floor(n / 120)) === 0 || idx === n - 1) roll.push({ expect: d.expect, sum: o.sum, bigRate: winBig / bigQ.length, oddRate: winOdd / oddQ.length })
    for (const [key, val] of [['sum-size', o.sumSize], ['sum-parity', o.sumParity], ['dragon', o.dragon], ...[0, 1, 2, 3, 4].map(i => [`pos-size-${i}`, o.pos.size[i]]), ...[0, 1, 2, 3, 4].map(i => [`pos-parity-${i}`, o.pos.parity[i]])] as [string, any][]) {
      if (cur[key]?.v === val) cur[key].len++; else cur[key] = { v: val, len: 1 }
      maxStreak[key] = Math.max(maxStreak[key] || 0, cur[key].len)
    }
  })
  for (let i = 0; i < 5; i++) for (let v = 0; v < 10; v++) gapsNow[i][v] = lastSeen[i][v] < 0 ? n : n - 1 - lastSeen[i][v]
  return { n, digitFreq, sumDist, shape, dragon, hourly, gapsNow, maxGap, roll, maxStreak, currentStreak: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v])) , range: n ? { from: asc[0].d.open_ms, to: asc[n - 1].d.open_ms } : null }
}
