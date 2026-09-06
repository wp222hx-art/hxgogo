// ============ AI 多组独立生成（每档注数 5 组，各自独立算出，不是 500 注的前缀） ============
// 每期 AI 推理完成后，对每个注数 N（100/150/300/450/500 + 自定义），用 5 种不同"视角"各自独立生成一组 N 注：
//   A 融合主推   ：AI 定位权重 × 量化融合（当前主口径）得分 top-N
//   B 纯定位     ：只用 AI 的三位 pos_weights 乘积（AI 自己的判断，不掺量化）top-N
//   C 量化共识   ：只用 z>0 的量化策略融合向量（不含 AI 定位），再按 AI boost/avoid 微调 top-N
//   D 聚焦集中   ：万位取 AI 权重前 4 个数字、千/百位各前 6 → 笛卡尔积 144 个"核心号"优先，再用融合分补满 N
//   E 互补覆盖   ：先剔除 A 组已选号码，在剩余空间按融合分 top-N（与主推零重叠，作对冲/覆盖）
// 每组作为独立策略 `ai-set-{N}-{A..E}` 写入 arena_rounds，走现有结算；ai_sets 表记录元数据。
// 统计端按 (N, 组) 汇总命中率 / z / ROI，标出"哪一组历史上更会中"，供用户筛选。
import { ARENA_N, ARENA_ODDS, AI_SUBSETS, rollingZ, type PerfMap } from './arena'
import { type AiForecast } from './ai'

const SPACE = 1000
const no3 = (i: number) => String(i).padStart(3, '0')
const r4 = (x: number) => Math.round(x * 10000) / 10000
const topN = (scores: number[], N: number, exclude?: Set<number>) => { const idx = [...scores.keys()].filter(i => !exclude || !exclude.has(i)); idx.sort((a, b) => scores[b] - scores[a]); return idx.slice(0, N) }
const norm = (a: number[]) => { const s = a.reduce((x, y) => x + y, 0) || 1; return a.map(x => x / s) }

export const SET_IDS = ['A', 'B', 'C', 'D', 'E'] as const
export type SetId = typeof SET_IDS[number]
export const SET_META: Record<SetId, { name: string; short: string; desc: string; color: string }> = {
  A: { name: '融合主推', short: '融合', desc: 'AI 定位权重 × 量化融合得分 top-N（主口径）', color: '#f472b6' },
  B: { name: '纯定位', short: '定位', desc: '只用 AI 三位权重乘积，不掺量化', color: '#a78bfa' },
  C: { name: '量化共识', short: '量化', desc: '仅 z>0 量化策略融合 + AI boost/avoid 微调', color: '#22d3ee' },
  D: { name: '聚焦集中', short: '聚焦', desc: '万位前 4 × 千百位前 6 的核心号优先，再补满', color: '#fbbf24' },
  E: { name: '互补覆盖', short: '互补', desc: '剔除 A 组后在剩余空间取 top-N，与主推零重叠', color: '#34d399' },
}
export const setKey = (n: number, id: SetId) => `ai-set-${n}-${id}`
export const parseSetKey = (k: string): { n: number; id: SetId } | null => { const m = /^ai-set-(\d+)-([A-E])$/.exec(k); return m ? { n: +m[1], id: m[2] as SetId } : null }

const AI_POS_POW = 1.0, AI_OWN_SHARE = 0.65

/** 五种视角的得分向量（与 aiScores 同源计算，但拆成可独立取 top-N 的组件） */
export function setScoreVectors(f: AiForecast, vec: Record<string, number[]>, perf?: PerfMap) {
  const pd = f.pos_weights.map(row => norm(row.map(v => Math.pow(v + 5, AI_POS_POW))))
  const own = new Array<number>(SPACE); for (let i = 0; i < SPACE; i++) own[i] = pd[0][Math.floor(i / 100)] * pd[1][Math.floor(i / 10) % 10] * pd[2][i % 10]
  const blendW: Record<string, number> = {}
  for (const [k, w] of Object.entries(f.strategy_blend)) { if (!vec[k] || w <= 0) continue; if (perf && rollingZ(perf, k).z <= 0) continue; blendW[k] = w }
  const bsum = Object.values(blendW).reduce((a, b) => a + b, 0)
  const blend = new Array<number>(SPACE).fill(0)
  if (bsum > 0) for (const [k, w] of Object.entries(blendW)) { const v = vec[k]; for (let i = 0; i < SPACE; i++) blend[i] += (w / bsum) * v[i] }
  else for (let i = 0; i < SPACE; i++) blend[i] = 1 / SPACE
  const fused = new Array<number>(SPACE); for (let i = 0; i < SPACE; i++) fused[i] = Math.pow(own[i], AI_OWN_SHARE) * Math.pow(blend[i], 1 - AI_OWN_SHARE)
  const adj = (arr: number[]) => { const o = arr.slice(); for (const n of f.boost) { const i = Number(n); if (i >= 0 && i < SPACE) o[i] *= 1.6 } for (const n of f.avoid) { const i = Number(n); if (i >= 0 && i < SPACE) o[i] *= 0.4 } return norm(o) }
  // D：核心号集合（万位前 4 × 千位前 6 × 百位前 6）
  const topDigits = (row: number[], k: number) => [...row.keys()].sort((a, b) => row[b] - row[a]).slice(0, k)
  const w4 = new Set(topDigits(pd[0], 4)), q6 = new Set(topDigits(pd[1], 6)), b6 = new Set(topDigits(pd[2], 6))
  const core = new Set<number>(); for (let i = 0; i < SPACE; i++) if (w4.has(Math.floor(i / 100)) && q6.has(Math.floor(i / 10) % 10) && b6.has(i % 10)) core.add(i)
  return { A: adj(fused), B: adj(own), C: adj(blend), fused: adj(fused), core }
}

export interface SetGen { key: string; n: number; id: SetId; numbers: number[]; coverage: number; overlap_a: number }

/** 生成某期全部 (N × 5 组) */
export function generateSets(f: AiForecast, vec: Record<string, number[]>, perf: PerfMap | undefined, Ns: number[]): SetGen[] {
  const V = setScoreVectors(f, vec, perf)
  const out: SetGen[] = []
  for (const n of Ns) {
    const N = Math.min(n, SPACE)
    const A = topN(V.A, N); const aSet = new Set(A)
    const B = topN(V.B, N)
    const C = topN(V.C, N)
    // D：核心号按融合分排序优先，不足再从非核心里按融合分补
    const coreSorted = [...V.core].sort((a, b) => V.fused[b] - V.fused[a])
    const D = coreSorted.slice(0, N); if (D.length < N) { const dSet = new Set(D); for (const i of topN(V.fused, SPACE)) { if (D.length >= N) break; if (!dSet.has(i)) { D.push(i); dSet.add(i) } } }
    const E = topN(V.fused, N, aSet)
    const mk = (id: SetId, nums: number[], sc: number[]) => ({ key: setKey(n, id), n, id, numbers: nums, coverage: r4(nums.reduce((a, i) => a + sc[i], 0)), overlap_a: nums.filter(i => aSet.has(i)).length })
    out.push(mk('A', A, V.A), mk('B', B, V.B), mk('C', C, V.C), mk('D', D, V.fused), mk('E', E, V.fused))
  }
  return out
}

/** 写入 arena_rounds（走现有结算）+ ai_sets 元数据 */
export async function insertSets(db: D1Database, source: string, expect: string, basedOn: string, sets: SetGen[]) {
  const ts = Date.now()
  const stmts: D1PreparedStatement[] = []
  for (const g of sets) {
    const nums = g.numbers.map(no3)
    stmts.push(db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(source, expect, g.key, 'live', basedOn, nums.join(' '), nums.length, g.coverage, 1, ts))
    stmts.push(db.prepare(`INSERT OR IGNORE INTO ai_sets (source, expect, n, set_id, overlap_a, created_ms) VALUES (?,?,?,?,?,?)`).bind(source, expect, g.n, g.id, g.overlap_a, ts))
  }
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40))
}

/** 所有档位 N（固定 + 自定义） */
export function allNs(customNs: number[]) { return [...new Set([...AI_SUBSETS.map(s => s.n), ARENA_N, ...customNs])].sort((a, b) => a - b) }

/**
 * 组别战绩汇总：每个 (N, 组) 的命中率 / z / ROI / 近 20 期 / 当前连挂，并按 z 给出该 N 下的"最佳组"标识。
 */
export async function setsBoard(db: D1Database, source: string, Ns: number[], recentK = 60) {
  const keys = Ns.flatMap(n => SET_IDS.map(id => setKey(n, id)))
  const rows = (await db.prepare(`SELECT strategy, expect, hit, rank, pnl, count FROM arena_rounds WHERE source=? AND strategy LIKE 'ai-set-%' AND scored_ms IS NOT NULL ORDER BY expect ASC`).bind(source).all<any>()).results
  const by: Record<string, any[]> = {}; for (const r of rows) (by[r.strategy] ||= []).push(r)
  const stat = (rs: any[], n: number) => {
    const T = rs.length, h = rs.filter(r => r.hit).length, p = n / SPACE
    const pnl = rs.reduce((a, r) => a + (r.pnl || 0), 0)
    let cur = 0; for (let i = rs.length - 1; i >= 0 && !rs[i].hit; i--) cur++
    return { n: T, hits: h, rate: T ? r4(h / T) : null, breakeven: r4(n / ARENA_ODDS), z: T ? r4((h - T * p) / Math.sqrt(T * p * (1 - p))) : null, pnl, roi: T ? r4(pnl / (T * n)) : null, streak: rs.slice(-20).map(r => r.hit ? 1 : 0), current_miss: cur }
  }
  const tiers = Ns.map(n => {
    const sets = SET_IDS.map(id => { const k = setKey(n, id); const rs = by[k] || []; return { id, key: k, ...SET_META[id], all: stat(rs, n), recent: stat(rs.slice(-recentK), n) } })
    // 最佳组：全量 z 最高且样本 ≥ 20；近期最佳：近 K 期 z 最高
    const withN = sets.filter(s => s.all.n >= 20)
    const best = withN.length ? withN.reduce((a, b) => (b.all.z ?? -9) > (a.all.z ?? -9) ? b : a).id : null
    const bestRecent = withN.length ? withN.reduce((a, b) => (b.recent.z ?? -9) > (a.recent.z ?? -9) ? b : a).id : null
    return { n, best, best_recent: bestRecent, sets }
  })
  const periods = new Set(rows.map(r => r.expect)).size
  return { periods, tiers, recent_k: recentK }
}

/** 某期各组号码（供 /ai 与 /query 展示、复制） */
export async function setsForPeriod(db: D1Database, source: string, expect: string, Ns: number[]) {
  const rows = (await db.prepare(`SELECT strategy, numbers, count, coverage, hit, rank, pnl, actual, scored_ms FROM arena_rounds WHERE source=? AND expect=? AND strategy LIKE 'ai-set-%'`).bind(source, expect).all<any>()).results
  const meta = (await db.prepare(`SELECT n, set_id, overlap_a FROM ai_sets WHERE source=? AND expect=?`).bind(source, expect).all<any>()).results
  const ov: Record<string, number> = {}; for (const m of meta) ov[setKey(m.n, m.set_id)] = m.overlap_a
  const out: Record<number, any[]> = {}
  for (const r of rows) { const p = parseSetKey(r.strategy); if (!p || !Ns.includes(p.n)) continue; (out[p.n] ||= []).push({ id: p.id, key: r.strategy, ...SET_META[p.id], numbers: String(r.numbers).split(' '), count: r.count, coverage: r.coverage, overlap_a: ov[r.strategy] ?? null, hit: r.scored_ms ? !!r.hit : null, rank: r.rank, pnl: r.scored_ms ? r.pnl : null, actual: r.actual }) }
  for (const n of Object.keys(out)) out[+n].sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * 历史回填：用已存的 ai_forecasts.output（当期 AI 真实输出）+ 该期之前的开奖重算 5 组，写入并即时结算。
 * 严格无前视：hist 只取 expect 更早的开奖；perf 只取 expect 之前的结算。每次最多 max 期（从新到旧）。
 */
export async function backfillSets(db: D1Database, source: string, draws: { expect: string; n1: number; n2: number; n3: number }[], Ns: number[], max = 30) {
  const { generateRound, loadPerf } = await import('./arena')
  const { normalize } = await import('./ai')
  const rows = (await db.prepare(`SELECT f.expect, f.output FROM ai_forecasts f
    WHERE f.source=? AND f.error IS NULL AND EXISTS (SELECT 1 FROM arena_rounds a WHERE a.source=f.source AND a.expect=f.expect AND a.strategy='ai' AND a.scored_ms IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM ai_sets s WHERE s.source=f.source AND s.expect=f.expect)
    ORDER BY f.expect DESC LIMIT ?`).bind(source, max).all<any>()).results
  let done = 0
  for (const r of rows) {
    const k = draws.findIndex(d => d.expect === r.expect); if (k < 0) continue
    const hist = draws.slice(k + 1, k + 1 + 800) as any; if (hist.length < 120) continue
    let f: AiForecast; try { f = normalize(JSON.parse(r.output)) } catch { continue }
    const perf = await loadPerf(db, source, r.expect)
    const gen = generateRound(hist, `${source}|${r.expect}`, perf)
    const sets = generateSets(f, gen.vec, perf, Ns)
    const actual = `${draws[k].n1}${draws[k].n2}${draws[k].n3}`
    const ts = Date.now(); const stmts: D1PreparedStatement[] = []
    for (const g of sets) {
      const nums = g.numbers.map(no3); const idx = nums.indexOf(actual); const hit = idx >= 0
      stmts.push(db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms, actual, hit, rank, pnl, scored_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(source, r.expect, g.key, 'replay', hist[0].expect, nums.join(' '), nums.length, g.coverage, 1, ts, actual, hit ? 1 : 0, hit ? idx + 1 : null, hit ? ARENA_ODDS - nums.length : -nums.length, ts))
      stmts.push(db.prepare(`INSERT OR IGNORE INTO ai_sets (source, expect, n, set_id, overlap_a, created_ms) VALUES (?,?,?,?,?,?)`).bind(source, r.expect, g.n, g.id, g.overlap_a, ts))
    }
    for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40))
    done++
  }
  return { done, remaining_hint: rows.length === max }
}
