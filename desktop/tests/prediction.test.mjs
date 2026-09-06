import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundled = await build({
  stdin: { contents: [
    "export * from './src/analysis.ts'",
    "export { outcomesFromNumbers, computeOutcomes5 } from './src/engine5.ts'",
    "export * from './src/picker.ts'",
    "export * from './src/recommend.ts'",
    "export { normalize, aiScores, FORECAST_SYSTEM } from './src/ai.ts'",
  ].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
})
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const validDistribution = (p) => {
  assert.ok(p.length > 0)
  assert.ok(p.every(v => Number.isFinite(v) && v >= 0 && v <= 1))
  assert.ok(Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-10)
}
const draws = (n = 155) => Array.from({ length: n }, (_, i) => {
  const digits = String((i * 7919 + i * i * 47) % 100000).padStart(5, '0')
  return { source: 'qkltj:6001', expect: '20260906' + String(i + 1).padStart(4, '0'),
    hash: 'a'.repeat(59) + digits, block: null,
    n1: +digits[0], n2: +digits[1], n3: +digits[2], n4: +digits[3], n5: +digits[4],
    open_ms: Date.UTC(2026, 8, 5, 16) + (i + 1) * 60000 }
}).reverse()

test('normalization repairs invalid mass, handles overflow and uses a prior', () => {
  const repaired = mod.normalizeDistribution([-0.1, NaN, Infinity, 2])
  assert.deepEqual(repaired, [0, 0, 0, 1])
  validDistribution(mod.normalizeDistribution([Number.MAX_VALUE, Number.MAX_VALUE]))
  assert.ok(mod.normalizeDistribution([0, 0], [0.1, 0.9]).every((p, i) => Math.abs(p - [0.1, 0.9][i]) < 1e-12))
})

test('every mechanism emits valid probabilities on sparse, streak and nonuniform markets', () => {
  for (const k of [2, 4, 10]) for (const n of [0, 1, 4, 5, 60, 205]) {
    const prior = k === 4 ? [0.01, 0.048, 0.27, 0.672] : Array(k).fill(1 / k)
    const seq = Array.from({ length: n }, (_, i) => i < n - 6 ? i % k : k - 1)
    const ctx = { seq, k, prior, hours: Array(n + 1).fill(8), hashes: Array(n).fill('a'.repeat(59) + '12345'), prevSumBig: Array(n).fill(1) }
    for (const mechanism of mod.MECHANISMS) validDistribution(mechanism.predict(ctx))
  }
})

test('shape baseline uses the modal prior and recent results mean the latest thirty', () => {
  const market = mod.MARKETS.find(m => m.key === 'shape')
  const seq = Array(45).fill(0).concat(Array(45).fill(3))
  const series = { seq, hours: Array(90).fill(8), hashes: Array(90).fill('aaaa12345'), prevSumBig: Array(90).fill(1), expects: [], openMs: [] }
  const bt = mod.backtest(series, market, 60)
  assert.equal(bt.baseline, 0.672)
  const mechanism = mod.MECHANISMS[0]
  const expected = []
  for (let t = 60; t < 90; t++) {
    const p = mechanism.predict({ seq: seq.slice(0, t), k: 4, prior: [0.01, 0.048, 0.27, 0.672], hours: [], hashes: [], prevSumBig: [] })
    expected.push(Number(p.indexOf(Math.max(...p)) === seq[t]))
  }
  assert.deepEqual(bt.res[0].recent, expected.reverse())
  assert.equal(mod.backtest({ ...series, seq: [] }, market).steps, 0)
})

test('historical ensemble uses prefix timestamps rather than the current wall clock', () => {
  const market = mod.MARKETS.find(m => m.key === 'pos-digit-0'), series = mod.buildSeries(draws(), market)
  const weights = mod.backtest(series, market, 5).res
  const now = Date.now
  try {
    Date.now = () => Date.UTC(1999, 0, 1, 0)
    const first = mod.ensemble(series, market, weights)
    Date.now = () => Date.UTC(2035, 0, 1, 12)
    assert.deepEqual(mod.ensemble(series, market, weights), first)
  } finally { Date.now = now }
})

test('picker normalizes the full space and number scores do not change with N', () => {
  const history = draws()
  const small = mod.pick(history, { count: 20, steps: 4, btSteps: 0 })
  const full = mod.pick(history, { count: 1000, steps: 4, btSteps: 0 })
  const byNumber = new Map(full.numbers.map(n => [n.no, n]))
  validDistribution(full.numbers.map(n => n.score))
  assert.ok(Math.abs(full.coverage.p - 1) < 1e-10)
  for (const n of small.numbers) {
    assert.equal(n.score, byNumber.get(n.no).score)
    assert.equal(n.baseline_probability, 0.001)
    assert.equal(n.calibrated_probability, null)
  }
  assert.equal(small.coverage.calibrated, false)
  assert.equal(small.next_expect, '202609060156')
  assert.equal(mod.pick(history, { source: 'unknown', steps: 1, btSteps: 0 }).next_expect, null)
})

test('every replay prediction equals a fresh prediction on its historical prefix', () => {
  const history = draws()
  const replay = mod.pick(history, { count: 1000, steps: 4, btSteps: 3 })
  assert.equal(replay.backtest.weights_refit_each_step, true)
  assert.equal(replay.backtest.n, 3)
  for (const row of replay.backtest.recent) {
    const index = history.findIndex(d => d.expect === row.expect)
    const prefix = history.slice(index + 1)
    const fresh = mod.pick(prefix, { count: 1000, steps: 4, btSteps: 0 })
    assert.equal(row.based_on, prefix[0].expect)
    assert.equal(row.rank, fresh.numbers.find(n => n.no === row.actual).rank)
  }
  const changedFuture = history.map((d, i) => i === 0 ? { ...d, hash: 'f'.repeat(59) + '99999', n1: 9, n2: 9, n3: 9, n4: 9, n5: 9 } : d)
  const changed = mod.pick(changedFuture, { count: 1000, steps: 4, btSteps: 3 })
  assert.deepEqual(changed.backtest.recent.slice(0, 2), replay.backtest.recent.slice(0, 2))
})

test('AI accepts no signal, preserves zero self-confidence and rejects malformed numbers', () => {
  const noSignal = mod.normalize({ evidence_status: 'insufficient', confidence: 0, pos_weights: [[99]], boost: ['123'] })
  assert.equal(noSignal.confidence, 0)
  assert.equal(noSignal.self_reported_confidence, 0)
  assert.equal(noSignal.confidence_kind, 'self_reported_not_probability')
  assert.equal(noSignal.calibrated, false)
  assert.deepEqual(noSignal.boost, [])
  assert.ok(noSignal.pos_weights.every(row => row.every(v => v === 50)))
  validDistribution(mod.aiScores(noSignal, {}))
  assert.ok(mod.aiScores(noSignal, {}).every(p => Math.abs(p - 0.001) < 1e-12))
  const parsed = mod.normalize({ evidence_status: 'hypothesis', boost: ['bad', '', '1000', '12', 123, '007', '999', '007'], avoid: ['001x', '345'] })
  assert.deepEqual(parsed.boost, ['007', '999'])
  assert.deepEqual(parsed.avoid, ['345'])
  assert.equal(parsed.self_reported_confidence, null)
  assert.throws(() => mod.normalize(null), /JSON object/)
  assert.match(mod.FORECAST_SYSTEM, /相同权重完全合法/)
  assert.doesNotMatch(mod.FORECAST_SYSTEM, /不要全部相同|如果命中，说明哪部分假设成立/)
})

test('recommendation exposes uncalibrated scores and only theoretical expected returns', () => {
  const result = mod.recommend(draws(80), 4)
  assert.equal(result.calibrated, false)
  assert.equal(result.strategy.regime, 'unvalidated')
  assert.deepEqual(result.strategy.evTop, [])
  assert.deepEqual(result.strategy.focus, [])
  for (const play of result.plays) for (const group of play.groups) for (const candidate of group.candidates) {
    assert.equal(candidate.calibrated_probability, null)
    assert.equal(candidate.p, candidate.score)
    assert.equal(candidate.ev_kind, 'theoretical_baseline')
    assert.ok(candidate.ev <= 0)
    assert.equal(candidate.star, 1)
  }
  const dragon = result.plays.find(p => p.play === 'dragon').groups[0].candidates.find(c => c.key === 'dragon')
  assert.ok(Math.abs(dragon.ev - (0.45 * 1.95 + 0.1 - 1)) < 1e-12)
})


test('official digits override a conflicting hash throughout analysis and replay outcomes', () => {
  const official = { ...draws(1)[0], hash: 'a'.repeat(59) + '00000', n1: 9, n2: 8, n3: 7, n4: 6, n5: 5 }
  const outcome = mod.outcomesForDraw(official)
  assert.deepEqual(outcome.nums, [9, 8, 7, 6, 5])
  assert.equal(outcome.sum, 35)
  assert.equal(outcome.shape, 'straight')
  assert.equal(outcome.dragon, 'dragon')
  assert.equal(mod.computeOutcomes5(official.hash).sum, 0)
  const market = mod.MARKETS.find(m => m.key === 'pos-digit-0')
  assert.deepEqual(mod.buildSeries([official], market).seq, [9])
  const stat = mod.stats([official])
  assert.equal(stat.digitFreq[0][9], 1)
  assert.equal(stat.digitFreq[0][0], 0)
  assert.equal(stat.sumDist[35], 1)
  assert.equal(mod.recommend([official], 1).tieRate, 0)

  const history = draws(155).map(d => ({ ...d, hash: 'a'.repeat(59) + '00000' }))
  const replay = mod.pick(history, { count: 1000, steps: 4, btSteps: 3 })
  for (const row of replay.backtest.recent) {
    const draw = history.find(d => d.expect === row.expect)
    assert.equal(row.actual, String(draw.n1) + draw.n2 + draw.n3)
  }
})

test('hash fallback is only for missing official digits, never invalid supplied digits', () => {
  const legacy = { hash: 'a'.repeat(59) + '12345' }
  assert.deepEqual(mod.outcomesForDraw(legacy).nums, [1, 2, 3, 4, 5])
  assert.deepEqual(mod.outcomesForDraw({ ...legacy, n1: null, n2: 2 }).nums, [1, 2, 3, 4, 5])
  assert.equal(mod.outcomesForDraw({ ...legacy, n1: 10, n2: 2, n3: 3, n4: 4, n5: 5 }), null)
  assert.equal(mod.outcomesForDraw({ ...legacy, n1: NaN }), null)
  assert.equal(mod.outcomesFromNumbers([1, 2, 3, 4]), null)
  assert.equal(mod.outcomesFromNumbers(new Array(5)), null)
  assert.equal(mod.outcomesFromNumbers([1, 2, 3, 4, 5.5]), null)
  assert.deepEqual(mod.outcomesFromNumbers([0, 0, 0, 0, 0]).nums, [0, 0, 0, 0, 0])
})
