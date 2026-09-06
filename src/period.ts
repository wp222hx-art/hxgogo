// 上海日历期号：序号 1 对应当日第一个周期结束，末期对应次日 00:00。
const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * 3_600_000
const INTERVALS: Readonly<Record<string, number>> = Object.freeze({
  'qkltj:6001': 60_000,
  'qkltj:6002': 180_000,
  'qkltj:6003': 300_000,
  'qkltj:6004': 600_000,
  'qkltj:7001': 60_000,
  'local:five': 60_000,
})

export function sourceIntervalMs(source: string): number | null {
  return Object.prototype.hasOwnProperty.call(INTERVALS, source) ? INTERVALS[source] : null
}

export function sourcePeriodsPerDay(source: string): number | null {
  const interval = sourceIntervalMs(source)
  return interval == null ? null : DAY_MS / interval
}

function sequenceWidth(source: string): number | null {
  const count = sourcePeriodsPerDay(source)
  return count == null ? null : String(count).length
}

/** 严格检查公历日期，避免 Date 自动把 2 月 30 日滚到下月。 */
function dateStartMs(day: string): number | null {
  if (!/^\d{8}$/.test(day)) return null
  const year = Number(day.slice(0, 4)), month = Number(day.slice(4, 6)), date = Number(day.slice(6, 8))
  if (year < 1 || month < 1 || month > 12 || date < 1 || date > 31) return null
  const utc = new Date(0)
  utc.setUTCHours(0, 0, 0, 0)
  utc.setUTCFullYear(year, month - 1, date)
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== date) return null
  return utc.getTime() - SHANGHAI_OFFSET_MS
}

function formatDay(date: Date): string | null {
  const year = date.getUTCFullYear()
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null
  return `${String(year).padStart(4, '0')}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

/** 完整期号 → 周期结束整分的 UTC 毫秒；不接受短期号或不合来源宽度的期号。 */
export function periodTimeMs(expect: string, source: string): number | null {
  const interval = sourceIntervalMs(source), width = sequenceWidth(source)
  if (interval == null || width == null || typeof expect !== 'string' || expect.length !== 8 + width || !/^\d+$/.test(expect)) return null
  const start = dateStartMs(expect.slice(0, 8)), seq = Number(expect.slice(8))
  if (start == null || seq < 1 || seq > DAY_MS / interval) return null
  return start + seq * interval
}

/** 时间戳 → 最近一个已经到达的周期边界；00:00（及下期前）归前一日末期。 */
export function periodAtTimeMs(ms: number, source: string): string | null {
  const interval = sourceIntervalMs(source), width = sequenceWidth(source)
  if (interval == null || width == null || !Number.isFinite(ms)) return null
  const boundary = Math.floor((ms + SHANGHAI_OFFSET_MS) / interval) * interval
  const previous = new Date(boundary - interval)
  const day = formatDay(previous)
  if (day == null) return null
  const seq = Math.floor((previous.getUTCHours() * 3_600_000 + previous.getUTCMinutes() * 60_000) / interval) + 1
  return day + String(seq).padStart(width, '0')
}

export function nextPeriod(expect: string, source: string): string | null {
  const ms = periodTimeMs(expect, source), interval = sourceIntervalMs(source)
  return ms == null || interval == null ? null : periodAtTimeMs(ms + interval, source)
}

/**
 * 查询输入标准化。完整期号独立校验；短期号用 reference 所属日，
 * reference 可为 YYYYMMDD 或同来源完整期号，缺省用上海今天。
 */
export function normalizePeriodQuery(expect: string, source: string, reference?: string): string | null {
  const width = sequenceWidth(source)
  if (width == null || typeof expect !== 'string') return null
  const input = expect.trim()
  if (input.length === 8 + width) return periodTimeMs(input, source) == null ? null : input
  if (!/^\d+$/.test(input) || input.length > width) return null
  let day: string | null
  if (reference === undefined) day = formatDay(new Date(Date.now() + SHANGHAI_OFFSET_MS))
  else if (/^\d{8}$/.test(reference)) day = dateStartMs(reference) == null ? null : reference
  else day = periodTimeMs(reference, source) == null ? null : reference.slice(0, 8)
  if (day == null) return null
  const full = day + input.padStart(width, '0')
  return periodTimeMs(full, source) == null ? null : full
}
