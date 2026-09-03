// ============ 选号器战绩追踪：开奖前锁定 Top-N 快照 → 开奖后自动评分 → 累计命中率 vs 基线 ============
// 这是对「量化选号器」最诚实的检验：快照在目标期开奖前写入（INSERT OR IGNORE，首次为准，不可改写），
// 评分只做一件事——看真实开奖前三位是否在名单里。长期命中率若与 N/1000 无显著差异，即信号无预测力。

export interface PickSnapshot { source: string; next_expect: string; latest_expect: string; count: number; temp: number; numbers: string[]; coverage: number }

/** 开奖前锁定快照（同一 source/期号/N/temp 只记第一次） */
export async function recordPick(db: D1Database, s: PickSnapshot) {
  if (!s.next_expect || !s.numbers.length) return false
  const r = await db.prepare(`INSERT OR IGNORE INTO pick_log (source, expect, count, temp, based_on, numbers, coverage, created_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.source, s.next_expect, s.count, s.temp, s.latest_expect, s.numbers.join(' '), s.coverage, Date.now()).run()
  return (r.meta.changes || 0) > 0
}

/** 对已开奖但未评分的快照打分（懒执行，随请求触发） */
export async function scorePicks(db: D1Database, source: string) {
  const pend = (await db.prepare(`SELECT p.expect, p.count, p.temp, p.numbers, d.n1, d.n2, d.n3 FROM pick_log p
    JOIN draws d ON d.source = p.source AND d.expect = p.expect
    WHERE p.source = ? AND p.scored_ms IS NULL LIMIT 200`).bind(source).all<any>()).results
  if (!pend.length) return 0
  const stmts = pend.map(r => {
    const actual = `${r.n1}${r.n2}${r.n3}`
    const idx = (r.numbers as string).split(' ').indexOf(actual)
    return db.prepare('UPDATE pick_log SET actual=?, hit=?, rank=?, scored_ms=? WHERE source=? AND expect=? AND count=? AND temp=?')
      .bind(actual, idx >= 0 ? 1 : 0, idx >= 0 ? idx + 1 : null, Date.now(), source, r.expect, r.count, r.temp)
  })
  await db.batch(stmts)
  return pend.length
}

/** 战绩汇总：默认按当前 N/temp 过滤；all=true 汇总全部配置（按各自基线计期望） */
export async function pickTrack(db: D1Database, source: string, opt: { count?: number; temp?: number; all?: boolean; limit?: number }) {
  await scorePicks(db, source)
  const limit = Math.max(20, Math.min(2000, opt.limit ?? 500))
  const where = opt.all ? 'source=? AND scored_ms IS NOT NULL' : 'source=? AND count=? AND temp=? AND scored_ms IS NOT NULL'
  const binds = opt.all ? [source] : [source, opt.count, opt.temp]
  const rows = (await db.prepare(`SELECT expect, count, temp, based_on, coverage, actual, hit, rank, created_ms, scored_ms FROM pick_log WHERE ${where} ORDER BY expect DESC LIMIT ?`).bind(...binds, limit).all<any>()).results
  const pending = (await db.prepare(`SELECT COUNT(*) n FROM pick_log WHERE ${where.replace('IS NOT NULL', 'IS NULL')}`).bind(...binds).first<any>())?.n || 0
  const asc = [...rows].reverse()
  // 累计曲线（旧→新）：实际命中率 / 理论基线（各期 N/1000 的平均） / 量化覆盖率均值
  let hits = 0, expSum = 0, covSum = 0
  const series = asc.map((r, i) => {
    hits += r.hit; expSum += r.count / 1000; covSum += r.coverage
    return { expect: r.expect, hit: !!r.hit, rank: r.rank, actual: r.actual, rate: hits / (i + 1), baseline: expSum / (i + 1), quant: covSum / (i + 1) }
  })
  const n = asc.length
  const p = n ? expSum / n : 0
  const z = n && p > 0 && p < 1 ? (hits - n * p) / Math.sqrt(n * p * (1 - p)) : 0
  // 按配置分组
  const byCfgMap = new Map<string, { count: number; temp: number; n: number; hits: number }>()
  for (const r of rows) { const k = `${r.count}|${r.temp}`; const g = byCfgMap.get(k) || { count: r.count, temp: r.temp, n: 0, hits: 0 }; g.n++; g.hits += r.hit; byCfgMap.set(k, g) }
  const by_config = [...byCfgMap.values()].map(g => ({ ...g, rate: g.n ? g.hits / g.n : null, baseline: g.count / 1000 })).sort((a, b) => b.n - a.n)
  // 命中排名分布（命中时落在核心/主力/外围）
  const tierHits = { core: 0, main: 0, edge: 0 }
  for (const r of rows) if (r.hit) { const q = r.rank / r.count; if (q <= 0.1) tierHits.core++; else if (q <= 0.5) tierHits.main++; else tierHits.edge++ }
  const verdict = n < 30 ? `样本 ${n} 期，尚不足以下结论（建议 ≥ 100 期）` : Math.abs(z) < 1.96 ? `z=${z.toFixed(2)}，与随机基线无显著差异（95% 置信）——符合「区块哈希独立」的预期` : z > 0 ? `z=${z.toFixed(2)}，暂时显著高于基线；请继续观察是否回归` : `z=${z.toFixed(2)}，暂时显著低于基线；同样属于波动，请继续观察`
  return {
    n, hits, rate: n ? hits / n : null, baseline: p, expected_hits: Math.round(expSum * 100) / 100, z: Math.round(z * 100) / 100,
    quant_avg: n ? covSum / n : null, pending, tier_hits: tierHits, by_config, verdict,
    series, recent: rows.slice(0, 40).map(r => ({ expect: r.expect, actual: r.actual, hit: !!r.hit, rank: r.rank, count: r.count })),
  }
}
