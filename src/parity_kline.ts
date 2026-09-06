// ============ 单双 K 线 + 技术指标（BOLL / MACD / KDJ） ============
// 把「某位置开单」当成一只股票：单指数 = 100 + Σ(开单 ? +1 : -1)，双指数 = 100 + Σ(开双 ? +1 : -1)
// 逐期为 tick，按 bucket 期聚合成 OHLC 蜡烛；在收盘价序列上计算 BOLL / MACD / KDJ，
// 三指标投票 → 下一期开单/开双概率；并对历史逐根回测，给出真实命中率（对照 50% 基线）。
import { POS_NAMES } from './engine5'
import { outcomesForDraw, type Draw } from './analysis'

const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d
type Num = number | null

export interface PCandle { i: number; expect: string; from: string; to: string; t: number; o: number; h: number; l: number; c: number; v: number; hits: number; dir: 1 | -1 | 0 }

/** tick 路径 → 蜡烛（末根对齐最新一期） */
function candlesFromTicks(hits: number[], meta: { expect: string; t: number }[], bucket: number, start0 = 100): PCandle[] {
  const out: PCandle[] = []
  const n = hits.length
  const start = n % bucket
  let price = start0
  // 让起点前的散段也计入价格（保持路径连续），但不出蜡烛
  for (let i = 0; i < start; i++) price += hits[i] ? 1 : -1
  for (let s = start; s < n; s += bucket) {
    const e = Math.min(n, s + bucket)
    const o = price; let h = price, l = price, hs = 0
    for (let i = s; i < e; i++) { price += hits[i] ? 1 : -1; hs += hits[i]; h = Math.max(h, price); l = Math.min(l, price) }
    const c = price
    out.push({ i: out.length, expect: meta[e - 1].expect, from: meta[s].expect, to: meta[e - 1].expect, t: meta[e - 1].t, o, h, l, c, v: e - s, hits: hs, dir: c > o ? 1 : c < o ? -1 : 0 })
  }
  return out
}

// ---------------- 指标 ----------------
function sma(a: number[], w: number): Num[] { const out: Num[] = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= w) s -= a[i - w]; out.push(i >= w - 1 ? s / w : null) } return out }
function ema(a: number[], w: number): number[] { const k = 2 / (w + 1); const out: number[] = []; let prev = a[0] ?? 0; for (let i = 0; i < a.length; i++) { prev = i === 0 ? a[0] : a[i] * k + prev * (1 - k); out.push(prev) } return out }

export function boll(close: number[], w = 20, k = 2) {
  const mid = sma(close, w); const up: Num[] = [], low: Num[] = [], pb: Num[] = [], bw: Num[] = []
  for (let i = 0; i < close.length; i++) {
    if (mid[i] == null) { up.push(null); low.push(null); pb.push(null); bw.push(null); continue }
    let ss = 0; for (let j = i - w + 1; j <= i; j++) ss += (close[j] - mid[i]!) ** 2
    const sd = Math.sqrt(ss / w); const u = mid[i]! + k * sd, l = mid[i]! - k * sd
    up.push(r2(u)); low.push(r2(l)); pb.push(u === l ? 0.5 : r2((close[i] - l) / (u - l), 3)); bw.push(r2((u - l) / (mid[i]! || 1), 4))
  }
  return { mid: mid.map(v => v == null ? null : r2(v)), up, low, pb, bw }
}
export function macd(close: number[], f = 12, s = 26, sig = 9) {
  const ef = ema(close, f), es = ema(close, s)
  const dif = ef.map((v, i) => v - es[i]); const dea = ema(dif, sig)
  const hist = dif.map((v, i) => 2 * (v - dea[i]))
  // 前 s 根不稳定 → 置 null
  const mask = (a: number[]) => a.map((v, i) => i < s - 1 ? null : r2(v, 3))
  return { dif: mask(dif), dea: mask(dea), hist: mask(hist) }
}
export function kdj(c: PCandle[], n = 9, m1 = 3, m2 = 3) {
  const K: Num[] = [], D: Num[] = [], J: Num[] = []; let k = 50, d = 50
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) { K.push(null); D.push(null); J.push(null); continue }
    let h = -Infinity, l = Infinity; for (let j = i - n + 1; j <= i; j++) { h = Math.max(h, c[j].h); l = Math.min(l, c[j].l) }
    const rsv = h === l ? 50 : (c[i].c - l) / (h - l) * 100
    k = (k * (m1 - 1) + rsv) / m1; d = (d * (m2 - 1) + k) / m2
    K.push(r2(k)); D.push(r2(d)); J.push(r2(3 * k - 2 * d))
  }
  return { k: K, d: D, j: J }
}

// ---------------- 单指标投票（-1..+1，正=看多该指数，即下一根继续涨） ----------------
interface Vote { v: number; text: string; state: string }
function voteBoll(b: ReturnType<typeof boll>, close: number[], i: number): Vote {
  const pb = b.pb[i], mid = b.mid[i], midPrev = b.mid[i - 1]
  if (pb == null || mid == null) return { v: 0, text: '数据不足', state: 'na' }
  const slope = midPrev == null ? 0 : mid - midPrev
  if (pb > 1) return { v: -0.6, text: '收盘突破上轨（%B>1），超买 → 均值回归看跌', state: 'overbought' }
  if (pb < 0) return { v: 0.6, text: '收盘跌破下轨（%B<0），超卖 → 均值回归看涨', state: 'oversold' }
  if (pb > 0.8) return { v: slope > 0 ? 0.2 : -0.3, text: `贴近上轨（%B=${pb}），中轨${slope > 0 ? '上行→顺势偏多' : '走平→谨慎'}`, state: 'upper' }
  if (pb < 0.2) return { v: slope < 0 ? -0.2 : 0.3, text: `贴近下轨（%B=${pb}），中轨${slope < 0 ? '下行→顺势偏空' : '走平→反弹预期'}`, state: 'lower' }
  const v = close[i] > mid ? (slope > 0 ? 0.35 : 0.1) : (slope < 0 ? -0.35 : -0.1)
  return { v, text: `价在中轨${close[i] > mid ? '上' : '下'}方，中轨${slope > 0 ? '↗' : slope < 0 ? '↘' : '→'}，%B=${pb}`, state: close[i] > mid ? 'above' : 'below' }
}
function voteMacd(m: ReturnType<typeof macd>, i: number): Vote {
  const dif = m.dif[i], dea = m.dea[i], h = m.hist[i], hp = m.hist[i - 1], dp = m.dif[i - 1], ep = m.dea[i - 1]
  if (dif == null || dea == null || h == null || hp == null || dp == null || ep == null) return { v: 0, text: '数据不足', state: 'na' }
  const golden = dp <= ep && dif > dea, death = dp >= ep && dif < dea
  if (golden) return { v: 0.9, text: 'DIF 上穿 DEA（金叉）→ 动能转多', state: 'golden' }
  if (death) return { v: -0.9, text: 'DIF 下穿 DEA（死叉）→ 动能转空', state: 'death' }
  if (dif > dea) return { v: h > hp ? 0.6 : 0.25, text: `多头（DIF>DEA），红柱${h > hp ? '放大→加速' : '缩短→减速'}`, state: 'bull' }
  return { v: h < hp ? -0.6 : -0.25, text: `空头（DIF<DEA），绿柱${h < hp ? '放大→加速' : '缩短→减速'}`, state: 'bear' }
}
function voteKdj(k: ReturnType<typeof kdj>, i: number): Vote {
  const K = k.k[i], D = k.d[i], J = k.j[i], Kp = k.k[i - 1], Dp = k.d[i - 1]
  if (K == null || D == null || J == null || Kp == null || Dp == null) return { v: 0, text: '数据不足', state: 'na' }
  const golden = Kp <= Dp && K > D, death = Kp >= Dp && K < D
  if (J > 100) return { v: -0.7, text: `J=${J}>100 极度超买 → 反转看跌`, state: 'overbought' }
  if (J < 0) return { v: 0.7, text: `J=${J}<0 极度超卖 → 反转看涨`, state: 'oversold' }
  if (golden) return { v: K < 50 ? 0.9 : 0.5, text: `K 上穿 D 金叉${K < 50 ? '（低位，信号强）' : '（高位，信号弱）'}`, state: 'golden' }
  if (death) return { v: K > 50 ? -0.9 : -0.5, text: `K 下穿 D 死叉${K > 50 ? '（高位，信号强）' : '（低位，信号弱）'}`, state: 'death' }
  if (K > 80) return { v: -0.3, text: `K=${K} 超买区，多头衰竭风险`, state: 'high' }
  if (K < 20) return { v: 0.3, text: `K=${K} 超卖区，随时反弹`, state: 'low' }
  return { v: K > D ? 0.3 : -0.3, text: `K${K > D ? '>' : '<'}D，${K > D ? '多头' : '空头'}延续`, state: K > D ? 'bull' : 'bear' }
}

const W = { boll: 0.3, macd: 0.4, kdj: 0.3 }
function combo(b: Vote, m: Vote, k: Vote) { return r2(W.boll * b.v + W.macd * m.v + W.kdj * k.v, 3) }

/** 一条指数的完整分析 */
function analyze(hits: number[], meta: { expect: string; t: number }[], bucket: number, label: string) {
  const candles = candlesFromTicks(hits, meta, bucket)
  const close = candles.map(c => c.c)
  const B = boll(close), M = macd(close), K = kdj(candles)
  const last = candles.length - 1
  const votes = { boll: voteBoll(B, close, last), macd: voteMacd(M, last), kdj: voteKdj(K, last) }
  const score = combo(votes.boll, votes.macd, votes.kdj)
  // ---- 逐根回测：第 i 根信号 vs 第 i+1 根方向（忽略平根）
  const bt = { boll: { n: 0, hit: 0 }, macd: { n: 0, hit: 0 }, kdj: { n: 0, hit: 0 }, combo: { n: 0, hit: 0 } }
  const recent: { expect: string; score: number; actual: number; ok: boolean }[] = []
  for (let i = 30; i < last; i++) {
    const actual = candles[i + 1].dir; if (!actual) continue
    const vb = voteBoll(B, close, i), vm = voteMacd(M, i), vk = voteKdj(K, i)
    const sc = combo(vb, vm, vk)
    const tally = (key: keyof typeof bt, v: number) => { if (Math.abs(v) < 0.05) return; bt[key].n++; if (Math.sign(v) === actual) bt[key].hit++ }
    tally('boll', vb.v); tally('macd', vm.v); tally('kdj', vk.v); tally('combo', sc)
    if (i >= last - 20 && Math.abs(sc) >= 0.05) recent.push({ expect: candles[i + 1].expect, score: sc, actual, ok: Math.sign(sc) === actual })
  }
  const rate = (x: { n: number; hit: number }) => ({ ...x, rate: x.n ? r2(x.hit / x.n, 3) : null })
  const total = hits.reduce((a, b) => a + b, 0)
  let streak = 0; for (let i = hits.length - 1; i >= 0 && hits[i] === hits[hits.length - 1]; i--) streak++
  return {
    label, candles, boll: B, macd: M, kdj: K, votes, score,
    stats: { total, rate: r2(total / hits.length, 4), last: close[last], change20: candles.length > 20 ? close[last] - close[last - 20] : 0, streak: { hit: !!hits[hits.length - 1], len: streak } },
    backtest: { boll: rate(bt.boll), macd: rate(bt.macd), kdj: rate(bt.kdj), combo: rate(bt.combo), recent },
  }
}

export function parityKline(draws: Draw[], opt: { pos: number; bucket: number }) {
  const asc = [...draws].reverse().map(d => ({ d, o: outcomesForDraw(d)! })).filter(x => x.o)
  const meta = asc.map(x => ({ expect: x.d.expect, t: x.d.open_ms }))
  const digits = asc.map(x => x.o.nums[opt.pos])
  const oddHits = digits.map(v => v % 2)          // 1=单
  const evenHits = digits.map(v => 1 - v % 2)     // 1=双
  const odd = analyze(oddHits, meta, opt.bucket, '单')
  const even = analyze(evenHits, meta, opt.bucket, '双')
  // ---- 综合预判：单指数看多 & 双指数看空 → 单
  const s = r2((odd.score - even.score) / 2, 3)   // -1..1，正=单
  const tilt = Math.max(-0.2, Math.min(0.2, s * 0.25))   // 概率倾斜上限 ±20%
  const pOdd = r2(0.5 + tilt, 3), pEven = r2(1 - pOdd, 3)
  const side = Math.abs(s) < 0.08 ? 'neutral' : s > 0 ? 'odd' : 'even'
  const level = Math.abs(s) >= 0.45 ? 'strong' : Math.abs(s) >= 0.2 ? 'mild' : 'neutral'
  const agree = [odd.votes.boll.v, odd.votes.macd.v, odd.votes.kdj.v].filter(v => Math.abs(v) >= 0.05)
  const consensus = agree.length ? agree.filter(v => Math.sign(v) === Math.sign(s || 1)).length : 0
  const reasons = [
    `BOLL｜单指数：${odd.votes.boll.text}`,
    `MACD｜单指数：${odd.votes.macd.text}`,
    `KDJ｜单指数：${odd.votes.kdj.text}`,
    `双指数为单指数镜像，三指标信号相反，作交叉确认（双：BOLL ${even.votes.boll.state} / MACD ${even.votes.macd.state} / KDJ ${even.votes.kdj.state}）`,
  ]
  const strategy = side === 'neutral'
    ? '三指标分歧或信号弱，本期不建议押注方向；等待 MACD/KDJ 出现明确金叉或死叉、或价格触及布林上下轨再介入。'
    : `${consensus}/3 指标同向，${level === 'strong' ? '信号较强' : '信号温和'}：本期倾向「${side === 'odd' ? '单' : '双'}」。仓位建议 ${level === 'strong' ? '2 单位' : '1 单位'}；若连错 2 期即停手复盘（控制回撤），若命中则维持至指标反转。`
  // 最近 10 期单双序列
  const seq = digits.slice(-30).map(v => ({ d: v, p: v % 2 ? '单' : '双' }))
  const nextExpect = meta.length && /^\d+$/.test(meta[meta.length - 1].expect) ? String(BigInt(meta[meta.length - 1].expect) + 1n) : ''
  return {
    n: asc.length, pos: opt.pos, posName: POS_NAMES[opt.pos] + '位', bucket: opt.bucket, params: { boll: '20,2', macd: '12,26,9', kdj: '9,3,3', weights: W },
    latest_expect: meta[meta.length - 1]?.expect || '', next_expect: nextExpect, latest_t: meta[meta.length - 1]?.t || 0,
    odd, even, seq,
    forecast: { score: s, pOdd, pEven, side, level, consensus, reasons, strategy },
    disclaimer: '技术指标源自金融市场趋势假设；区块哈希逐期独立、单双理论概率各 50%（长期均值回归是数学必然）。上方回测命中率是对本套规则的真实历史检验：若长期 ≈50%，说明指标不具预测力，请以娴乐心态参考。',
  }
}
