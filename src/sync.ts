// ============ 外部开奖数据同步（qkltj） ============
import { extractFive } from './engine5'

export const SOURCES: Record<string, { name: string; code: string; intervalMs: number; chain: 'tron' | 'eth' }> = {
  'qkltj:6001': { name: '哈希分分彩', code: '6001', intervalMs: 60_000, chain: 'tron' },
  'qkltj:6002': { name: '哈希三分彩', code: '6002', intervalMs: 180_000, chain: 'tron' },
  'qkltj:6003': { name: '哈希五分彩', code: '6003', intervalMs: 300_000, chain: 'tron' },
  'qkltj:6004': { name: '哈希十分彩', code: '6004', intervalMs: 600_000, chain: 'tron' },
  'qkltj:7001': { name: '以太坊分分彩', code: '7001', intervalMs: 60_000, chain: 'eth' },
  'local:five': { name: 'HashPlay 五位厅', code: '', intervalMs: 60_000, chain: 'tron' },
}
export const isSource = (s: string) => s in SOURCES

/** openTime 为 UTC+8 字串 */
function parseOpenTime(s: string): number {
  return new Date(s.replace(' ', 'T') + '+08:00').getTime()
}

export async function fetchQkltj(code: string, rows: number): Promise<any[]> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`https://api.qkltj.com/api/draw-result?code=${code}&rows=${rows}`, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const j = await res.json() as any
    if (j.code !== 0 || !Array.isArray(j.data)) throw new Error(j.msg || 'bad payload')
    return j.data
  } finally { clearTimeout(t) }
}

/** 懒同步：距离上次同步 >= 半个开奖间隔 才真正拉取；rows 自适应 */
export async function syncSource(db: D1Database, source: string, force = false): Promise<{ inserted: number; skipped?: boolean }> {
  const cfg = SOURCES[source]; if (!cfg || !cfg.code) return { inserted: 0, skipped: true }
  const meta = await db.prepare('SELECT * FROM sync_meta WHERE source=?').bind(source).first<any>()
  const now = Date.now()
  const minGap = Math.max(20_000, cfg.intervalMs / 2)
  if (!force && meta && now - meta.last_sync_ms < minGap) return { inserted: 0, skipped: true }
  // 抢占：先写 last_sync_ms 防止并发重复拉
  await db.prepare('INSERT INTO sync_meta (source, last_sync_ms, total) VALUES (?,?,0) ON CONFLICT(source) DO UPDATE SET last_sync_ms=excluded.last_sync_ms').bind(source, now).run()
  const rows = (!meta || meta.total === 0 || force) ? 1000 : Math.min(1000, Math.ceil((now - meta.last_sync_ms) / cfg.intervalMs) + 5)
  try {
    const data = await fetchQkltj(cfg.code, rows)
    const stmts: D1PreparedStatement[] = []
    for (const r of data) {
      const five = extractFive(r.hash); if (!five) continue
      // 校验站方 opennumber 与我们从哈希推算一致（不一致也存，但用推算值，保持规则统一）
      stmts.push(db.prepare('INSERT OR IGNORE INTO draws (source, expect, block, hash, n1,n2,n3,n4,n5, open_ms) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(source, String(r.expect), Number(r.block) || null, r.hash, ...five, parseOpenTime(r.openTime)))
    }
    let inserted = 0
    for (let i = 0; i < stmts.length; i += 100) { const res = await db.batch(stmts.slice(i, i + 100)); inserted += res.reduce((s, r) => s + (r.meta.changes || 0), 0) }
    const cnt = await db.prepare('SELECT COUNT(*) c FROM draws WHERE source=?').bind(source).first<any>()
    await db.prepare('UPDATE sync_meta SET total=?, last_error=NULL WHERE source=?').bind(cnt.c, source).run()
    return { inserted }
  } catch (e: any) {
    await db.prepare('UPDATE sync_meta SET last_error=? WHERE source=?').bind(String(e.message || e), source).run()
    return { inserted: 0 }
  }
}

export async function loadDraws(db: D1Database, source: string, limit = 1000, before?: number) {
  const q = before
    ? db.prepare('SELECT * FROM draws WHERE source=? AND open_ms<? ORDER BY open_ms DESC LIMIT ?').bind(source, before, limit)
    : db.prepare('SELECT * FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT ?').bind(source, limit)
  return (await q.all<any>()).results // 最新在前
}
