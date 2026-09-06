import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { LocalDatabase } from '../database.mjs'

const { outputFiles } = await build({
  stdin: { contents: "export * from './src/sync.ts'; export {periodTimeMs} from './src/period.ts'; export {atlasApi} from './src/atlas-api.ts'", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
})
const { syncSource, syncStatus, dataVersion, notifyDrawChange, onInvalidate, periodTimeMs, atlasApi } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'))
const SOURCE = 'qkltj:6001'
const database = () => new LocalDatabase(':memory:', resolve('migrations'))
const payload = (n = 1, source = SOURCE, overrides = {}) => {
  const expect = '20260906' + String(n).padStart(source === 'qkltj:6001' || source === 'qkltj:7001' ? 4 : 3, '0')
  return { expect, hash: 'abcdef12345', block: 12345 + n, opennumber: '1,2,3,4,5', openTime: new Date(periodTimeMs(expect, source) + 15_000 + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' '), id: n, ...overrides }
}
const reply = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'content-type': 'application/json' } })
const count = async db => (await db.prepare('SELECT COUNT(*) n FROM draws').first()).n
const allowRetry = db => db.prepare('UPDATE sync_meta SET last_sync_ms=?,next_due_ms=0').bind(Date.now() - 5000).run()
const usingFetch = async (fn, body) => { const original = globalThis.fetch; globalThis.fetch = fn; try { await body() } finally { globalThis.fetch = original } }

test('all five canonical sources synchronize into the same draws read by original and atlas views', async () => {
  const db = database()
  try {
    await usingFetch(async url => reply([payload(1, 'qkltj:' + new URL(url).searchParams.get('code'))]), async () => {
      for (const source of ['qkltj:6001','qkltj:6002','qkltj:6003','qkltj:6004','qkltj:7001']) {
        const result = await syncSource(db, source, true)
        assert.equal(result.inserted, 1); assert.equal(result.error, undefined)
        const canonical = await db.prepare('SELECT * FROM draws WHERE source=?').bind(source).first()
        const snapshot = await (await atlasApi.request('/snapshot?source=' + encodeURIComponent(source), {}, { DB: db })).json()
        assert.equal(snapshot.records.length, 1)
        assert.equal(snapshot.records[0].period, canonical.expect)
        assert.deepEqual(snapshot.records[0].numbers, [canonical.n1,canonical.n2,canonical.n3,canonical.n4,canonical.n5])
        const status = await syncStatus(db, source)
        assert.equal(status.total, 1); assert.equal(status.latest_expect, canonical.expect)
      }
      assert.equal((await db.prepare('SELECT COUNT(*) n FROM atlas_records').first()).n, 0)
    })
  } finally { db.close() }
})

test('concurrent heartbeat and forced requests share one fetch so late responses cannot overwrite newer data', async () => {
  const db = database(); let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  let jobs = []
  try {
    await usingFetch(async () => { calls++; await gate; return reply([payload()]) }, async () => {
      jobs = [syncSource(db, SOURCE), syncSource(db, SOURCE, true), syncSource(db, SOURCE)]
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls, 1)
      release(); const results = await Promise.all(jobs)
      assert.deepEqual(results[0], results[1]); assert.equal(await count(db), 1)
    })
  } finally { release(); await Promise.allSettled(jobs); db.close() }
})

test('same source in two independent databases does not share a synchronization job', async () => {
  const one = database(), two = database(); let calls = 0
  try {
    await usingFetch(async () => { calls++; return reply([payload()]) }, async () => {
      await Promise.all([syncSource(one, SOURCE),syncSource(two, SOURCE)])
      assert.equal(calls, 2); assert.equal(await count(one), 1); assert.equal(await count(two), 1)
    })
  } finally { one.close(); two.close() }
})

test('audit corrects numeric fields and chain provenance even when original official strings are unchanged', async () => {
  const db = database()
  try {
    await usingFetch(async () => reply([payload()]), async () => {
      await syncSource(db, SOURCE, true)
      db.native.prepare("UPDATE draws SET n1=9,open_ms=1,mismatch=1,src='chain'").run()
      await allowRetry(db)
      const before = dataVersion(SOURCE), result = await syncSource(db, SOURCE, true)
      assert.equal(result.updated, 1)
      const row = await db.prepare('SELECT * FROM draws').first()
      assert.equal(row.n1, 1); assert.equal(row.mismatch, 0); assert.equal(row.src, 'qkltj')
      assert.equal(row.open_ms, periodTimeMs(row.expect, SOURCE) + 15_000)
      assert.equal(dataVersion(SOURCE), before + 1)
      assert.ok(result.diffs.some(d => d.field === 'n1'))
      await allowRetry(db); const unchanged = await syncSource(db, SOURCE, true)
      assert.equal(unchanged.unchanged, 1); assert.equal(dataVersion(SOURCE), before + 1)
    })
  } finally { db.close() }
})

test('failure after the hundredth incoming row rolls back every draw and leaves no half batch', async () => {
  const db = database(), before = dataVersion(SOURCE)
  db.native.exec("CREATE TRIGGER injected_sync_row_failure BEFORE INSERT ON draws WHEN NEW.expect='202609060101' BEGIN SELECT RAISE(ABORT,'injected row failure'); END")
  try {
    await usingFetch(async () => reply(Array.from({ length: 101 }, (_, i) => payload(i + 1))), async () => {
      const result = await syncSource(db, SOURCE, true)
      assert.match(result.error, /injected row failure/)
      assert.equal(await count(db), 0); assert.equal(dataVersion(SOURCE), before)
      const meta = await db.prepare('SELECT * FROM sync_meta').first()
      assert.equal(meta.total, 0); assert.equal(meta.last_ok_ms, 0); assert.equal(meta.fail_streak, 1)
    })
  } finally { db.close() }
})

test('metadata failure rolls back the otherwise valid draw upsert in the same transaction', async () => {
  const db = database(), before = dataVersion(SOURCE)
  db.native.exec("CREATE TRIGGER injected_sync_meta_failure BEFORE UPDATE ON sync_meta WHEN NEW.last_ok_ms>OLD.last_ok_ms BEGIN SELECT RAISE(ABORT,'injected metadata failure'); END")
  try {
    await usingFetch(async () => reply([payload()]), async () => {
      const result = await syncSource(db, SOURCE, true)
      assert.match(result.error, /injected metadata failure/)
      assert.equal(await count(db), 0); assert.equal(dataVersion(SOURCE), before)
      assert.equal((await db.prepare('SELECT last_ok_ms FROM sync_meta').first()).last_ok_ms, 0)
    })
  } finally { db.close() }
})

test('force honors minimum interval and exponential failure backoff while preserving existing draws', async () => {
  const db = database(); let calls = 0, remote = [payload()]
  try {
    await usingFetch(async () => { calls++; return reply(remote) }, async () => {
      await syncSource(db, SOURCE, true)
      assert.equal((await syncSource(db, SOURCE, true)).reason, 'throttled'); assert.equal(calls, 1)
      await allowRetry(db); remote = []
      const first = await syncSource(db, SOURCE, true)
      assert.match(first.error, /no records/); assert.equal(await count(db), 1)
      assert.equal((await syncSource(db, SOURCE, true)).reason, 'failure backoff'); assert.equal(calls, 2)
      const m1 = await db.prepare('SELECT * FROM sync_meta').first()
      assert.ok(m1.next_due_ms - m1.last_fail_ms >= 4000)
      await allowRetry(db); remote = [payload(2, SOURCE, { opennumber: '1,2,,4,5' })]
      const second = await syncSource(db, SOURCE, true)
      assert.match(second.error, /no valid records/); assert.equal(await count(db), 1)
      const m2 = await db.prepare('SELECT * FROM sync_meta').first()
      assert.equal(m2.fail_streak, 2); assert.ok(m2.next_due_ms - m2.last_fail_ms >= 8000)
      assert.equal(m2.last_ok_ms, m1.last_ok_ms)
    })
  } finally { db.close() }
})

test('invalid supplied official values are rejected while absent official values may use the actual hash digits', async () => {
  const db = database()
  try {
    await usingFetch(async () => reply([payload(1, SOURCE, { opennumber: '1,2,3,4,99' }),payload(2, SOURCE, { opennumber: null })]), async () => {
      const result = await syncSource(db, SOURCE, true)
      assert.equal(result.inserted, 1); assert.equal(await count(db), 1)
      const row = await db.prepare('SELECT * FROM draws').first()
      assert.equal(row.expect, payload(2).expect); assert.equal(row.opennumber, null)
      assert.deepEqual([row.n1,row.n2,row.n3,row.n4,row.n5], [1,2,3,4,5])
    })
  } finally { db.close() }
})

test('status derives totals and latest period from canonical draws after an independent gap fill', async () => {
  const db = database(), row = payload()
  try {
    await db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms,src) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(SOURCE,row.expect,row.hash,1,2,3,4,5,periodTimeMs(row.expect,SOURCE),'chain').run()
    const status = await syncStatus(db, SOURCE)
    assert.equal(status.total, 1); assert.equal(status.latest_expect, row.expect)
    assert.equal(status.latest_open_ms, periodTimeMs(row.expect,SOURCE)); assert.equal(status.last_ok_ms, null)
  } finally { db.close() }
})


test('successful independent draw changes invalidate the shared source version and registered old-page caches', async () => {
  const db = database(), notifications = [], before = dataVersion(SOURCE), row = payload()
  onInvalidate(source => notifications.push(source))
  try {
    await db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms,src) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(SOURCE,row.expect,row.hash,1,2,3,4,5,periodTimeMs(row.expect,SOURCE),'chain').run()
    notifyDrawChange(SOURCE)
    assert.equal(dataVersion(SOURCE), before + 1)
    assert.deepEqual(notifications, [SOURCE])
    assert.equal((await syncStatus(db,SOURCE)).total, 1)
  } finally { onInvalidate(() => {}); db.close() }
})
