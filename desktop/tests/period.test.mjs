import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { LocalDatabase } from '../database.mjs'

async function moduleFrom(path) {
  const { outputFiles } = await build({ entryPoints: [resolve(path)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24' })
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
}
const period = await moduleFrom('src/period.ts')
const { nextPeriod, periodTimeMs, periodAtTimeMs, sourceIntervalMs, sourcePeriodsPerDay, normalizePeriodQuery } = period
const gaps = await moduleFrom('src/gapfill.ts')
const sync = await moduleFrom('src/sync.ts')
const calendars = [
  ['qkltj:6001', 60_000, 1440, 4],
  ['qkltj:6002', 180_000, 480, 3],
  ['qkltj:6003', 300_000, 288, 3],
  ['qkltj:6004', 600_000, 144, 3],
  ['qkltj:7001', 60_000, 1440, 4],
  ['local:five', 60_000, 1440, 4],
]
const full = (day, seq, width) => day + String(seq).padStart(width, '0')

test('all source calendars agree with synchronization and public observed samples', () => {
  for (const [source, interval, count, width] of calendars) {
    assert.equal(sourceIntervalMs(source), interval)
    assert.equal(sync.SOURCES[source].intervalMs, interval)
    assert.equal(sourcePeriodsPerDay(source), count)
    const start = Date.parse('2026-09-06T00:00:00+08:00')
    for (const seq of [1, 2, count - 1, count]) {
      const expect = full('20260906', seq, width)
      assert.equal(periodTimeMs(expect, source), start + seq * interval)
      assert.equal(periodAtTimeMs(start + seq * interval, source), expect)
      assert.equal(periodAtTimeMs(start + seq * interval + 14_000, source), expect)
    }
    assert.equal(nextPeriod(full('20260906', count, width), source), full('20260907', 1, width))
  }
  for (const [source, expect, ended] of [
    ['qkltj:6001', '202609061085', '2026-09-06T18:05:00+08:00'],
    ['qkltj:6002', '20260906361', '2026-09-06T18:03:00+08:00'],
    ['qkltj:6003', '20260906217', '2026-09-06T18:05:00+08:00'],
    ['qkltj:6004', '20260906108', '2026-09-06T18:00:00+08:00'],
    ['qkltj:7001', '202609061085', '2026-09-06T18:05:00+08:00'],
  ]) assert.equal(periodTimeMs(expect, source), Date.parse(ended))
})

test('rollovers honor month lengths, leap years, midnight and source cycle length', () => {
  for (const [source, interval, count, width] of calendars) {
    for (const [day, nextDay] of [['20260930','20261001'], ['20261231','20270101'], ['20240228','20240229'], ['20240229','20240301'], ['20260228','20260301'], ['21000228','21000301']]) {
      const last = full(day, count, width), next = full(nextDay, 1, width)
      assert.equal(nextPeriod(last, source), next)
      assert.equal(periodTimeMs(next, source) - periodTimeMs(last, source), interval)
      assert.equal(periodAtTimeMs(periodTimeMs(last, source), source), last)
    }
    assert.equal(periodAtTimeMs(Date.parse('2026-09-07T00:00:14+08:00'), source), full('20260906', count, width))
  }
  assert.equal(nextPeriod('999912311440', 'qkltj:6001'), null)
})

test('strict validation rejects impossible dates, sequence zero, overflow and wrong source width', () => {
  for (const [source, , count, width] of calendars) {
    for (const day of ['20260229','20260230','20261301','20260001','20260900','00000906']) {
      assert.equal(periodTimeMs(full(day, 1, width), source), null)
      assert.equal(nextPeriod(full(day, 1, width), source), null)
    }
    for (const seq of [0, count + 1]) assert.equal(periodTimeMs(full('20260906', seq, width), source), null)
    for (const input of ['', '1', full('20260906', 1, width) + '0', ' ' + full('20260906', 1, width), '20260906abcd']) {
      assert.equal(periodTimeMs(input, source), null)
    }
  }
  for (const source of ['unknown', '__proto__', 'constructor']) {
    assert.equal(sourceIntervalMs(source), null)
    assert.equal(sync.isSource(source), false)
    assert.equal(nextPeriod('202609061440', source), null)
    assert.equal(periodAtTimeMs(Date.now(), source), null)
    assert.equal(normalizePeriodQuery('1', source), null)
  }
  assert.equal(periodAtTimeMs(NaN, 'qkltj:6001'), null)
  assert.equal(periodAtTimeMs(Infinity, 'qkltj:6001'), null)
})

test('query normalization uses source width, explicit reference day and Shanghai today', () => {
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '')
  for (const [source, , count, width] of calendars) {
    assert.equal(normalizePeriodQuery('1', source, '20240229'), full('20240229', 1, width))
    assert.equal(normalizePeriodQuery(' 2 ', source, full('20260906', count, width)), full('20260906', 2, width))
    assert.equal(normalizePeriodQuery('1', source), full(today, 1, width))
    assert.equal(normalizePeriodQuery(full('20260906', count, width), source, 'invalid'), full('20260906', count, width))
    assert.equal(normalizePeriodQuery('1', source, '20260229'), null)
    assert.equal(normalizePeriodQuery('0', source, '20260906'), null)
    assert.equal(normalizePeriodQuery(String(count + 1), source, '20260906'), null)
  }
  assert.equal(normalizePeriodQuery('0001', 'qkltj:6002', '20260906'), null)
  assert.equal(normalizePeriodQuery('20260906001', 'qkltj:6001'), null)
  assert.equal(normalizePeriodQuery('202609060001', 'qkltj:6002'), null)
})

test('gap scan finds only actual missing source periods across midnight and ignores invalid legacy periods', async () => {
  for (const [source, , count, width] of calendars) {
    const first = full('20260906', count - 1, width), missing = full('20260906', count, width), last = full('20260907', 1, width)
    const rows = [{ expect: last }, { expect: first }, { expect: full('20260906', 0, width) }]
    const db = { prepare() { return { bind() { return { async all() { return { results: rows } } } } } } }
    const result = await gaps.scanGaps(db, source)
    assert.deepEqual(result.missing, [missing])
    assert.equal(result.checked, 3)
    assert.equal(result.missing_total, 1)
    assert.equal(result.invalid_periods, 1)
    assert.equal(result.first, first)
    assert.equal(result.last, last)
    assert.equal(result.truncated, false)
  }
})

test('coverage reports entire missing days using the selected source calendar', async () => {
  const source = 'qkltj:6004'
  const rows = [{ expect: '20260905144', src: 'chain' }, { expect: '20260907001', src: 'api' }]
  const db = { prepare(sql) { return { bind() { return {
    async all() { return { results: sql.includes('gap_log') ? [] : rows } },
    async first() { return { n: 2, c: 1, f: rows[0].expect, l: rows[1].expect } },
  } } } } }
  const report = await gaps.coverageReport(db, source)
  assert.deepEqual(report.days, [
    { day: '20260905', n: 1, chain: 1, expected: 1, missing: 0, complete: true },
    { day: '20260906', n: 0, chain: 0, expected: 144, missing: 144, complete: false },
    { day: '20260907', n: 1, chain: 0, expected: 1, missing: 0, complete: true },
  ])
  assert.equal(report.missing_total, 144)
  assert.equal(report.missing.length, 50)
  assert.equal(report.interval_ms, 600_000)
})

test('upstream synchronization refuses malformed periods and invalid timestamps', async () => {
  const db = new LocalDatabase(':memory:', resolve('migrations'))
  const original = globalThis.fetch
  const base = { hash: 'a12345', opennumber: '1,2,3,4,5', block: 1, openTime: '2026-09-06 18:00:14' }
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: [
    { ...base, expect: '20260906360' },
    { ...base, expect: '20260906000' },
    { ...base, expect: '202609060360' },
    { ...base, expect: '20260229360' },
    { ...base, expect: '20260906361', openTime: 'invalid' },
  ] }), { headers: { 'Content-Type': 'application/json' } })
  try {
    const result = await sync.syncSource(db, 'qkltj:6002', true)
    assert.equal(result.error, undefined)
    assert.equal(result.inserted, 1)
    assert.equal(result.latest_expect, '20260906360')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM draws').first()).n, 1)
  } finally { globalThis.fetch = original; db.close() }
})
