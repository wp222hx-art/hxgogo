// ============ 开奖完整性：漏期扫描 + 链上补齐 ============
// 上游 API 只返回最近 1000 期；一旦某段时间拉取失败超过 1000 期，官方接口就再也补不回来。
// 解决：哈希分分彩 = 每分钟 :03 秒的第一个 TRON 区块（README「统计时间 ↔ 区块」口径，60/60 期验证）。
// 对每个缺失期号：期号 → 北京时间分钟 → 目标时间戳（分钟 + 3s）→ TronGrid 找块 → blockID → 去 a-f 末 5 位 = 开奖号。
// 补齐的行 src='chain'，openTime 用区块时间 + 11s 近似（官方为抓块入库时间）。
import { SOURCES } from './sync'
import { findFirstBlockAtOrAfter, getNowBlock, type TronBlock } from './tron'
import { extractFive } from './engine5'

const BJ = 8 * 3600_000
/**
 * 期号 → 该期对应分钟的 UTC 毫秒。
 * 实测口径（与上游 1000 期逐条核对）：expect = YYYYMMDD + 序号 0001..1440，序号 N 对应北京时间“当日 00:00 + N 分钟”。
 * 例：202609060058 → 09-06 00:58；202609051440 → 09-06 00:00（当日最后一期跑到次日零点）。
 * 开奖区块 = 该分钟 +3s 的首个区块，openTime ≈ 分钟 +14s。
 */
export function expectToMinuteMs(expect: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{4})$/.exec(expect); if (!m) return null
  const seq = Number(m[4]); if (seq < 1 || seq > 1440) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - BJ + seq * 60_000
}
/** 分钟时间戳 → 期号（与上面互逆：00:00 归到前一日的 1440） */
export function minuteMsToExpect(ms: number): string {
  const bj = new Date(ms + BJ - 60_000)   // 往前推 1 分钟取“所属日”，使 00:00 归为前一日 1440
  const seq = bj.getUTCHours() * 60 + bj.getUTCMinutes() + 1
  return `${bj.getUTCFullYear()}${String(bj.getUTCMonth() + 1).padStart(2, '0')}${String(bj.getUTCDate()).padStart(2, '0')}${String(seq).padStart(4, '0')}`
}
const nextExpect = (e: string) => { const ms = expectToMinuteMs(e); return ms == null ? null : minuteMsToExpect(ms + 60_000) }

/** 扫描 [from, to] 区间内缺失的期号（按分钟节拍生成完整序列，与库内比对） */
export async function scanGaps(db: D1Database, source: string, opts: { days?: number; limit?: number } = {}) {
  const days = Math.min(30, opts.days ?? 7)
  const rows = (await db.prepare(`SELECT expect FROM draws WHERE source=? AND open_ms>=? ORDER BY expect`).bind(source, Date.now() - days * 86400_000).all<any>()).results
  if (rows.length < 2) return { checked: 0, missing: [] as string[], first: null, last: null }
  const have = new Set(rows.map(r => r.expect))
  const first = rows[0].expect, last = rows[rows.length - 1].expect
  const missing: string[] = []
  let e: string | null = first; let guard = 0
  while (e && e < last && guard++ < 60_000) { if (!have.has(e)) missing.push(e); e = nextExpect(e) }
  return { checked: guard, missing: missing.slice(0, opts.limit ?? 500), missing_total: missing.length, first, last }
}

/** 用链上区块补齐一批缺失期（每次最多 max 期，串行以免打爆 TronGrid） */
export async function fillGapsFromChain(db: D1Database, source: string, expects: string[], max = 20) {
  const cfg = SOURCES[source]; if (!cfg || cfg.chain !== 'tron') return { filled: 0, failed: 0, results: [] as any[] }
  let head: TronBlock | null = null; try { head = await getNowBlock() } catch {}
  const results: any[] = []; let filled = 0, failed = 0; const ts = Date.now()
  let i = 0
  for (const expect of expects.slice(0, max)) {
    if (i++ > 0) await new Promise(r => setTimeout(r, 250))   // 限速：避免公共节点 429
    const minMs = expectToMinuteMs(expect); if (minMs == null) { failed++; continue }
    const target = minMs + 3_000     // 分钟 + 3s 的第一个区块
    try {
      const blk = await findFirstBlockAtOrAfter(target, head || undefined)
      if (!blk) throw new Error('block not found')
      const five = extractFive(blk.hash); if (!five) throw new Error('hash has <5 digits')
      const openMs = blk.timestamp + 11_000
      const openTime = new Date(openMs + BJ).toISOString().slice(0, 19).replace('T', ' ')
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO draws (source, expect, block, hash, n1,n2,n3,n4,n5, open_ms, opennumber, lotto_type, lotto_type_cn, open_time, src_id, mismatch, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(source, expect, blk.number, blk.hash, five[0], five[1], five[2], five[3], five[4], openMs, five.join(','), 'trxbhffc', cfg.name, openTime, null, 0, 'chain'),
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

/** 完整性报告：按天覆盖率 + 来源构成 + 最近补齐记录 */
export async function coverageReport(db: D1Database, source: string, days = 7) {
  const since = Date.now() - days * 86400_000
  const byDay = (await db.prepare(`SELECT substr(expect,1,8) day, COUNT(*) n, SUM(CASE WHEN src='chain' THEN 1 ELSE 0 END) chain_n, MIN(CAST(substr(expect,9,4) AS INTEGER)) fs, MAX(CAST(substr(expect,9,4) AS INTEGER)) ls FROM draws WHERE source=? AND open_ms>=? GROUP BY day ORDER BY day`).bind(source, since).all<any>()).results
  const days_ = byDay.map(r => ({ day: r.day, n: r.n, chain: r.chain_n, expected: r.ls - r.fs + 1, missing: r.ls - r.fs + 1 - r.n, complete: r.ls - r.fs + 1 === r.n }))
  const gaps = await scanGaps(db, source, { days, limit: 50 })
  const log = (await db.prepare(`SELECT expect, method, block, ok, detail, created_ms FROM gap_log WHERE source=? ORDER BY id DESC LIMIT 20`).bind(source).all<any>()).results
  const total = (await db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN src='chain' THEN 1 ELSE 0 END) c, MIN(expect) f, MAX(expect) l FROM draws WHERE source=?`).bind(source).first<any>())
  return { days: days_, missing: gaps.missing, missing_total: gaps.missing_total || 0, range: { first: gaps.first, last: gaps.last }, total: { n: total?.n || 0, chain: total?.c || 0, first: total?.f, last: total?.l }, recent_fills: log }
}
