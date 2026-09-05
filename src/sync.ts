// ============ 外部开奖数据同步（qkltj）：按开奖节拍实时同步 + 周期审计 + 缓存版本 ============
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

/** 官方入库延迟：区块在分钟 :03（ETH :11），openTime ≈ 区块时间 +10~12s → 新一期最早约在整分 +15s 可取到 */
const PUBLISH_DELAY_MS = 15_000
/** 到点后仍未出新期时的追赶轮询间隔 */
const CATCHUP_MS = 4_000
/** 审计周期：每 5 分钟拉 100 行逐字段核对并修正 */
const AUDIT_EVERY_MS = 5 * 60_000
const AUDIT_ROWS = 100

/** 数据版本：任何写入即 +1，供分析缓存 key 使用（同期号字段被修正也会失效） */
const versions = new Map<string, number>()
export const dataVersion = (source: string) => versions.get(source) || 0
function bump(source: string) { versions.set(source, dataVersion(source) + 1) }
/** 缓存清理钩子（index.tsx 注册） */
let cacheInvalidator: ((source: string) => void) | null = null
export const onInvalidate = (fn: (source: string) => void) => { cacheInvalidator = fn }

/** openTime 为 UTC+8 字串 */
function parseOpenTime(s: string): number {
  return new Date(s.replace(' ', 'T') + '+08:00').getTime()
}

async function fetchOnce(code: string, rows: number, timeoutMs: number): Promise<any[]> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`https://api.qkltj.com/api/draw-result?code=${code}&rows=${rows}&_=${Date.now()}`, { signal: ctrl.signal, headers: { accept: 'application/json', 'cache-control': 'no-cache' }, cf: { cacheTtl: 0 } } as any)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const j = await res.json() as any
    if (j.code !== 0 || !Array.isArray(j.data)) throw new Error(j.msg || 'bad payload')
    return j.data
  } finally { clearTimeout(t) }
}
/** 拉取上游：三连重试（超时 5s/6s/8s，间隔 0.8s/1.6s 退避）。总耗时上限 ~22s，仍留在 1 分钟节拍内 */
export const FETCH_RETRIES = [5_000, 6_000, 8_000]
export async function fetchQkltj(code: string, rows: number): Promise<any[]> {
  let lastErr: any
  for (let i = 0; i < FETCH_RETRIES.length; i++) {
    try { return await fetchOnce(code, rows, FETCH_RETRIES[i]) }
    catch (e: any) { lastErr = e; if (i < FETCH_RETRIES.length - 1) await new Promise(r => setTimeout(r, 800 * (i + 1))) }
  }
  throw new Error(`upstream failed after ${FETCH_RETRIES.length} tries: ${lastErr?.name === 'AbortError' ? 'timeout' : String(lastErr?.message || lastErr)}`)
}
/** 断流判定：距最新开奖超过 2 个周期 + 发布延迟 → stale */
export const staleAfterMs = (intervalMs: number) => 2 * intervalMs + PUBLISH_DELAY_MS

export interface SyncResult {
  source: string; skipped?: boolean; reason?: string
  mode?: 'incremental' | 'catchup' | 'audit' | 'force'
  fetched?: number; inserted: number; updated?: number; unchanged?: number
  latest_expect?: string | null; latest_open_ms?: number; next_due_ms?: number
  latency_ms?: number; consistent?: boolean
  diffs?: { expect: string; field: string; local: any; remote: any }[]
  error?: string
}

/** 是否到了该拉取的时点 */
function dueInfo(meta: any, cfg: { intervalMs: number }, now: number) {
  if (!meta || !meta.latest_open_ms) return { due: true, mode: 'catchup' as const }
  const expectedNext = meta.latest_open_ms + cfg.intervalMs   // 下一期理论 openTime
  if (now < expectedNext - 2_000) return { due: false, mode: 'incremental' as const, next: expectedNext }
  // 已过下一期理论时间：若上次尝试距今 < CATCHUP_MS 则等待，避免打爆接口
  if (now - (meta.last_sync_ms || 0) < CATCHUP_MS) return { due: false, mode: 'catchup' as const, next: meta.last_sync_ms + CATCHUP_MS }
  return { due: true, mode: now - expectedNext > 2 * cfg.intervalMs ? 'catchup' as const : 'incremental' as const }
}

/**
 * 实时同步：
 *  - 按开奖节拍调度：下一期理论 openTime 之前不请求；到点后每 4s 追赶直到拿到新期
 *  - 每 5 分钟做一次 100 行审计（逐字段比对、UPSERT 修正）
 *  - force=true：跳过节拍，拉 AUDIT_ROWS 行全量核对，清空该源分析缓存，返回详细报告
 */
export async function syncSource(db: D1Database, source: string, force = false): Promise<SyncResult> {
  const cfg = SOURCES[source]; if (!cfg || !cfg.code) return { source, inserted: 0, skipped: true, reason: 'local source' }
  const meta = await db.prepare('SELECT * FROM sync_meta WHERE source=?').bind(source).first<any>()
  const now = Date.now()
  let mode: SyncResult['mode']
  if (force) mode = 'force'
  else {
    const d = dueInfo(meta, cfg, now)
    const auditDue = meta && now - (meta.last_audit_ms || 0) >= AUDIT_EVERY_MS
    if (!d.due && !auditDue) return { source, inserted: 0, skipped: true, reason: 'not due', next_due_ms: d.next, latest_expect: meta?.latest_expect, latest_open_ms: meta?.latest_open_ms }
    mode = auditDue && !d.due ? 'audit' : d.mode
  }
  // 抢占：先写 last_sync_ms 防止并发重复拉
  await db.prepare('INSERT INTO sync_meta (source, last_sync_ms, total) VALUES (?,?,0) ON CONFLICT(source) DO UPDATE SET last_sync_ms=excluded.last_sync_ms').bind(source, now).run()
  const rows = (!meta || meta.total === 0) ? 1000
    : mode === 'force' || mode === 'audit' ? AUDIT_ROWS
    : mode === 'catchup' ? Math.min(1000, Math.ceil((now - (meta.latest_open_ms || meta.last_sync_ms)) / cfg.intervalMs) + 10)
    : 5
  const t0 = Date.now()
  try {
    const data = await fetchQkltj(cfg.code, rows)
    const latency = Date.now() - t0
    // 本地已有行（用于逐字段比对与变更统计）
    const local = new Map<string, any>()
    const lrows = (await db.prepare('SELECT expect, block, hash, opennumber, open_time FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT ?').bind(source, Math.min(1000, data.length + 50)).all<any>()).results
    for (const r of lrows) local.set(r.expect, r)
    const stmts: D1PreparedStatement[] = []
    const diffs: SyncResult['diffs'] = []
    let inserted = 0, updated = 0, unchanged = 0
    let latestExpect: string | null = null, latestOpen = 0
    for (const r of data) {
      if (!r || !r.hash || !r.expect) continue
      const expect = String(r.expect)
      // 严格以官方 opennumber 为准；hash 推算仅用于交叉校验（不一致标记 mismatch=1）
      const official = typeof r.opennumber === 'string' ? r.opennumber.split(',').map((x: string) => Number(x.trim())) : []
      const derived = extractFive(r.hash)
      const five = official.length === 5 && official.every((x: number) => Number.isInteger(x) && x >= 0 && x <= 9) ? official : derived
      if (!five) continue
      const mismatch = derived && official.length === 5 && derived.some((v, i) => v !== official[i]) ? 1 : 0
      const openMs = parseOpenTime(r.openTime)
      if (openMs > latestOpen) { latestOpen = openMs; latestExpect = expect }
      const l = local.get(expect)
      if (!l) inserted++
      else {
        const fields: [string, any, any][] = [['block', l.block, Number(r.block) || null], ['hash', l.hash, r.hash], ['opennumber', l.opennumber, r.opennumber ?? null], ['openTime', l.open_time, r.openTime ?? null]]
        const changed = fields.filter(([, a, b]) => a !== b)
        if (!changed.length) { unchanged++; continue }
        updated++
        for (const [field, a, b] of changed) if (diffs.length < 30) diffs.push({ expect, field, local: a, remote: b })
      }
      stmts.push(db.prepare(`INSERT INTO draws (source, expect, block, hash, n1,n2,n3,n4,n5, open_ms, opennumber, lotto_type, lotto_type_cn, open_time, src_id, mismatch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source, expect) DO UPDATE SET block=excluded.block, hash=excluded.hash, n1=excluded.n1, n2=excluded.n2, n3=excluded.n3, n4=excluded.n4, n5=excluded.n5, open_ms=excluded.open_ms,
          opennumber=excluded.opennumber, lotto_type=excluded.lotto_type, lotto_type_cn=excluded.lotto_type_cn, open_time=excluded.open_time, src_id=excluded.src_id, mismatch=excluded.mismatch`)
        .bind(source, expect, Number(r.block) || null, r.hash, five[0], five[1], five[2], five[3], five[4], openMs, r.opennumber ?? null, r.lottoType ?? null, r.lottoTypeCn ?? null, r.openTime ?? null, r.id ?? null, mismatch))
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100))
    const cnt = await db.prepare('SELECT COUNT(*) c, MAX(open_ms) m FROM draws WHERE source=?').bind(source).first<any>()
    // 元数据：最新期、下一期到点时间、审计统计
    const curLatestOpen = Math.max(latestOpen, cnt.m || 0)
    const curLatestExpect = latestOpen >= (cnt.m || 0) ? latestExpect : (meta?.latest_expect ?? latestExpect)
    const nextDue = curLatestOpen ? curLatestOpen + cfg.intervalMs : now + CATCHUP_MS
    const isAudit = mode === 'force' || mode === 'audit' || !meta || meta.total === 0
    await db.prepare(`UPDATE sync_meta SET total=?, last_error=NULL, fail_streak=0, latest_expect=?, latest_open_ms=?, next_due_ms=?, last_ok_ms=?, last_inserted=?, last_rows=?, last_latency_ms=?
        ${isAudit ? ', last_audit_ms=?, audit_rows=?, audit_diff=?, audit_fixed=?' : ''} WHERE source=?`)
      .bind(...[cnt.c, curLatestExpect, curLatestOpen, nextDue, Date.now(), inserted, data.length, latency, ...(isAudit ? [Date.now(), data.length, updated, updated] : []), source]).run()
    await resolveAlerts(db, source, now)
    if (inserted || updated || force) { bump(source); cacheInvalidator?.(source) }
    return { source, mode, fetched: data.length, inserted, updated, unchanged, latest_expect: curLatestExpect, latest_open_ms: curLatestOpen, next_due_ms: nextDue, latency_ms: latency, consistent: updated === 0, diffs }
  } catch (e: any) {
    const msg = String(e.message || e)
    await db.prepare('UPDATE sync_meta SET last_error=?, fail_streak=fail_streak+1, last_fail_ms=? WHERE source=?').bind(msg, now, source).run()
    const m2 = await db.prepare('SELECT fail_streak FROM sync_meta WHERE source=?').bind(source).first<any>()
    // 连续 3 次失败 → 记一条告警（同一未解决告警不重复）
    if ((m2?.fail_streak || 0) >= 3) {
      const open = await db.prepare(`SELECT id FROM sync_alerts WHERE source=? AND kind='fetch_fail' AND resolved_ms IS NULL`).bind(source).first()
      if (!open) await db.prepare(`INSERT INTO sync_alerts (source, kind, detail, created_ms) VALUES (?,?,?,?)`).bind(source, 'fetch_fail', `连续 ${m2.fail_streak} 次拉取失败：${msg}`, now).run()
    }
    return { source, mode, inserted: 0, error: msg }
  }
}
/** 成功后调用：关闭未解决告警并记 recovered */
async function resolveAlerts(db: D1Database, source: string, now: number) {
  const open = (await db.prepare(`SELECT id, kind, detail FROM sync_alerts WHERE source=? AND resolved_ms IS NULL`).bind(source).all<any>()).results
  if (!open.length) return
  await db.batch([
    db.prepare(`UPDATE sync_alerts SET resolved_ms=? WHERE source=? AND resolved_ms IS NULL`).bind(now, source),
    db.prepare(`INSERT INTO sync_alerts (source, kind, detail, created_ms, resolved_ms) VALUES (?,?,?,?,?)`).bind(source, 'recovered', `已恢复（关闭 ${open.length} 条告警）`, now, now),
  ])
}

/** 同步状态（供 /api/sync/status 与前端状态条） */
export async function syncStatus(db: D1Database, source: string) {
  const cfg = SOURCES[source]
  const meta = await db.prepare('SELECT * FROM sync_meta WHERE source=?').bind(source).first<any>()
  const now = Date.now()
  const lag = meta?.latest_open_ms ? now - meta.latest_open_ms : null
  // 新鲜度：距最新期 openTime 在 (interval + 25s) 内视为实时
  const fresh = lag != null && lag < cfg.intervalMs + PUBLISH_DELAY_MS + 10_000
  return {
    source, name: cfg.name, interval_ms: cfg.intervalMs, now,
    latest_expect: meta?.latest_expect ?? null, latest_open_ms: meta?.latest_open_ms ?? null, lag_ms: lag,
    next_due_ms: meta?.next_due_ms ?? null, expected_publish_ms: meta?.latest_open_ms ? meta.latest_open_ms + cfg.intervalMs : null,
    last_sync_ms: meta?.last_sync_ms ?? null, last_ok_ms: meta?.last_ok_ms ?? null, last_latency_ms: meta?.last_latency_ms ?? null,
    last_inserted: meta?.last_inserted ?? 0, last_rows: meta?.last_rows ?? 0, total: meta?.total ?? 0,
    audit: { last_ms: meta?.last_audit_ms ?? null, rows: meta?.audit_rows ?? 0, diff: meta?.audit_diff ?? 0, fixed: meta?.audit_fixed ?? 0, every_ms: AUDIT_EVERY_MS },
    last_error: meta?.last_error ?? null, fresh, stale: lag != null && lag > staleAfterMs(cfg.intervalMs), fail_streak: meta?.fail_streak || 0, version: dataVersion(source),
  }
}

export async function loadDraws(db: D1Database, source: string, limit = 1000, before?: number) {
  const q = before
    ? db.prepare('SELECT * FROM draws WHERE source=? AND open_ms<? ORDER BY open_ms DESC LIMIT ?').bind(source, before, limit)
    : db.prepare('SELECT * FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT ?').bind(source, limit)
  return (await q.all<any>()).results // 最新在前
}
