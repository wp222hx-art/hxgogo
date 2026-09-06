// ============ 外部开奖数据同步（qkltj）：按开奖节拍实时同步 + 周期审计 + 缓存版本 ============
import { extractFive } from './engine5'
import { periodTimeMs, sourceIntervalMs } from './period'

export const SOURCES: Record<string, { name: string; code: string; intervalMs: number; chain: 'tron' | 'eth' }> = {
  'qkltj:6001': { name: '哈希分分彩', code: '6001', intervalMs: sourceIntervalMs('qkltj:6001')!, chain: 'tron' },
  'qkltj:6002': { name: '哈希三分彩', code: '6002', intervalMs: sourceIntervalMs('qkltj:6002')!, chain: 'tron' },
  'qkltj:6003': { name: '哈希五分彩', code: '6003', intervalMs: sourceIntervalMs('qkltj:6003')!, chain: 'tron' },
  'qkltj:6004': { name: '哈希十分彩', code: '6004', intervalMs: sourceIntervalMs('qkltj:6004')!, chain: 'tron' },
  'qkltj:7001': { name: '以太坊分分彩', code: '7001', intervalMs: sourceIntervalMs('qkltj:7001')!, chain: 'eth' },
  'local:five': { name: 'HashPlay 五位厅', code: '', intervalMs: sourceIntervalMs('local:five')!, chain: 'tron' },
}
export const isSource = (s: string) => Object.prototype.hasOwnProperty.call(SOURCES, s)

/** 官方入库延迟：区块在分钟 :03（ETH :11），openTime ≈ 区块时间 +10~12s → 新一期最早约在整分 +15s 可取到 */
const PUBLISH_DELAY_MS = 15_000
/** 到点后仍未出新期时的追赶轮询间隔 */
const CATCHUP_MS = 4_000
/** 审计周期：每 5 分钟拉 100 行逐字段核对并修正 */
const AUDIT_EVERY_MS = 5 * 60_000
const AUDIT_ROWS = 100

/** 数据版本：开奖事务成功且内容发生改变即 +1，供分析缓存 key 使用（同期号字段被修正也会失效） */
const versions = new Map<string, number>()
export const dataVersion = (source: string) => versions.get(source) || 0
function bump(source: string) { versions.set(source, dataVersion(source) + 1) }
/** 缓存清理钩子（index.tsx 注册） */
let cacheInvalidator: ((source: string) => void) | null = null
export const onInvalidate = (fn: (source: string) => void) => { cacheInvalidator = fn }
/** 仅在共享开奖表的真实变更成功提交后调用，供同步和补漏共用。 */
export function notifyDrawChange(source: string): void { bump(source); cacheInvalidator?.(source) }

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

/** 同一数据库/来源的请求共享一次同步，避免慢响应覆盖随后请求的新结果。 */
const inFlight = new WeakMap<object, Map<string, Promise<SyncResult>>>()
export function syncSource(db: D1Database, source: string, force = false): Promise<SyncResult> {
  const cfg = SOURCES[source]
  if (!cfg || !cfg.code) return Promise.resolve({ source, inserted: 0, skipped: true, reason: 'local source' })
  let tasks = inFlight.get(db as object)
  if (!tasks) { tasks = new Map(); inFlight.set(db as object, tasks) }
  const running = tasks.get(source); if (running) return running
  const task = synchronize(db, source, force).finally(() => tasks!.delete(source))
  tasks.set(source, task)
  return task
}

function officialNumbers(raw: unknown): number[] | null {
  if (typeof raw !== 'string') return null
  const tokens = raw.split(',').map(s => s.trim())
  return tokens.length === 5 && tokens.every(s => /^[0-9]$/.test(s)) ? tokens.map(Number) : null
}
const positiveInteger = (value: unknown) => {
  const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null
}
const textOrNull = (value: unknown) => typeof value === 'string' ? value : null
const comparedFields = ['block','hash','n1','n2','n3','n4','n5','open_ms','opennumber','lotto_type','lotto_type_cn','open_time','src_id','mismatch','src'] as const

async function synchronize(db: D1Database, source: string, force: boolean): Promise<SyncResult> {
  const cfg = SOURCES[source]
  const meta = await db.prepare('SELECT * FROM sync_meta WHERE source=?').bind(source).first<any>()
  const now = Date.now()
  const skipped = (reason: string, next: number): SyncResult => ({ source, inserted: 0, skipped: true, reason, next_due_ms: next, latest_expect: meta?.latest_expect, latest_open_ms: meta?.latest_open_ms })
  // 手动强制同步也不能绕过故障退避或每源最短请求间隔。
  if (meta?.fail_streak > 0 && meta.next_due_ms > now) return skipped('failure backoff', meta.next_due_ms)
  if (meta?.last_sync_ms && now - meta.last_sync_ms < CATCHUP_MS) return skipped('throttled', meta.last_sync_ms + CATCHUP_MS)
  const d = dueInfo(meta, cfg, now), auditDue = !meta || !meta.total || now - (meta.last_audit_ms || 0) >= AUDIT_EVERY_MS
  if (!force && !d.due && !auditDue) return skipped('not due', d.next || now + CATCHUP_MS)
  const mode: SyncResult['mode'] = force ? 'force' : auditDue && !d.due ? 'audit' : d.mode
  const isAudit = force || auditDue
  await db.prepare('INSERT INTO sync_meta (source,last_sync_ms,total) VALUES (?,?,0) ON CONFLICT(source) DO UPDATE SET last_sync_ms=excluded.last_sync_ms').bind(source, now).run()
  const behindRows = Math.min(1000, Math.max(5, Math.ceil((now - (meta?.latest_open_ms || meta?.last_sync_ms || now)) / cfg.intervalMs) + 10))
  const rows = !meta || !meta.total ? 1000 : Math.min(1000, Math.max(isAudit ? AUDIT_ROWS : 5, mode === 'catchup' ? behindRows : 5))
  const t0 = Date.now()
  try {
    const data = await fetchQkltj(cfg.code, rows), latency = Date.now() - t0
    if (!data.length) throw new Error('upstream returned no records; existing data retained')
    const normalized = new Map<string, any>()
    for (const raw of data.slice(0, 1000)) {
      if (!raw || typeof raw.hash !== 'string' || !raw.hash.trim() || raw.expect == null) continue
      const expect = String(raw.expect)
      if (periodTimeMs(expect, source) == null) continue
      const derived = extractFive(raw.hash), hasOfficial = raw.opennumber !== undefined && raw.opennumber !== null
      const official = hasOfficial ? officialNumbers(raw.opennumber) : null
      // 提供了非法官方号码时拒绝该行，不能悄悄用哈希换掉坏的官方字段。
      if (hasOfficial && !official) continue
      const five = official || derived
      const openMs = typeof raw.openTime === 'string' ? parseOpenTime(raw.openTime) : NaN
      if (!five || !Number.isFinite(openMs)) continue
      const record = {
        expect, block: positiveInteger(raw.block), hash: raw.hash,
        n1: five[0], n2: five[1], n3: five[2], n4: five[3], n5: five[4], open_ms: openMs,
        opennumber: hasOfficial ? raw.opennumber : null,
        lotto_type: textOrNull(raw.lottoType), lotto_type_cn: textOrNull(raw.lottoTypeCn),
        open_time: raw.openTime, src_id: positiveInteger(raw.id),
        mismatch: official && derived && derived.some((n, i) => n !== official[i]) ? 1 : 0, src: 'qkltj',
      }
      const duplicate = normalized.get(expect)
      if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(record)) throw new Error(`upstream has conflicting rows for ${expect}; existing data retained`)
      normalized.set(expect, record)
    }
    if (!normalized.size) throw new Error('upstream has no valid records; existing data retained')
    const local = new Map<string, any>()
    const existing = (await db.prepare('SELECT * FROM draws WHERE source=? AND expect IN (SELECT value FROM json_each(?))').bind(source, JSON.stringify([...normalized.keys()])).all<any>()).results
    for (const row of existing) local.set(row.expect, row)
    let inserted = 0, updated = 0, unchanged = 0
    const changes: any[] = [], diffs: NonNullable<SyncResult['diffs']> = []
    for (const row of normalized.values()) {
      const old = local.get(row.expect)
      if (!old) inserted++
      else {
        const fields = comparedFields.filter(field => old[field] !== row[field])
        if (!fields.length) { unchanged++; continue }
        updated++
        for (const field of fields) if (diffs.length < 30) diffs.push({ expect: row.expect, field, local: old[field], remote: row[field] })
      }
      changes.push(row)
    }
    const statements: D1PreparedStatement[] = []
    if (changes.length) statements.push(db.prepare(`INSERT INTO draws(source,expect,block,hash,n1,n2,n3,n4,n5,open_ms,opennumber,lotto_type,lotto_type_cn,open_time,src_id,mismatch,src)
      SELECT ?,json_extract(value,'$.expect'),json_extract(value,'$.block'),json_extract(value,'$.hash'),json_extract(value,'$.n1'),json_extract(value,'$.n2'),json_extract(value,'$.n3'),json_extract(value,'$.n4'),json_extract(value,'$.n5'),json_extract(value,'$.open_ms'),json_extract(value,'$.opennumber'),json_extract(value,'$.lotto_type'),json_extract(value,'$.lotto_type_cn'),json_extract(value,'$.open_time'),json_extract(value,'$.src_id'),json_extract(value,'$.mismatch'),json_extract(value,'$.src')
      FROM json_each(?) WHERE 1
      ON CONFLICT(source,expect) DO UPDATE SET ${comparedFields.map(field => `${field}=excluded.${field}`).join(',')}`).bind(source, JSON.stringify(changes)))
    const completed = Date.now()
    statements.push(db.prepare(`UPDATE sync_meta SET
      total=(SELECT COUNT(*) FROM draws WHERE source=?),
      latest_expect=(SELECT expect FROM draws WHERE source=? ORDER BY open_ms DESC,expect DESC LIMIT 1),
      latest_open_ms=COALESCE((SELECT MAX(open_ms) FROM draws WHERE source=?),0),
      next_due_ms=COALESCE((SELECT MAX(open_ms)+? FROM draws WHERE source=?),?),
      last_error=NULL,fail_streak=0,last_ok_ms=?,last_inserted=?,last_rows=?,last_latency_ms=?
      ${isAudit ? ',last_audit_ms=?,audit_rows=?,audit_diff=?,audit_fixed=?' : ''}
      WHERE source=? RETURNING total,latest_expect,latest_open_ms,next_due_ms`)
      .bind(source,source,source,cfg.intervalMs,source,completed+CATCHUP_MS,completed,inserted,data.length,latency,...(isAudit ? [completed,data.length,updated,updated] : []),source))
    // 单个事务覆盖全部开奖与元数据；任何一行/元数据失败都不会留下“半批”。
    const committed = await db.batch<any>(statements)
    const current = committed.at(-1)?.results?.[0] as any
    if (changes.length) notifyDrawChange(source)
    // 告警整理失败不撤销已提交的数据，也不把已提交的同步报告为失败。
    try { await resolveAlerts(db, source, completed) } catch (error) { console.error('sync alert cleanup', source, error) }
    return { source, mode, fetched: data.length, inserted, updated, unchanged, latest_expect: current?.latest_expect ?? null, latest_open_ms: current?.latest_open_ms ?? 0, next_due_ms: current?.next_due_ms ?? completed + CATCHUP_MS, latency_ms: latency, consistent: updated === 0, diffs }
  } catch (e: any) {
    const msg = String(e.message || e), failedAt = Date.now(), failures = (meta?.fail_streak || 0) + 1
    const retryAt = failedAt + Math.min(5 * 60_000, CATCHUP_MS * 2 ** Math.min(7, failures - 1))
    await db.prepare('UPDATE sync_meta SET last_error=?,fail_streak=fail_streak+1,last_fail_ms=?,next_due_ms=? WHERE source=?').bind(msg,failedAt,retryAt,source).run()
    if (failures >= 3) {
      const open = await db.prepare(`SELECT id FROM sync_alerts WHERE source=? AND kind='fetch_fail' AND resolved_ms IS NULL`).bind(source).first()
      if (!open) await db.prepare('INSERT INTO sync_alerts(source,kind,detail,created_ms) VALUES (?,?,?,?)').bind(source,'fetch_fail',`连续 ${failures} 次拉取失败：${msg}`,failedAt).run()
    }
    return { source, mode, inserted: 0, next_due_ms: retryAt, error: msg }
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
  const meta = await db.prepare(`SELECT m.*,
      (SELECT COUNT(*) FROM draws WHERE source=?) AS canonical_total,
      (SELECT expect FROM draws WHERE source=? ORDER BY open_ms DESC,expect DESC LIMIT 1) AS canonical_expect,
      (SELECT MAX(open_ms) FROM draws WHERE source=?) AS canonical_open_ms
    FROM (SELECT ? AS requested_source) q LEFT JOIN sync_meta m ON m.source=q.requested_source`).bind(source,source,source,source).first<any>()
  const now = Date.now()
  const latestOpen = meta?.canonical_open_ms ?? null
  const lag = latestOpen != null ? now - latestOpen : null
  // 新鲜度：距最新期 openTime 在 (interval + 25s) 内视为实时
  const fresh = lag != null && lag < cfg.intervalMs + PUBLISH_DELAY_MS + 10_000
  return {
    source, name: cfg.name, interval_ms: cfg.intervalMs, now,
    latest_expect: meta?.canonical_expect ?? null, latest_open_ms: latestOpen, lag_ms: lag,
    next_due_ms: meta?.next_due_ms ?? null, expected_publish_ms: latestOpen != null ? latestOpen + cfg.intervalMs : null,
    last_sync_ms: meta?.last_sync_ms ?? null, last_ok_ms: meta?.last_ok_ms ?? null, last_latency_ms: meta?.last_latency_ms ?? null,
    last_inserted: meta?.last_inserted ?? 0, last_rows: meta?.last_rows ?? 0, total: meta?.canonical_total ?? 0,
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
