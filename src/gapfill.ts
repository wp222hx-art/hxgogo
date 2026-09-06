// ============ 开奖完整性：漏期扫描 + 链上补齐 ============
// 上游 API 只返回最近 1000 期；一旦某段时间拉取失败超过 1000 期，官方接口就再也补不回来。
// 解决：哈希分分彩 = 每分钟 :03 秒的第一个 TRON 区块（README「统计时间 ↔ 区块」口径，60/60 期验证）。
// 对每个缺失期号：期号 → 北京时间分钟 → 目标时间戳（分钟 + 3s）→ TronGrid 找块 → blockID → 去 a-f 末 5 位 = 开奖号。
// 补齐的行 src='chain'，openTime 用区块时间 + 11s 近似（官方为抓块入库时间）。
import { SOURCES } from './sync'
import { findFirstBlockAtOrAfter, getNowBlock, type TronBlock } from './tron'
import { extractFive } from './engine5'
import { nextPeriod, periodAtTimeMs, periodTimeMs, sourceIntervalMs } from './period'

const BJ = 8 * 3600_000
/** 保留兼容入口；新调用应显式传入来源。 */
export function expectToMinuteMs(expect: string, source = 'qkltj:6001'): number | null {
  return periodTimeMs(expect, source)
}
export function minuteMsToExpect(ms: number, source = 'qkltj:6001'): string | null {
  return periodAtTimeMs(ms, source)
}

function boundedDays(days = 7): number {
  return Number.isFinite(days) ? Math.max(1, Math.min(30, Math.floor(days))) : 7
}

function summarizePeriods(rows: { expect: string; src?: string }[], source: string, limit = 500) {
  const valid = rows.filter(r => periodTimeMs(r.expect, source) != null).sort((a, b) => a.expect.localeCompare(b.expect))
  const have = new Set(valid.map(r => r.expect))
  const first = valid[0]?.expect ?? null, last = valid[valid.length - 1]?.expect ?? null
  const missing: string[] = [], byDay = new Map<string, { day: string; n: number; chain: number; expected: number }>()
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 500
  let checked = 0, missingTotal = 0
  let expect = first
  // 最多 30 天的查询窗口，额外保护异常数据库中的时间跨度。
  while (expect && last && expect <= last && checked < 60_000) {
    checked++
    const day = expect.slice(0, 8)
    const stat = byDay.get(day) ?? { day, n: 0, chain: 0, expected: 0 }
    stat.expected++; byDay.set(day, stat)
    if (!have.has(expect)) {
      missingTotal++
      if (missing.length < safeLimit) missing.push(expect)
    }
    expect = nextPeriod(expect, source)
  }
  for (const row of valid) {
    const stat = byDay.get(row.expect.slice(0, 8))
    if (stat) { stat.n++; if (row.src === 'chain') stat.chain++ }
  }
  return {
    checked, missing, missing_total: missingTotal, first, last,
    invalid_periods: rows.length - valid.length,
    truncated: !!expect && !!last && expect <= last,
    days: [...byDay.values()].map(r => ({ ...r, missing: Math.max(0, r.expected - r.n), complete: r.expected === r.n })),
  }
}

/** 按来源周期扫描实际观测到的首末期范围，包括跨日的完整缺失天。 */
export async function scanGaps(db: D1Database, source: string, opts: { days?: number; limit?: number } = {}) {
  const rows = (await db.prepare('SELECT expect FROM draws WHERE source=? AND open_ms>=? ORDER BY expect')
    .bind(source, Date.now() - boundedDays(opts.days) * 86_400_000).all<{ expect: string }>()).results
  const { days: _days, ...summary } = summarizePeriods(rows, source, opts.limit)
  return summary
}

/** 用链上区块补齐一批缺失期（每次最多 max 期，串行以免打爆 TronGrid） */
export async function fillGapsFromChain(db: D1Database, source: string, expects: string[], max = 20) {
  const cfg = SOURCES[source]; if (!cfg || cfg.chain !== 'tron') return { filled: 0, failed: 0, results: [] as any[] }
  let head: TronBlock | null = null; try { head = await getNowBlock() } catch {}
  const results: any[] = []; let filled = 0, failed = 0; const ts = Date.now()
  let i = 0
  for (const expect of expects.slice(0, max)) {
    if (i++ > 0) await new Promise(r => setTimeout(r, 250))   // 限速：避免公共节点 429
    const minMs = periodTimeMs(expect, source); if (minMs == null) { failed++; continue }
    const target = minMs + 3_000     // 分钟 + 3s 的第一个区块
    try {
      const blk = await findFirstBlockAtOrAfter(target, head || undefined)
      if (!blk) throw new Error('block not found')
      const five = extractFive(blk.hash); if (!five) throw new Error('hash has <5 digits')
      const openMs = blk.timestamp + 11_000
      const openTime = new Date(openMs + BJ).toISOString().slice(0, 19).replace('T', ' ')
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO draws (source, expect, block, hash, n1,n2,n3,n4,n5, open_ms, opennumber, lotto_type, lotto_type_cn, open_time, src_id, mismatch, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(source, expect, blk.number, blk.hash, five[0], five[1], five[2], five[3], five[4], openMs, five.join(','), cfg.code === '6002' ? 'trxbh3fc' : cfg.code === '6003' ? 'trxbh5fc' : cfg.code === '6004' ? 'trxbh10fc' : 'trxbhffc', cfg.name, openTime, null, 0, 'chain'),
        db.prepare(`INSERT INTO gap_log (source, expect, method, block, ok, detail, created_ms) VALUES (?,?,?,?,?,?,?)`).bind(source, expect, 'chain', blk.number, 1, `ts=${blk.timestamp} ${five.join('')}`, ts),
      ])
      filled++; results.push({ expect, ok: true, block: blk.number, five: five.join('') })
    } catch (e: any) {
      failed++; results.push({ expect, ok: false, error: String(e.message || e) })
      await db.prepare(`INSERT INTO gap_log (source, expect, method, block, ok, detail, created_ms) VALUES (?,?,?,?,?,?,?)`).bind(source, expect, 'chain', null, 0, String(e.message || e), ts).run()
    }
  }
  return { filled, failed, results }
}

/** 完整性报告：覆盖率仅针对已观测首末期之间的范围。 */
export async function coverageReport(db: D1Database, source: string, days = 7) {
  const since = Date.now() - boundedDays(days) * 86_400_000
  const rows = (await db.prepare('SELECT expect, src FROM draws WHERE source=? AND open_ms>=? ORDER BY expect')
    .bind(source, since).all<{ expect: string; src: string }>()).results
  const summary = summarizePeriods(rows, source, 50)
  const log = (await db.prepare('SELECT expect, method, block, ok, detail, created_ms FROM gap_log WHERE source=? ORDER BY id DESC LIMIT 20').bind(source).all<any>()).results
  const total = (await db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN src='chain' THEN 1 ELSE 0 END) c, MIN(expect) f, MAX(expect) l FROM draws WHERE source=?").bind(source).first<any>())
  return {
    days: summary.days, missing: summary.missing, missing_total: summary.missing_total,
    invalid_periods: summary.invalid_periods, truncated: summary.truncated,
    interval_ms: sourceIntervalMs(source), range: { first: summary.first, last: summary.last },
    total: { n: total?.n || 0, chain: total?.c || 0, first: total?.f, last: total?.l }, recent_fills: log,
  }
}
