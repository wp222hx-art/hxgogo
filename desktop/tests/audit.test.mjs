import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { LocalDatabase } from '../database.mjs'

mkdirSync('output/tests', { recursive: true })
const run = mkdtempSync(resolve('output/tests/audit-'))
const modulePath = join(run, 'audit-code.mjs')
await build({ stdin: { contents: "export * from './src/arena.ts'; export * from './src/top3.ts'; export * from './src/ai_sets.ts'; export * from './src/period.ts'", resolveDir: process.cwd() }, outfile: modulePath, bundle: true, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent' })
const api = await import(pathToFileURL(modulePath))
const source = 'qkltj:6001', based = '209901010001', target = '209901010002'
const nums = count => Array.from({ length: count }, (_, i) => i)
const round = (strategy, count = 500) => ({ strategy, numbers: nums(count), coverage: count / 1000, weight: 1 })
const database = () => new LocalDatabase(join(mkdtempSync(join(run, 'db-')), 'audit.sqlite'), resolve('migrations'))
const draw = async (db, expect = target, actual = '000') => db.prepare('INSERT INTO draws(source,expect,hash,n1,n2,n3,n4,n5,open_ms) VALUES(?,?,?,?,?,?,?,?,?)').bind(source, expect, 'synthetic-test-hash', ...actual.split('').map(Number), 0, 0, api.periodTimeMs(expect, source)).run()

test('actual coverage controls probability, costs and rolling arena scores', async () => {
  const summary = api.scoreSummary([{ hit: true, count: 100 }, { hit: false, count: 200 }])
  assert.equal(summary.staked, 300)
  assert.equal(summary.pnl, 650)
  assert.equal(summary.roi, 650 / 300)
  assert.equal(summary.expected, 0.3)
  assert.ok(Math.abs(summary.z - 1.4) < 1e-10)
  assert.ok(summary.rate_interval_95[0] < 0.5 && summary.rate_interval_95[1] > 0.5)
  const db = database()
  try {
    await api.insertRounds(db, source, target, based, 'live', [round('ai-100', 100)])
    await draw(db)
    await api.settleArena(db, source)
    const board = await api.arenaBoard(db, source, { mode: 'live' })
    const row = board.strategies.find(s => s.key === 'ai-100')
    assert.equal(row.roi, 8.5)
    assert.equal(row.ev_per_period, 850)
    assert.equal(row.rolling.z, 3)
    assert.equal(row.baseline, 0.1)
    assert.ok(!row.verdict.includes('显著优于'))
  } finally { db.close() }
})

test('live cutoff, known draws, legacy migration, immutable snapshots and corrected settlement', async () => {
  const db = database()
  try {
    const cutoff = api.periodTimeMs(target, source)
    assert.equal((await api.predictionAudit(db, source, target, based, 'live', cutoff - 1)).prediction_status, 'live')
    assert.equal((await api.predictionAudit(db, source, target, based, 'live', cutoff)).prediction_status, 'late')
    await api.insertRounds(db, source, target, based, 'live', [round('meta')])
    await db.prepare('INSERT INTO arena_rounds(source,expect,strategy,mode,based_on,numbers,count,coverage,weight,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(source, target, 'legacy', 'live', based, '000', 1, 0.001, 1, 1).run()
    assert.equal((await db.prepare("SELECT prediction_status FROM arena_rounds WHERE strategy='legacy'").first()).prediction_status, 'legacy')
    await assert.rejects(db.prepare("UPDATE arena_rounds SET numbers='999' WHERE strategy='meta'").run(), /immutable/)
    await assert.rejects(db.prepare("DELETE FROM arena_rounds WHERE strategy='meta'").run(), /immutable/)
    await draw(db)
    assert.equal((await api.predictionAudit(db, source, target, based, 'live', cutoff - 1)).prediction_status, 'late')
    await api.settleArena(db, source)
    assert.equal((await db.prepare("SELECT hit FROM arena_rounds WHERE strategy='meta'").first()).hit, 1)
    await db.prepare('UPDATE draws SET n1=9,n2=9,n3=9 WHERE source=? AND expect=?').bind(source, target).run()
    await api.settleArena(db, source)
    assert.equal((await db.prepare("SELECT hit FROM arena_rounds WHERE strategy='meta'").first()).hit, 0)
    assert.equal((await db.prepare(`SELECT COUNT(*) n FROM arena_rounds WHERE ${api.verifiedLiveSql()}`).first()).n, 1)
  } finally { db.close() }
})

test('Top3 is fixed-500 and backfill remains replay without modifying existing live picks', async () => {
  const db = database()
  try {
    assert.ok(!api.CANDIDATES.some(k => k.includes('sharp') || k === 'ai-100'))
    await api.insertRounds(db, source, target, based, 'live', [round('meta')])
    await draw(db)
    await api.settleArena(db, source)
    assert.equal(await api.top3Backfill(db, source), 1)
    const record = await db.prepare("SELECT * FROM arena_rounds WHERE strategy='top3'").first()
    assert.equal(record.mode, 'replay')
    assert.equal(record.prediction_status, 'replay')
    assert.equal(record.count, 500)
    assert.equal((await api.top3View(db, source)).record, null)
    await api.insertRounds(db, source, '209901010004', '209901010003', 'live', [round('top3')])
    const saved = await db.prepare("SELECT * FROM arena_rounds WHERE strategy='top3' AND expect='209901010004'").first()
    await api.insertRounds(db, source, '209901010004', '209901010003', 'replay', [{ ...round('top3'), numbers: nums(500).map(x => x + 500) }], '999')
    assert.deepEqual(await db.prepare("SELECT * FROM arena_rounds WHERE strategy='top3' AND expect='209901010004'").first(), saved)
  } finally { db.close() }
})

test('tier and group live statistics exclude replay and legacy rows', async () => {
  const db = database()
  try {
    await api.insertRounds(db, source, target, based, 'live', [round('ai'), round('ai-100', 100), round('ai-set-100-A', 100)])
    await api.insertRounds(db, source, target, based, 'replay', [round('ai-150', 150), round('ai-set-100-B', 100)], '000')
    await draw(db)
    await api.settleArena(db, source)
    const periods = await api.loadTierPeriods(db, source, api.tierDefs([]))
    assert.equal(periods.length, 1)
    assert.equal(periods[0].sub['ai-100'].hit, true)
    assert.equal(periods[0].sub['ai-150'], null)
    assert.equal(api.tierStat(periods, { key: 'ai-100', n: 100, custom: false }).roi, 8.5)
    const all = await api.loadTierPeriods(db, source, api.tierDefs([]), { mode: 'all' })
    assert.equal(all[0].sub['ai-150'].hit, true)
    const sets = await api.setsBoard(db, source, [100])
    assert.equal(sets.tiers[0].sets.find(s => s.id === 'A').all.n, 1)
    assert.equal(sets.tiers[0].sets.find(s => s.id === 'B').all.n, 0)
  } finally { db.close() }
})


test('migration preserves legacy snapshots without claiming verified provenance', async () => {
  const dir = mkdtempSync(join(run, 'upgrade-')), migrations = join(dir, 'old-migrations'), file = join(dir, 'old.sqlite')
  mkdirSync(migrations)
  for (const name of readdirSync(resolve('migrations')).filter(n => n.endsWith('.sql') && n < '0016')) copyFileSync(resolve('migrations', name), join(migrations, name))
  let db = new LocalDatabase(file, migrations)
  await db.prepare('INSERT INTO arena_rounds(source,expect,strategy,mode,based_on,numbers,count,coverage,weight,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(source, target, 'meta', 'live', based, '123 456', 2, 0.002, 1, 100).run()
  db.close()
  db = new LocalDatabase(file, resolve('migrations'))
  try {
    const row = await db.prepare('SELECT * FROM arena_rounds').first()
    assert.equal(row.numbers, '123 456')
    assert.equal(row.created_ms, 100)
    assert.equal(row.mode, 'live')
    assert.equal(row.prediction_status, 'legacy')
    assert.equal(row.prediction_version, 'legacy-unverified')
    assert.equal(row.cutoff_ms, null)
    assert.equal((await db.prepare(`SELECT COUNT(*) n FROM arena_rounds WHERE ${api.verifiedLiveSql()}`).first()).n, 0)
  } finally { db.close() }
})

test('independent tier backfill never deletes or replaces the original live prediction', async () => {
  const db = database(), expect = '209901010200', previous = '209901010199'
  try {
    await api.insertRounds(db, source, expect, previous, 'live', [round('ai'), { ...round('ai-100', 100), numbers: nums(100).map(x => x + 700) }])
    const saved = await db.prepare("SELECT * FROM arena_rounds WHERE strategy='ai-100'").first()
    await db.prepare('INSERT INTO ai_forecasts(source,expect,model,based_on,output,created_ms) VALUES(?,?,?,?,?,?)').bind(source, expect, 'synthetic-no-model-call', previous, JSON.stringify({ pos_weights: [0,1,2].map(() => Array(10).fill(50)), strategy_blend: {}, boost: [], avoid: [] }), Date.now()).run()
    await draw(db, expect)
    await api.settleArena(db, source)
    const settled = await db.prepare("SELECT * FROM arena_rounds WHERE strategy='ai-100'").first()
    const history = Array.from({ length: 121 }, (_, i) => ({ expect: '20990101' + String(200 - i).padStart(4, '0'), n1: i % 10, n2: (i * 3) % 10, n3: (i * 7) % 10, n4: 0, n5: 0, hash: '0'.repeat(59) + String(i).padStart(5, '0') }))
    assert.equal((await api.backfillIndependentTiers(db, source, history, [], 1)).done, 1)
    assert.deepEqual(await db.prepare("SELECT * FROM arena_rounds WHERE strategy='ai-100'").first(), settled)
    assert.equal(settled.numbers, saved.numbers)
    const rebuilt = await db.prepare("SELECT * FROM arena_rounds WHERE strategy='ai-sharp-100'").first()
    assert.equal(rebuilt.mode, 'replay')
    assert.equal(rebuilt.prediction_status, 'replay')
  } finally { db.close() }
})
