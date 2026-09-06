import { predictionAudit, verifiedLiveSql } from './arena'
import { evaluationSummary } from './evaluation'

export interface PickSnapshot { source: string; next_expect: string; latest_expect: string; count: number; temp: number; numbers: string[]; coverage: number }

/** First write wins; late or unverified snapshots remain archived outside live statistics. */
export async function recordPick(db: D1Database, s: PickSnapshot) {
  if (!s.next_expect || s.numbers.length !== s.count || new Set(s.numbers).size !== s.count || s.numbers.some(n => !/^\d{3}$/.test(n))) return false
  if (!Number.isFinite(s.coverage) || s.coverage < 0 || s.coverage > 1) return false
  const created = Date.now()
  const audit = await predictionAudit(db, s.source, s.next_expect, s.latest_expect, 'live', created)
  const r = await db.prepare(`INSERT OR IGNORE INTO pick_log
    (source, expect, count, temp, based_on, numbers, coverage, created_ms, prediction_version, cutoff_ms, prediction_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(s.source, s.next_expect, s.count, s.temp, s.latest_expect, s.numbers.join(' '), s.coverage, created,
      audit.prediction_version, audit.cutoff_ms, audit.prediction_status).run()
  return (r.meta.changes || 0) > 0
}

/** Score new outcomes and correct old scores when upstream results change. */
export async function scorePicks(db: D1Database, source: string) {
  const pend = (await db.prepare(`SELECT p.expect, p.count, p.temp, p.numbers, d.n1, d.n2, d.n3 FROM pick_log p
    JOIN draws d ON d.source=p.source AND d.expect=p.expect
    WHERE p.source=? AND (p.scored_ms IS NULL OR p.actual <> CAST(d.n1 AS TEXT)||CAST(d.n2 AS TEXT)||CAST(d.n3 AS TEXT)) LIMIT 200`).bind(source).all<any>()).results
  if (!pend.length) return 0
  await db.batch(pend.map(r => {
    const actual = `${r.n1}${r.n2}${r.n3}`, idx = String(r.numbers).split(' ').indexOf(actual)
    return db.prepare('UPDATE pick_log SET actual=?, hit=?, rank=?, scored_ms=? WHERE source=? AND expect=? AND count=? AND temp=?')
      .bind(actual, idx >= 0 ? 1 : 0, idx >= 0 ? idx + 1 : null, Date.now(), source, r.expect, r.count, r.temp)
  }))
  return pend.length
}

export async function pickTrack(db: D1Database, source: string, opt: { count?: number; temp?: number; all?: boolean; limit?: number }) {
  await scorePicks(db, source)
  const limit = Math.max(20, Math.min(2000, opt.limit ?? 500))
  const cfg = opt.all ? 'source=?' : 'source=? AND count=? AND temp=?'
  const binds = opt.all ? [source] : [source, opt.count, opt.temp]
  const where = `${cfg} AND ${verifiedLiveSql('', false)}`
  const rows = (await db.prepare(`SELECT * FROM pick_log WHERE ${where} AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT ?`).bind(...binds, limit).all<any>()).results
  const pending = (await db.prepare(`SELECT COUNT(*) n FROM pick_log WHERE ${where} AND scored_ms IS NULL`).bind(...binds).first<any>())?.n || 0
  const archive = (await db.prepare(`SELECT prediction_status status, COUNT(*) n FROM pick_log WHERE ${cfg} GROUP BY prediction_status`).bind(...binds).all<any>()).results
  const asc = [...rows].reverse(), ev = evaluationSummary(asc)
  let hits = 0, expSum = 0, covSum = 0
  const series = asc.map((r, i) => {
    hits += Number(!!r.hit); expSum += r.count / 1000; covSum += r.coverage
    return { expect: r.expect, hit: !!r.hit, rank: r.rank, actual: r.actual, rate: hits / (i + 1), baseline: expSum / (i + 1), quant: covSum / (i + 1) }
  })
  const groups = new Map<string, any[]>()
  for (const r of rows) { const key = `${r.count}|${r.temp}`; const g = groups.get(key) || []; g.push(r); groups.set(key, g) }
  const by_config = [...groups.values()].map(g => ({ count: g[0].count, temp: g[0].temp, ...evaluationSummary(g) })).sort((a, b) => b.n - a.n)
  const tierHits = { core: 0, main: 0, edge: 0 }
  for (const r of rows) if (r.hit) { const q = r.rank / r.count; if (q <= 0.1) tierHits.core++; else if (q <= 0.5) tierHits.main++; else tierHits.edge++ }
  const n = rows.length
  const verdict = opt.all ? '多配置记录可能来自同一期，不能当成独立样本；请固定一个配置观察。'
    : n < 100 ? `已验证 ${n} 期，证据不足。只计入开奖截止前锁定的本版本记录。`
    : '区间只描述这个固定配置的历史成绩；多策略筛选和反复查看会影响结论，目前不宣称下一期优势。'
  return {
    ...ev, z: ev.z == null ? null : Math.round(ev.z * 100) / 100,
    baseline: ev.baseline ?? 0, quant_avg: n ? covSum / n : null, pending,
    tier_hits: tierHits, by_config, archive, verdict, series,
    recent: rows.slice(0, 40).map(r => ({ expect: r.expect, actual: r.actual, hit: !!r.hit, rank: r.rank, count: r.count })),
  }
}
