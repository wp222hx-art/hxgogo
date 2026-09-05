// ============ 战绩榜优质策略推荐选号：每期取「目标期之前」滚动 40 期 z 最高的前三个策略，各自 500 注 + 加权融合成一份全新的 500 注（strategy='top3'） ============
// 规则（与竞技场战绩榜完全同一口径，walk-forward）：
//  1) 候选 = 除随机对照与 AI 之外的全部策略（7 个基础 + 3 个组合），AI 因异步到达且可能缺席，不进入候选，保证每期确定、即时；
//  2) 排名 = 目标期之前最近 META_K(40) 期滚动 z（命中 − 期望）/√Σp(1−p)，样本 <10 期的策略不参与；不足 3 个合格策略时用组合最优补位；
//  3) 融合 = 各成员按 w ∝ exp(0.6·clamp(z,−2,2)) 加权；号码得分 = Σ w_k·(501 − 该号在成员 k 500 注中的名次)，取 Top 500 → strategy 'top3'；
//  4) 'top3' 与其他策略同规则结算（950×，每注 1），逐期战绩可回看，也可与三位成员各自战绩对照。
import { STRATEGIES, META_K, ARENA_N, nextOf, loadPerf, pnlOf, rollingZ, type PerfMap } from './arena'

const r3 = (x: number) => Math.round(x * 1000) / 1000
// 候选：除随机对照外的全部策略（含 AI —— AI 已有 700+ 期样本且每期 ~8s 到达；若本期 AI 缺席，融合时自动只用其余合格成员）
const CANDIDATES = STRATEGIES.filter(s => !s.control).map(s => s.key)
export const TOP3_KEY = 'top3'
export const TOP3_MIN_N = 10
/** z 门槛：只有滚动 z > 0 的策略才有资格进入融合；不足 3 个时不补位（融合 1–3 个合格者），全无合格者时退回组合最优 */
export const TOP3_MIN_Z = 0
export const TOP3_AI_WAIT_MS = 15_000

export interface Top3Member { key: string; z: number; rate: number | null; n: number; hits: number; w: number }

/** 从 perf 里算各候选的滚动 z，取前三 */
export function rankTop3(perf: PerfMap): Top3Member[] {
  const rows = CANDIDATES.map(k => { const r = rollingZ(perf, k); return { key: k, z: r3(r.z), rate: r.rate == null ? null : r3(r.rate), n: r.n, hits: r.hits, w: 0 } })
  let top = rows.filter(r => r.n >= TOP3_MIN_N && r.z > TOP3_MIN_Z).sort((a, b) => b.z - a.z || b.n - a.n).slice(0, 3)
  if (!top.length) top = [rows.find(r => r.key === 'meta')!]                      // 全军皆负：退回组合最优
  const raw = top.map(t => Math.exp(0.6 * Math.max(-2, Math.min(2, t.z)))); const sum = raw.reduce((a, b) => a + b, 0) || 1
  top.forEach((t, i) => { t.w = r3(raw[i] / sum) })
  return top
}

/** 融合三份 500 注：得分 = Σ w·(501 − rank) */
export function fuseTop3(lists: { w: number; numbers: string[] }[]): string[] {
  const score = new Map<string, number>()
  for (const l of lists) l.numbers.forEach((n, i) => score.set(n, (score.get(n) || 0) + l.w * (ARENA_N + 1 - i)))
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, ARENA_N).map(e => e[0])
}

/** 每期：基础策略已入库后，为待开期生成 top3（幂等） */
export async function top3Round(db: D1Database, source: string, latestExpect: string) {
  const next = nextOf(latestExpect); if (!next) return false
  const have = await db.prepare('SELECT 1 FROM arena_rounds WHERE source=? AND expect=? AND strategy=?').bind(source, next, TOP3_KEY).first()
  if (have) return false
  const rounds = (await db.prepare(`SELECT strategy, numbers, created_ms FROM arena_rounds WHERE source=? AND expect=? AND scored_ms IS NULL`).bind(source, next).all<any>()).results
  if (!rounds.some(r => r.strategy === 'meta')) return false          // 基础策略尚未生成
  const perf = await loadPerf(db, source, next)
  let members = rankTop3(perf)
  // AI 入选但本期尚未到达：给它最多 TOP3_AI_WAIT_MS（从基础策略生成起算）；超时则剔除 AI、只融合已到的合格成员
  const metaRow = rounds.find(r => r.strategy === 'meta') as any
  const aiMissing = members.some(m => m.key === 'ai') && !rounds.some(r => r.strategy === 'ai')
  if (aiMissing) {
    const baseAge = Date.now() - (metaRow?.created_ms || Date.now())
    if (baseAge < TOP3_AI_WAIT_MS) return false
    members = members.filter(m => m.key !== 'ai'); if (!members.length) members = rankTop3(perf).filter(m => m.key !== 'ai').length ? [] : []
    if (!members.length) { const perfNoAi = { ...perf }; delete perfNoAi['ai']; members = rankTop3(perfNoAi) }
    const sum = members.reduce((a, m) => a + Math.exp(0.6 * Math.max(-2, Math.min(2, m.z))), 0) || 1
    members.forEach(m => { m.w = r3(Math.exp(0.6 * Math.max(-2, Math.min(2, m.z))) / sum) })
  }
  const lists = members.map(m => ({ w: m.w, numbers: (rounds.find(r => r.strategy === m.key)?.numbers || '').split(' ').filter(Boolean) })).filter(l => l.numbers.length)
  if (!lists.length) return false
  const fused = lists.length === 1 ? lists[0].numbers.slice(0, ARENA_N) : fuseTop3(lists)
  const ts = Date.now()
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(source, next, TOP3_KEY, 'live', latestExpect, fused.join(' '), fused.length, fused.length / 1000, 1, ts),
    db.prepare(`INSERT OR IGNORE INTO top3_picks (source, expect, based_on, members, created_ms) VALUES (?,?,?,?,?)`).bind(source, next, latestExpect, JSON.stringify(members), ts),
  ])
  return true
}

/** 回放补齐：对已结算但缺 top3 的历史期，用「该期之前」的战绩排名 + 该期已存的成员 500 注，重建融合并直接结算（无前视） */
export async function top3Backfill(db: D1Database, source: string, maxPeriods = 100) {
  const missing = (await db.prepare(`SELECT DISTINCT a.expect, a.based_on, a.actual FROM arena_rounds a WHERE a.source=? AND a.strategy='meta' AND a.scored_ms IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM arena_rounds b WHERE b.source=a.source AND b.expect=a.expect AND b.strategy=?) ORDER BY a.expect DESC LIMIT ?`).bind(source, TOP3_KEY, maxPeriods).all<any>()).results
  let done = 0
  for (const m of missing.reverse()) {
    const perf = await loadPerf(db, source, m.expect)
    const members = rankTop3(perf)
    const rounds = (await db.prepare(`SELECT strategy, numbers, mode FROM arena_rounds WHERE source=? AND expect=?`).bind(source, m.expect).all<any>()).results
    const lists = members.map(x => ({ w: x.w, numbers: (rounds.find(r => r.strategy === x.key)?.numbers || '').split(' ').filter(Boolean) })).filter(l => l.numbers.length)
    if (!lists.length) continue
    const fused = lists.length === 1 ? lists[0].numbers.slice(0, ARENA_N) : fuseTop3(lists); const idx = fused.indexOf(m.actual); const hit = idx >= 0; const ts = Date.now()
    const mode = rounds[0]?.mode || 'replay'
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO arena_rounds (source, expect, strategy, mode, based_on, numbers, count, coverage, weight, created_ms, actual, hit, rank, pnl, scored_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(source, m.expect, TOP3_KEY, mode, m.based_on, fused.join(' '), fused.length, fused.length / 1000, 1, ts, m.actual, hit ? 1 : 0, hit ? idx + 1 : null, pnlOf(hit, fused.length), ts),
      db.prepare(`INSERT OR IGNORE INTO top3_picks (source, expect, based_on, members, created_ms) VALUES (?,?,?,?,?)`).bind(source, m.expect, m.based_on, JSON.stringify(members), ts),
    ])
    done++
  }
  return done
}

const defOf = (k: string) => STRATEGIES.find(s => s.key === k) || { key: k, name: k, short: k, desc: '', color: '#94a3b8' }

/** 页面数据：本期（成员各 500 + 融合 500）+ 各方战绩 + 逐期历史 */
export async function top3View(db: D1Database, source: string, hist = 12) {
  const pend = (await db.prepare(`SELECT expect, based_on, strategy, numbers, created_ms FROM arena_rounds WHERE source=? AND scored_ms IS NULL ORDER BY expect DESC LIMIT 40`).bind(source).all<any>()).results
  const expect = pend[0]?.expect || null
  let current: any = null
  if (expect) {
    const pk = await db.prepare('SELECT members, created_ms FROM top3_picks WHERE source=? AND expect=?').bind(source, expect).first<any>()
    const members: Top3Member[] = pk ? JSON.parse(pk.members) : []
    const fusedRow = pend.find(r => r.expect === expect && r.strategy === TOP3_KEY)
    const memberRows = members.map(m => { const d = defOf(m.key); const row = pend.find(r => r.expect === expect && r.strategy === m.key); return { ...m, name: d.name, short: d.short, color: d.color, desc: d.desc, numbers: row ? row.numbers.split(' ') : [] } })
    const fused = fusedRow ? fusedRow.numbers.split(' ') : []
    const fs = new Set(fused)
    const overlap = memberRows.map(m => ({ key: m.key, in_fused: m.numbers.filter(n => fs.has(n)).length }))
    const allThree = fused.filter(n => memberRows.every(m => m.numbers.includes(n))).length
    current = { expect, based_on: pend[0].based_on, status: fusedRow ? 'ready' : 'pending', created_ms: fusedRow?.created_ms || null, members: memberRows, fused, count: fused.length, overlap, consensus_all: allThree }
  }
  // 战绩：top3 + 各候选策略总体 & 滚动
  const agg = (await db.prepare(`SELECT strategy, COUNT(*) n, SUM(hit) hits, SUM(pnl) pnl FROM arena_rounds WHERE source=? AND scored_ms IS NOT NULL AND mode='live' GROUP BY strategy`).bind(source).all<any>()).results
  const rec = (k: string) => { const a = agg.find(x => x.strategy === k); return a ? { n: a.n, hits: a.hits || 0, rate: a.n ? r3((a.hits || 0) / a.n) : null, pnl: a.pnl || 0 } : null }
  const streak = (await db.prepare(`SELECT hit FROM arena_rounds WHERE source=? AND strategy=? AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT 20`).bind(source, TOP3_KEY).all<any>()).results.map(r => r.hit ? 1 : 0)
  const record = rec(TOP3_KEY) ? { ...rec(TOP3_KEY)!, streak } : null
  // 当前排行（用于展示「为什么是这三个」）：以待开期之前的 perf
  const perf = expect ? await loadPerf(db, source, expect) : {}
  const leaderboard = CANDIDATES.map(k => { const r = rollingZ(perf, k); const d = defOf(k); return { key: k, short: d.short, name: d.name, color: d.color, n: r.n, hits: r.hits, rate: r.rate == null ? null : r3(r.rate), z: r3(r.z), eligible: r.n >= TOP3_MIN_N && r.z > TOP3_MIN_Z, total: rec(k) } }).sort((a, b) => b.z - a.z)
  // 历史
  const rows = (await db.prepare(`SELECT a.expect, a.numbers, a.count, a.actual, a.hit, a.rank, a.pnl, a.created_ms, d.open_ms, p.members FROM arena_rounds a LEFT JOIN draws d ON d.source=a.source AND d.expect=a.expect LEFT JOIN top3_picks p ON p.source=a.source AND p.expect=a.expect
    WHERE a.source=? AND a.strategy=? AND a.scored_ms IS NOT NULL ORDER BY a.expect DESC LIMIT ?`).bind(source, TOP3_KEY, hist).all<any>()).results
  const expects = rows.map(r => r.expect)
  const memberHits = expects.length ? (await db.prepare(`SELECT expect, strategy, hit, rank FROM arena_rounds WHERE source=? AND expect IN (${expects.map(() => '?').join(',')}) AND strategy!=? AND scored_ms IS NOT NULL`).bind(source, ...expects, TOP3_KEY).all<any>()).results : []
  const history = rows.map(r => {
    const members: Top3Member[] = r.members ? JSON.parse(r.members) : []
    return { expect: r.expect, numbers: r.numbers, count: r.count, actual: r.actual, hit: !!r.hit, rank: r.rank, pnl: r.pnl, open_ms: r.open_ms, created_ms: r.created_ms,
      members: members.map(m => { const d = defOf(m.key); const h = memberHits.find(x => x.expect === r.expect && x.strategy === m.key); return { key: m.key, short: d.short, color: d.color, z: m.z, w: m.w, hit: h ? !!h.hit : null, rank: h?.rank ?? null } }) }
  })
  return { current, record, leaderboard, rules: { min_n: TOP3_MIN_N, min_z: TOP3_MIN_Z, ai_wait_ms: TOP3_AI_WAIT_MS, candidates: CANDIDATES }, history, odds_note: `每注 1，命中 +${pnlOf(true, ARENA_N)}，未中 ${pnlOf(false, ARENA_N)}；保本命中率 52.6%` }
}
