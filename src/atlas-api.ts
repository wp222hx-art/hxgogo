import { Hono } from 'hono'
import { SOURCES, syncSource } from './sync'
import { nextPeriod, periodTimeMs, sourceIntervalMs } from './period'

const CONTRACT = 'atlas.v1'
const MAX_RECORDS = 3000
const MAX_IMPORT_BYTES = 4 * 1024 * 1024
const MAX_WORKSPACE_BYTES = 256 * 1024
type Obj = Record<string, any>
type Source = { id: string; label: string; schemaId: string; kind: 'builtin' | 'local'; intervalMs: number | null; rule: Obj }

const numberRule = (min: number, max: number, count: number, ordered: boolean, replacement: boolean, positionSemantics: string) =>
  ({ min, max, count, ordered, replacement, positionSemantics })
const STATUSES = ['scheduled', 'live', 'finished', 'postponed', 'cancelled']
const SCHEMAS = [
  { id: 'digits5', label: '五位数字', kind: 'numbers', rule: numberRule(0, 9, 5, true, true, 'fixed') },
  { id: 'digits3', label: '三位数字', kind: 'numbers', rule: numberRule(0, 9, 3, true, true, 'fixed') },
  // The draw order stays in records. Unordered selections use ascending positions only when calculating.
  { id: 'eleven5', label: '11选5', kind: 'numbers', rule: numberRule(1, 11, 5, false, false, 'ascending') },
  { id: 'dlt', label: '大乐透', kind: 'zones', rule: { ordered: false, replacement: false, zones: {
    front: numberRule(1, 35, 5, false, false, 'ascending'),
    back: numberRule(1, 12, 2, false, false, 'ascending'),
  } } },
  { id: 'football', label: '足球赛事', kind: 'events', rule: { statuses: STATUSES, fields: ['matchId', 'kickoff', 'home', 'away', 'status', 'homeScore', 'awayScore'] } },
]
const schema = (id: string) => SCHEMAS.find(s => s.id === id)!
const SOURCE_LIST: Source[] = [
  ...['qkltj:6001', 'qkltj:6002', 'qkltj:6003', 'qkltj:6004', 'qkltj:7001'].map(id => ({
    id, label: SOURCES[id].name, schemaId: 'digits5', kind: 'builtin' as const, intervalMs: SOURCES[id].intervalMs, rule: schema('digits5').rule,
  })),
  ...[
    ['local:digits3', '三位数字 · 本地导入', 'digits3'],
    ['local:eleven5', '11选5 · 本地导入', 'eleven5'],
    ['local:dlt', '大乐透 · 本地导入', 'dlt'],
    ['local:football', '足球赛事 · 本地导入', 'football'],
  ].map(([id, label, schemaId]) => ({ id, label, schemaId, kind: 'local' as const, intervalMs: null, rule: schema(schemaId).rule })),
]
const getSource = (id: unknown) => typeof id === 'string' ? SOURCE_LIST.find(s => s.id === id) : undefined

class AtlasError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
const invalid = (message: string): never => { throw new AtlasError(400, 'INVALID_INPUT', message) }
const isObject = (value: any): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value)

/** Bound the actual streamed body, rather than trusting Content-Length. */
async function readJSON(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new AtlasError(413, 'BODY_TOO_LARGE', '提交内容超过大小限制')
  const reader = request.body?.getReader()
  if (!reader) invalid('请提交 JSON 内容')
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new AtlasError(413, 'BODY_TOO_LARGE', '提交内容超过大小限制')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const buffer = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(buffer)) }
  catch { return invalid('JSON 格式无效') }
}

function identifier(value: any, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) invalid(label + '须为 1–64 位字母、数字或 . _ : -')
  return value
}

/** Strict ISO dates with an explicit timezone, or epoch milliseconds. */
function timestamp(value: any, label: string, nullable = false): number | null {
  if (value == null && nullable) return null
  if (typeof value === 'number') {
    const date = new Date(value), year = date.getUTCFullYear()
    if (!Number.isSafeInteger(value) || !Number.isFinite(date.getTime()) || year < 1 || year > 9999) invalid(label + '不是合法毫秒时间戳')
    return value
  }
  if (typeof value !== 'string') return invalid(label + '须为毫秒时间戳或带时区的 ISO 日期')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return invalid(label + '须为带时区的 ISO 日期，例如 2026-09-06T18:00:00+08:00')
  const [, yy, mm, dd, hh, mi, ss = '0', , zone] = match
  const year = Number(yy), month = Number(mm), day = Number(dd)
  const check = new Date(0); check.setUTCHours(0, 0, 0, 0); check.setUTCFullYear(year, month - 1, day)
  if (year < 1 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
    Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59 ||
    (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) invalid(label + '包含不存在的日期或时间')
  const parsed = Date.parse(value), parsedYear = new Date(parsed).getUTCFullYear()
  if (!Number.isFinite(parsed) || parsedYear < 1 || parsedYear > 9999) invalid(label + '不是合法日期')
  return parsed
}

function numbers(value: any, rule: Obj, label: string): number[] {
  if (!Array.isArray(value) || value.length !== rule.count) invalid(label + '必须包含 ' + rule.count + ' 个数字')
  if (value.some(n => !Number.isInteger(n) || n < rule.min || n > rule.max)) invalid(label + '每个数字须为 ' + rule.min + '–' + rule.max + ' 的整数')
  if (!rule.replacement && new Set(value).size !== value.length) invalid(label + '不能有重复数字')
  return [...value]
}
function team(value: any, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) invalid(label + '须为 1–120 字符的名称')
  return value.trim()
}
function score(value: any, label: string): number | null {
  if (value == null) return null
  if (!Number.isInteger(value) || value < 0 || value > 999) invalid(label + '须为空或 0–999 的整数')
  return value
}

function normalizeRecord(source: Source, value: any, observedAt: number) {
  if (!isObject(value)) invalid('每条记录必须是 JSON 对象')
  if (source.schemaId === 'football') {
    if (value.numbers !== undefined || value.zones !== undefined) invalid('足球赛事使用 events 契约，不能填写号码或分区')
    const matchId = identifier(value.matchId, '赛事 ID')
    if (!STATUSES.includes(value.status)) invalid('赛事状态无效')
    const kickoff = timestamp(value.kickoff, '开赛时间', true)
    return { key: matchId, drawAt: kickoff, kind: 'event', record: {
      id: source.id + ':' + matchId, matchId, kickoff,
      home: team(value.home, '主队'), away: team(value.away, '客队'), status: value.status,
      homeScore: score(value.homeScore, '主队比分'), awayScore: score(value.awayScore, '客队比分'), observedAt,
    } }
  }
  const period = identifier(value.period, '期号')
  const drawAt = timestamp(value.drawAt, '开奖时间')!
  const common = { id: source.id + ':' + period, period, drawAt, observedAt, previousContiguous: null }
  if (source.schemaId === 'dlt') {
    if (value.numbers !== undefined || !isObject(value.zones) || Object.keys(value.zones).some(k => !['front', 'back'].includes(k))) invalid('大乐透须提供独立的 zones.front 与 zones.back')
    const zones = {
      front: numbers(value.zones.front, source.rule.zones.front, '前区'),
      back: numbers(value.zones.back, source.rule.zones.back, '后区'),
    }
    return { key: period, drawAt, kind: 'draw', record: { ...common, zones } }
  }
  if (value.zones !== undefined) invalid('该来源不接受分区号码')
  return { key: period, drawAt, kind: 'draw', record: { ...common, numbers: numbers(value.numbers, source.rule, '开奖号码') } }
}

const emptyWorkspace = () => ({ presets: [] as any[], monitors: [] as any[], preferences: {} as Obj })
function workspaceValue(value: any) {
  if (!isObject(value)) invalid('工作区必须是对象')
  if (Object.keys(value).some(k => !['presets', 'monitors', 'preferences'].includes(k))) invalid('工作区仅支持 presets、monitors、preferences')
  if (!Array.isArray(value.presets) || value.presets.length > 200 || value.presets.some((p: any) => !isObject(p))) invalid('presets 须为不超过 200 项的对象数组')
  if (!Array.isArray(value.monitors) || value.monitors.length > 200 || value.monitors.some((p: any) => !isObject(p))) invalid('monitors 须为不超过 200 项的对象数组')
  if (!isObject(value.preferences)) invalid('preferences 须为对象')
  let nodes = 0
  const visit = (item: any, depth: number) => {
    if (++nodes > 20_000 || depth > 12) invalid('工作区结构过于复杂')
    if (item == null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid('工作区包含无效数字'); return }
    if (Array.isArray(item)) { if (item.length > 2000) invalid('工作区数组过长'); for (const child of item) visit(child, depth + 1); return }
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('工作区包含不支持的属性')
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
  const json = JSON.stringify(value)
  if (new TextEncoder().encode(json).byteLength > MAX_WORKSPACE_BYTES) throw new AtlasError(413, 'BODY_TOO_LARGE', '工作区超过 256 KB')
  return json
}

export const atlasApi = new Hono<{ Bindings: { DB: D1Database } }>()
atlasApi.onError((error, c) => {
  if (error instanceof AtlasError) return c.json({ ok: false, contractVersion: CONTRACT, code: error.code, error: error.message }, error.status as any)
  return c.json({ ok: false, contractVersion: CONTRACT, code: 'ATLAS_STORAGE_ERROR', error: '图谱数据操作失败，请稍后重试' }, 500)
})

atlasApi.get('/catalog', c => c.json({
  ok: true, contractVersion: CONTRACT, sources: SOURCE_LIST, schemas: SCHEMAS,
  limits: { importRecords: MAX_RECORDS, importBytes: MAX_IMPORT_BYTES, snapshotRecords: MAX_RECORDS, workspaceBytes: MAX_WORKSPACE_BYTES },
}))

/** One SQLite statement fixes the read view for rows, count, durable revision and sync metadata.
 * No second draw dataset or in-memory version participates in the snapshot contract.
 */
async function sourceSnapshot(db: D1Database, source: Source, limit: number) {
  const builtin = source.kind === 'builtin'
  const table = builtin ? 'draws' : 'atlas_records', sourceColumn = builtin ? 'source' : 'source_id'
  const selected = builtin
    ? 'expect,n1,n2,n3,n4,n5,open_ms'
    : 'record_key,record_json,draw_at,observed_at'
  const ordering = builtin ? 'open_ms DESC,expect DESC' : 'COALESCE(draw_at,observed_at) DESC,record_key DESC'
  const jsonRow = builtin
    ? "json_object('expect',expect,'n1',n1,'n2',n2,'n3',n3,'n4',n4,'n5',n5,'open_ms',open_ms)"
    : "json_object('record_key',record_key,'record_json',record_json,'draw_at',draw_at,'observed_at',observed_at)"
  // All SQL identifiers are constants selected from the two supported storage contracts.
  const result = await db.prepare(
    'WITH selected AS (SELECT ' + selected + ' FROM ' + table + ' WHERE ' + sourceColumn + '=? ORDER BY ' + ordering + ' LIMIT ?) ' +
    'SELECT (SELECT json_group_array(' + jsonRow + ') FROM selected) rows_json,' +
    '(SELECT COUNT(*) FROM ' + table + ' WHERE ' + sourceColumn + '=?) total_stored,' +
    'COALESCE(r.revision,0) revision,r.updated_at revision_updated_at,' +
    'm.last_sync_ms,m.last_ok_ms,m.next_due_ms,m.last_error,m.fail_streak ' +
    'FROM (SELECT 1) LEFT JOIN atlas_source_revisions r ON r.source_id=? LEFT JOIN sync_meta m ON m.source=?'
  ).bind(source.id, limit, source.id, source.id, source.id).first<any>()
  const generatedAt = Date.now(), rows: any[] = JSON.parse(result?.rows_json || '[]')
  const totalStored = Number(result?.total_stored || 0)
  let records: any[] = [], events: any[] = [], rejectedRows = 0
  if (builtin) {
    for (const row of rows) {
      const values = [row.n1, row.n2, row.n3, row.n4, row.n5]
      if (periodTimeMs(row.expect, source.id) == null || values.some(n => !Number.isInteger(n) || n < 0 || n > 9) ||
        !Number.isSafeInteger(row.open_ms) || !Number.isFinite(new Date(row.open_ms).getTime())) { rejectedRows++; continue }
      records.push({ id: source.id + ':' + row.expect, period: row.expect, numbers: values, drawAt: row.open_ms, observedAt: null })
    }
    records.reverse()
    for (let i = 0; i < records.length; i++) records[i].previousContiguous = i === 0 ? null : periodTimeMs(records[i].period, source.id)! - periodTimeMs(records[i - 1].period, source.id)! === source.intervalMs
  } else {
    const items = [...rows].reverse().map(row => JSON.parse(row.record_json))
    if (source.schemaId === 'football') events = items
    else records = items
  }
  const intervalMs = builtin ? sourceIntervalMs(source.id) : null
  const last = records.at(-1), first = records[0]
  const latestPeriod = rows[0] ? (builtin ? rows[0].expect : rows[0].record_key) : null
  const latestDrawAt = rows[0] ? (builtin ? rows[0].open_ms : rows[0].draw_at) : null
  const freshness = !intervalMs || latestDrawAt == null ? 'unknown' : generatedAt - latestDrawAt > intervalMs * 2 + 15_000 ? 'stale' : 'fresh'
  const missingPeriods = intervalMs && first && last
    ? Math.max(0, Math.round((periodTimeMs(last.period, source.id)! - periodTimeMs(first.period, source.id)!) / intervalMs) + 1 - records.length) : null
  const next = builtin && last ? nextPeriod(last.period, source.id) : null
  const count = records.length + events.length
  return {
    ok: true, contractVersion: CONTRACT, source, generatedAt,
    revision: source.id + ':' + String(result?.revision || 0), revisionUpdatedAt: result?.revision_updated_at ?? null,
    count: totalStored, latestPeriod, latestDrawAt, readOnly: true, storage: builtin ? 'canonical-draws' : 'atlas-records',
    order: 'ascending', records, events,
    nextPeriod: next ? { period: next, drawAt: periodTimeMs(next, source.id) } : null,
    sync: {
      supported: builtin, lastAttemptAt: result?.last_sync_ms || null, lastSuccessAt: result?.last_ok_ms || null,
      nextDueAt: result?.next_due_ms || null, lastError: result?.last_error || null, failStreak: result?.fail_streak || 0, freshness,
    },
    quality: {
      state: count ? 'ready' : 'empty', sampleSize: count, totalStored, rejectedRows, missingPeriods, freshness,
      note: builtin ? '直接共享原始开奖库；记录、总数和版本来自同一数据库快照，读取不触发同步、策略或 AI' : '本地导入数据，尚未连接外部接口',
    },
  }
}

function requestedSource(id: unknown) {
  const source = getSource(id)
  if (!source) throw new AtlasError(404, 'UNKNOWN_SOURCE', '未找到该图谱来源')
  return source
}
async function sourceStatus(db: D1Database, source: Source) {
  const { records, events, order, ...status } = await sourceSnapshot(db, source, 1)
  return status
}

atlasApi.get('/snapshot', async c => {
  const source = requestedSource(c.req.query('source') || 'qkltj:6001')
  const limitText = c.req.query('limit') || '300'
  if (!/^[0-9]+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > MAX_RECORDS) invalid('limit 须为 1–3000 的整数')
  c.header('Cache-Control', 'no-store')
  return c.json(await sourceSnapshot(c.env.DB, source, Number(limitText)))
})

atlasApi.get('/status', async c => {
  const source = requestedSource(c.req.query('source') || 'qkltj:6001')
  c.header('Cache-Control', 'no-store')
  return c.json(await sourceStatus(c.env.DB, source))
})

atlasApi.post('/sync', async c => {
  const body = await readJSON(c.req.raw, 4096)
  if (!isObject(body) || Object.keys(body).some(key => !['sourceId', 'force'].includes(key))) invalid('请提交 sourceId 和可选的 force 布尔值')
  const source = requestedSource(body.sourceId)
  if (source.kind !== 'builtin') throw new AtlasError(403, 'NO_UPSTREAM_SOURCE', '该来源仅支持本地导入，没有可同步的外部接口')
  if (body.force !== undefined && typeof body.force !== 'boolean') invalid('force 须为布尔值')
  // The existing synchronization service owns throttling and concurrent request coalescing.
  // This route never invokes tracking, arena, AI or the old tick=1 path.
  const result = await syncSource(c.env.DB, source.id, body.force === true)
  const status = await sourceStatus(c.env.DB, source)
  c.header('Cache-Control', 'no-store')
  if (result.error) return c.json({ ok: false, contractVersion: CONTRACT, code: 'UPSTREAM_SYNC_FAILED', error: result.error, result, status }, 502)
  return c.json({ ok: true, contractVersion: CONTRACT, result, status })
})

atlasApi.post('/import', async c => {
  const body = await readJSON(c.req.raw, MAX_IMPORT_BYTES)
  if (!isObject(body)) invalid('请提交 sourceId 和 records')
  const source = getSource(body.sourceId)
  if (!source) throw new AtlasError(404, 'UNKNOWN_SOURCE', '未找到该图谱来源')
  if (source.kind !== 'local') throw new AtlasError(403, 'READ_ONLY_SOURCE', '共享官方来源为只读，不能导入或覆盖')
  if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > MAX_RECORDS) invalid('每批须包含 1–3000 条记录')
  const observedAt = Date.now(), seen = new Set<string>()
  const rows = body.records.map((record: any, index: number) => {
    let item: ReturnType<typeof normalizeRecord>
    try { item = normalizeRecord(source, record, observedAt) }
    catch (error) { if (error instanceof AtlasError) error.message = '第 ' + (index + 1) + ' 条：' + error.message; throw error }
    if (seen.has(item.key)) throw new AtlasError(409, 'DUPLICATE_RECORD', '本批包含重复期号或赛事 ID：' + item.key)
    seen.add(item.key)
    return { key: item.key, kind: item.kind, drawAt: item.drawAt, json: JSON.stringify(item.record) }
  })
  try {
    // One INSERT statement is atomic, also across a uniqueness conflict late in a 3000-row import.
    // Binding a JSON array avoids per-record parameter limits or partial multi-batch commits.
    await c.env.DB.prepare(`INSERT INTO atlas_records(source_id,record_key,schema_id,kind,record_json,draw_at,observed_at)
      SELECT ?,json_extract(value,'$.key'),?,json_extract(value,'$.kind'),json_extract(value,'$.json'),json_extract(value,'$.drawAt'),?
      FROM json_each(?)`).bind(source.id, source.schemaId, observedAt, JSON.stringify(rows)).run()
  } catch (error: any) {
    if (/UNIQUE constraint failed|duplicate/i.test(String(error?.message || error))) throw new AtlasError(409, 'DUPLICATE_RECORD', '已有相同期号或赛事 ID，本批未写入；不会覆盖原记录')
    throw error
  }
  return c.json({ ok: true, contractVersion: CONTRACT, sourceId: source.id, imported: rows.length, observedAt }, 201)
})

atlasApi.get('/workspace', async c => {
  const row = await c.env.DB.prepare("SELECT value_json,updated_at FROM atlas_workspace WHERE id='default'").first<any>()
  return c.json({ ok: true, contractVersion: CONTRACT, workspace: row ? JSON.parse(row.value_json) : emptyWorkspace(), updatedAt: row?.updated_at || null })
})

atlasApi.put('/workspace', async c => {
  const body = await readJSON(c.req.raw, MAX_WORKSPACE_BYTES)
  const value = isObject(body) && Object.prototype.hasOwnProperty.call(body, 'workspace') ? body.workspace : body
  const json = workspaceValue(value), updatedAt = Date.now()
  await c.env.DB.prepare("INSERT INTO atlas_workspace(id,value_json,updated_at) VALUES('default',?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
    .bind(json, updatedAt).run()
  return c.json({ ok: true, contractVersion: CONTRACT, workspace: JSON.parse(json), updatedAt })
})
