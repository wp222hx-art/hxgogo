// ============ K 线引擎：把「出现频率」当作价格，做成 OHLC 蜡烛 ============
// 思路：对目标事件（某位置出现某数字 / 总和 / 大率 / 单率）计算滚动频率序列，
// 再按 bucket 期为一根 K 线，取 开(首)/高(最大)/低(最小)/收(末)，成交量 = 该 bucket 内实际命中次数。
// 阳线（收 > 开）= 该数字在这一段时间内“升温”，阴线 = “降温”。均线 MA5/MA20 = 频率的中长期趋势。
import { computeOutcomes5, POS_NAMES } from './engine5'
import type { Draw } from './analysis'

export interface Candle { i: number; expect: string; from: string; to: string; t: number; o: number; h: number; l: number; c: number; v: number; ev: number }

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d

/** 通用：把一个数值序列按 bucket 聚合成 K 线 */
export function toCandles(vals: number[], hits: number[], meta: { expect: string; t: number }[], bucket: number, evPer: number): Candle[] {
  const out: Candle[] = []
  const n = vals.length
  // 让最后一根 K 线对齐到最新一期：从尾部往前切
  const start = n % bucket
  for (let s = start; s < n; s += bucket) {
    const e = Math.min(n, s + bucket)
    const slice = vals.slice(s, e)
    let v = 0; for (let i = s; i < e; i++) v += hits[i]
    out.push({ i: out.length, expect: meta[e - 1].expect, from: meta[s].expect, to: meta[e - 1].expect, t: meta[e - 1].t, o: round(slice[0]), h: round(Math.max(...slice)), l: round(Math.min(...slice)), c: round(slice[slice.length - 1]), v, ev: round(evPer * (e - s), 2) })
  }
  return out
}

export function ma(closes: number[], w: number) { const out: (number | null)[] = []; let s = 0; for (let i = 0; i < closes.length; i++) { s += closes[i]; if (i >= w) s -= closes[i - w]; out.push(i >= w - 1 ? round(s / w) : null) } return out }

/** 滚动频率 */
function rolling(hits: number[], W: number, denomPer: number) { const out: number[] = []; let s = 0; for (let i = 0; i < hits.length; i++) { s += hits[i]; if (i >= W) s -= hits[i - W]; const len = Math.min(W, i + 1); out.push(s / (len * denomPer)) } return out }

export interface KlineOpts { digit: number; pos: number | 'any'; bucket: number; window: number }

export function kline(draws: Draw[], opt: KlineOpts) {
  const asc = [...draws].reverse().map(d => ({ d, o: computeOutcomes5(d.hash)! })).filter(x => x.o)
  const n = asc.length
  const meta = asc.map(x => ({ expect: x.d.expect, t: x.d.open_ms }))
  const per = opt.pos === 'any' ? 5 : 1                       // 每期可命中的位数
  const base = 0.1                                            // 理论频率 10%
  // ---- 目标数字命中序列
  const hits = asc.map(x => opt.pos === 'any' ? x.o.nums.filter(v => v === opt.digit).length : (x.o.nums[opt.pos as number] === opt.digit ? 1 : 0))
  const freq = rolling(hits, opt.window, per)
  const candles = toCandles(freq, hits, meta, opt.bucket, per * base)
  const closes = candles.map(c => c.c)
  // ---- 遗漏 / 连出统计
  let gapNow = 0; for (let i = n - 1; i >= 0 && !hits[i]; i--) gapNow++
  let maxGap = 0, g = 0; const gapList: number[] = []
  for (let i = 0; i < n; i++) { if (hits[i]) { gapList.push(g); maxGap = Math.max(maxGap, g); g = 0 } else g++ }
  let maxRun = 0, run = 0; for (let i = 0; i < n; i++) { run = hits[i] ? run + 1 : 0; maxRun = Math.max(maxRun, run) }
  const total = hits.reduce((a, b) => a + b, 0)
  const expected = n * per * base
  const z = expected ? (total - expected) / Math.sqrt(n * per * base * (1 - base)) : 0   // 二项 z 分数
  const avgGap = gapList.length ? gapList.reduce((a, b) => a + b, 0) / gapList.length : 0
  // 遗漏分布（0,1,2..,>=20）
  const gapHist = Array(21).fill(0); for (const x of gapList) gapHist[Math.min(20, x)]++
  // ---- 最近 100 期命中时间线（用于“点阵”）
  const timeline = hits.slice(-100)
  // ---- 全部 10 个数字的概况（用于选择器着色）
  const profile = [...Array(10).keys()].map(dg => {
    const hs = asc.map(x => opt.pos === 'any' ? x.o.nums.filter(v => v === dg).length : (x.o.nums[opt.pos as number] === dg ? 1 : 0))
    let gp = 0; for (let i = n - 1; i >= 0 && !hs[i]; i--) gp++
    const r30 = hs.slice(-30).reduce((a, b) => a + b, 0) / (Math.min(30, n) * per)
    const rAll = hs.reduce((a, b) => a + b, 0) / (n * per)
    return { digit: dg, freq: round(rAll), freq30: round(r30), gap: gp, heat: round((r30 - base) / base, 2) }
  })
  // ---- 趋势判定
  const ma5 = ma(closes, 5), ma20 = ma(closes, 20)
  const last = candles[candles.length - 1]
  const m5 = ma5[ma5.length - 1], m20 = ma20[ma20.length - 1]
  const trend = !last || m5 === null || m20 === null ? 'flat' : (last.c > m5 && m5 > m20 ? 'up' : last.c < m5 && m5 < m20 ? 'down' : 'flat')
  const upCount = candles.filter(c => c.c > c.o).length
  return {
    n, per, base, digit: opt.digit, pos: opt.pos, posName: opt.pos === 'any' ? '任意位' : POS_NAMES[opt.pos as number] + '位', bucket: opt.bucket, window: opt.window,
    candles, ma5, ma20,
    stats: { total, expected: round(expected, 1), rate: round(total / (n * per)), z: round(z, 2), gapNow, maxGap, avgGap: round(avgGap, 1), maxRun, gapHist, upCount, downCount: candles.length - upCount, trend, lastClose: last?.c ?? 0, m5, m20 },
    timeline, profile,
  }
}

/** 其它维度的 K 线：总和、大率、单率、龙率（同一 bucket） */
export function marketKlines(draws: Draw[], bucket: number, window: number) {
  const asc = [...draws].reverse().map(d => ({ d, o: computeOutcomes5(d.hash)! })).filter(x => x.o)
  const meta = asc.map(x => ({ expect: x.d.expect, t: x.d.open_ms }))
  const sums = asc.map(x => x.o.sum)
  const big = asc.map(x => x.o.sumSize === 'big' ? 1 : 0), odd = asc.map(x => x.o.sumParity === 'odd' ? 1 : 0), drg = asc.map(x => x.o.dragon === 'dragon' ? 1 : 0)
  const ones = asc.map(() => 1)
  return {
    sum: toCandles(sums, ones, meta, bucket, 1),                 // 总和本身当价格
    big: toCandles(rolling(big, window, 1), big, meta, bucket, 0.5),
    odd: toCandles(rolling(odd, window, 1), odd, meta, bucket, 0.5),
    dragon: toCandles(rolling(drg, window, 1), drg, meta, bucket, 0.45),
  }
}
