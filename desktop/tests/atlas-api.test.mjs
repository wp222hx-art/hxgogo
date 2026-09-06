import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LocalDatabase } from '../database.mjs'

mkdirSync('output/tests', { recursive: true })
const run = mkdtempSync(resolve('output/tests/atlas-api-'))
const modulePath = join(run, 'atlas-api.mjs')
await build({
  stdin: { contents: "export * from './src/atlas-api.ts'; export {periodTimeMs} from './src/period.ts'", resolveDir: process.cwd() },
  outfile: modulePath, bundle: true, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent',
})
const { atlasApi, periodTimeMs } = await import(pathToFileURL(modulePath))
const database = (path = ':memory:') => new LocalDatabase(path, resolve('migrations'))
const request = async (db, method, path, body) => {
  const response = await atlasApi.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: db })
  return { status: response.status, body: await response.json() }
}
const row = (period = '20260906001', numbers = [0, 1, 2], drawAt = '2026-09-06T18:00:00+08:00') => ({ period, numbers, drawAt })
const stored = async db => (await db.prepare('SELECT COUNT(*) n FROM atlas_records').first()).n
const insertDraw = async (db, source, period, nums = [0, 1, 2, 3, 4], time = periodTimeMs(period, source)) =>
  db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(source, period, 'public-test-marker', ...nums, time).run()

test('catalog has five real sources and isolated local schemas without invented upstream APIs', async () => {
  const db = database()
  try {
    const catalog = await request(db, 'GET', '/catalog')
    assert.equal(catalog.status, 200)
    assert.equal(catalog.body.contractVersion, 'atlas.v1')
    assert.equal(catalog.body.sources.length, 9)
    assert.equal(catalog.body.sources.filter(s => s.kind === 'builtin').length, 5)
    assert.deepEqual(catalog.body.sources.filter(s => s.kind === 'local').map(s => s.id), ['local:digits3','local:eleven5','local:dlt','local:football'])
    const eleven = catalog.body.sources.find(s => s.id === 'local:eleven5')
    assert.equal(eleven.rule.ordered, false)
    assert.equal(eleven.rule.replacement, false)
    assert.equal(eleven.rule.positionSemantics, 'ascending')
    const dlt = catalog.body.sources.find(s => s.id === 'local:dlt')
    assert.deepEqual([dlt.rule.zones.front.max, dlt.rule.zones.front.count, dlt.rule.zones.back.max, dlt.rule.zones.back.count], [35,5,12,2])
    for (const source of catalog.body.sources.filter(s => s.kind === 'local')) {
      const snapshot = await request(db, 'GET', '/snapshot?source=' + source.id)
      assert.equal(snapshot.status, 200)
      assert.equal(snapshot.body.quality.state, 'empty')
      assert.deepEqual(snapshot.body.records, [])
      assert.deepEqual(snapshot.body.events, [])
    }
    assert.equal((await request(db, 'GET', '/snapshot?source=local:five')).status, 404)
    assert.equal((await request(db, 'GET', '/snapshot?source=__proto__')).status, 404)
    assert.equal((await request(db, 'GET', '/snapshot?limit=NaN')).status, 400)
    assert.equal((await request(db, 'GET', '/snapshot?limit=3001')).status, 400)
  } finally { db.close() }
})

test('built-in snapshots read shared draws without syncing, AI calls, or writes and preserve actual continuity', async () => {
  const db = database(), oldFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => { fetches++; throw new Error('Network forbidden in atlas reads') }
  try {
    const source = 'qkltj:6002'
    await insertDraw(db, source, '20260905480')
    await insertDraw(db, source, '20260906001', [4,3,2,1,0])
    await insertDraw(db, source, '20260906003')
    await insertDraw(db, source, '20260906004', [99,1,2,3,4])
    const changesBefore = (await db.prepare('SELECT total_changes() n').first()).n
    const result = await request(db, 'GET', '/snapshot?source=' + source + '&limit=20')
    assert.equal(result.status, 200)
    assert.deepEqual(result.body.records.map(r => r.period), ['20260905480','20260906001','20260906003'])
    assert.deepEqual(result.body.records.map(r => r.previousContiguous), [null,true,false])
    assert.deepEqual(result.body.records[1].numbers, [4,3,2,1,0])
    assert.ok(result.body.records.every(r => r.observedAt === null))
    assert.equal(result.body.quality.rejectedRows, 1)
    assert.equal(result.body.quality.missingPeriods, 1)
    assert.equal(result.body.nextPeriod.period, '20260906004')
    assert.equal((await db.prepare('SELECT total_changes() n').first()).n, changesBefore)
    assert.equal(fetches, 0)
    const blocked = await request(db, 'POST', '/import', { sourceId: source, records: [row()] })
    assert.equal(blocked.status, 403)
    assert.equal(await stored(db), 0)
  } finally { globalThis.fetch = oldFetch; db.close() }
})

test('number imports preserve digit order, mark true observed time, and never write legacy tables', async () => {
  const db = database()
  try {
    const before = Date.now()
    const result = await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [
      { ...row('second', [0,0,9], '2026-09-06T18:03:00+08:00'), observedAt: 1 },
      row('first', [9,0,1], '2026-09-06T18:00:00+08:00'),
    ] })
    assert.equal(result.status, 201)
    assert.equal(result.body.imported, 2)
    const snapshot = (await request(db, 'GET', '/snapshot?source=local:digits3')).body
    assert.deepEqual(snapshot.records.map(r => r.period), ['first','second'])
    assert.deepEqual(snapshot.records[1].numbers, [0,0,9])
    assert.ok(snapshot.records.every(r => r.observedAt >= before && r.observedAt <= Date.now()))
    assert.ok(snapshot.records.every(r => r.previousContiguous === null))
    assert.equal(snapshot.quality.missingPeriods, null)
    assert.equal(snapshot.nextPeriod, null)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM draws').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM arena_rounds').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM ai_forecasts').first()).n, 0)
  } finally { db.close() }
})

test('strict validation rejects bad quantities, domains, periods, dates and duplicate records atomically', async () => {
  const db = database()
  try {
    const invalidRows = [
      row('bad', [0,1]), row('bad', [0,1,10]), row('bad', [0,1,1.5]), row('bad', [0,1,'2']),
      row(''), row('contains space'), row('x'.repeat(65)), row('x\ny'),
      row('bad', [0,1,2], '2026-02-30T12:00:00+08:00'),
      row('bad', [0,1,2], '2026-02-29T12:00:00Z'),
      row('bad', [0,1,2], '2026-09-06T24:00:00Z'),
      row('bad', [0,1,2], '2026-09-06 18:00:00'),
      row('bad', [0,1,2], null),
    ]
    for (const invalid of invalidRows) {
      const response = await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [row('valid'), invalid] })
      assert.equal(response.status, 400, JSON.stringify(invalid))
      assert.equal(await stored(db), 0)
    }
    assert.equal((await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [row('same'),row('same')] })).status, 409)
    assert.equal(await stored(db), 0)
    assert.equal((await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [row('existing')] })).status, 201)
    const duplicate = await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [row('before'),row('existing'),row('after')] })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.code, 'DUPLICATE_RECORD')
    assert.equal(await stored(db), 1)
  } finally { db.close() }
})

test('SQL import failure leaves no partial inserts and the full 3000-record limit is supported', async () => {
  const db = database()
  try {
    db.native.exec("CREATE TRIGGER atlas_test_stop BEFORE INSERT ON atlas_records WHEN NEW.record_key='stop' BEGIN SELECT RAISE(ABORT,'test stop'); END;")
    const failed = await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [row('before'),row('stop'),row('after')] })
    assert.equal(failed.status, 500)
    assert.equal(await stored(db), 0)
    const rows = Array.from({length:3000}, (_,i) => row('p' + i))
    assert.equal((await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: [...rows,row('too-many')] })).status, 400)
    const accepted = await request(db, 'POST', '/import', { sourceId: 'local:digits3', records: rows })
    assert.equal(accepted.status, 201)
    assert.equal(accepted.body.imported, 3000)
    assert.equal(await stored(db), 3000)
  } finally { db.close() }
})

test('11x5 preserves original draw order and DLT validates each zone independently', async () => {
  const db = database()
  try {
    const eleven = [11,2,9,1,5]
    assert.equal((await request(db, 'POST', '/import', { sourceId:'local:eleven5', records:[row('one',eleven)] })).status, 201)
    assert.deepEqual((await request(db, 'GET', '/snapshot?source=local:eleven5')).body.records[0].numbers, eleven)
    for (const values of [[1,1,2,3,4], [0,1,2,3,4], [1,2,3,4,12]]) {
      assert.equal((await request(db, 'POST', '/import', { sourceId:'local:eleven5', records:[row('bad',values)] })).status, 400)
    }
    const dlt = { period:'26001', drawAt:'2026-01-03T21:00:00+08:00', zones:{ front:[35,1,8,19,25], back:[1,12] } }
    assert.equal((await request(db, 'POST', '/import', { sourceId:'local:dlt', records:[dlt] })).status, 201)
    const output = (await request(db, 'GET', '/snapshot?source=local:dlt')).body.records[0]
    assert.deepEqual(output.zones, dlt.zones)
    assert.equal('numbers' in output, false)
    for (const wrong of [
      {...dlt,period:'bad',zones:{front:[1,2,3,4,5],back:[12,13]}},
      {...dlt,period:'bad',zones:{front:[1,2,3,4,5],back:[2,2]}},
      {...dlt,period:'bad',zones:{front:[1,2,3,4,4],back:[2,3]}},
      {...dlt,period:'bad',numbers:[1,2,3,4,5,6,7]},
    ]) assert.equal((await request(db, 'POST', '/import', { sourceId:'local:dlt', records:[wrong] })).status, 400)
  } finally { db.close() }
})

test('football keeps events separate from number records and supports genuinely unknown fields', async () => {
  const db = database()
  try {
    const match = { matchId:'match-01',kickoff:null,home:'甲队',away:'乙队',status:'scheduled',homeScore:null,awayScore:null }
    assert.equal((await request(db, 'POST', '/import', { sourceId:'local:football',records:[match] })).status, 201)
    const snapshot = (await request(db, 'GET', '/snapshot?source=local:football')).body
    assert.deepEqual(snapshot.records, [])
    assert.equal(snapshot.events.length, 1)
    assert.equal(snapshot.events[0].kickoff, null)
    assert.equal(snapshot.events[0].homeScore, null)
    assert.equal('numbers' in snapshot.events[0], false)
    assert.equal((await request(db, 'POST', '/import', { sourceId:'local:football',records:[match] })).status, 409)
    for (const wrong of [
      {...match,matchId:'bad',numbers:[1,2,3]},
      {...match,matchId:'bad',status:'invented'},
      {...match,matchId:'bad',homeScore:-1},
      {...match,matchId:'bad',kickoff:'2026-02-30T00:00:00Z'},
      {...match,matchId:'bad',home:''},
    ]) assert.equal((await request(db, 'POST', '/import', { sourceId:'local:football',records:[wrong] })).status, 400)
  } finally { db.close() }
})

test('workspace is isolated, bounded, resistant to unsafe object keys and persists across restart', async () => {
  const file = join(run, 'workspace.sqlite')
  let db = database(file)
  try {
    assert.deepEqual((await request(db,'GET','/workspace')).body.workspace, {presets:[],monitors:[],preferences:{}})
    const workspace = { presets:[{id:'sum',source:'local:digits3',view:'sum'}],monitors:[{id:'m1',enabled:false}],preferences:{theme:'dark',limit:300} }
    const updated = await request(db,'PUT','/workspace',{workspace})
    assert.equal(updated.status,200)
    assert.deepEqual(updated.body.workspace,workspace)
    const config = await db.prepare('SELECT * FROM app_config').all()
    assert.equal(config.results.length,1)
    assert.equal(config.results[0].key,'AI_PROVIDER')
    assert.equal((await request(db,'PUT','/workspace',{presets:[],monitors:[],preferences:{large:'x'.repeat(270000)}})).status,413)
    assert.equal((await request(db,'PUT','/workspace',{presets:[],monitors:[],preferences:JSON.parse('{"__proto__":{"polluted":true}}')})).status,400)
    assert.equal((await request(db,'PUT','/workspace',{presets:[],monitors:[],preferences:{},unexpected:1})).status,400)
    assert.deepEqual((await request(db,'GET','/workspace')).body.workspace,workspace)
    db.close(); db=database(file)
    assert.deepEqual((await request(db,'GET','/workspace')).body.workspace,workspace)
    const malformed = await atlasApi.request('/import',{method:'POST',body:'{invalid'},{DB:db})
    assert.equal(malformed.status,400)
  } finally { db.close() }
})
