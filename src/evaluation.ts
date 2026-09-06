/** Descriptive evaluation only; never turn a selected historical score into a next-draw probability. */
export function wilsonInterval(hits: number, n: number) {
  if (!Number.isInteger(n) || n < 1 || hits < 0 || hits > n) return null
  const z = 1.959963984540054, p = hits / n, d = 1 + z * z / n
  const center = (p + z * z / (2 * n)) / d
  const span = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return { lo: Math.max(0, center - span), hi: Math.min(1, center + span) }
}
export function evaluationSummary(rows: { expect: string; count: number; hit: number | boolean; coverage?: number }[]) {
  const n = rows.length, hits = rows.reduce((s, r) => s + Number(!!r.hit), 0)
  const expected = rows.reduce((s, r) => s + r.count / 1000, 0)
  const variance = rows.reduce((s, r) => { const p = r.count / 1000; return s + p * (1 - p) }, 0)
  const distinct = new Set(rows.map(r => r.expect)).size
  const fixed = new Set(rows.map(r => r.count)).size <= 1 && distinct === n
  const valid = rows.filter(r => Number.isFinite(r.coverage) && r.coverage! >= 0 && r.coverage! <= 1)
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, sum: 0, hits: 0 }))
  let brier = 0, baseBrier = 0, loss = 0, baseLoss = 0
  const ll = (y: number, p: number) => -Math.log(Math.max(1e-15, y ? p : 1 - p))
  for (const r of valid) {
    const p = r.coverage!, y = Number(!!r.hit), p0 = r.count / 1000
    brier += (p - y) ** 2; baseBrier += (p0 - y) ** 2
    loss += ll(y, p); baseLoss += ll(y, p0)
    const bin = bins[Math.min(9, Math.floor(p * 10))]; bin.n++; bin.sum += p; bin.hits += y
  }
  return {
    n, hits, rate: n ? hits / n : null, baseline: n ? expected / n : null,
    expected_hits: expected, z: variance && fixed ? (hits - expected) / Math.sqrt(variance) : null,
    interval95: fixed ? wilsonInterval(hits, n) : null, interval_kind: 'fixed_strategy_descriptive_not_sequential',
    independent_periods: distinct, fixed_count: fixed, calibrated: false, evidence: 'insufficient_evidence',
    calibration: { n: valid.length, kind: 'uncalibrated_score_diagnostic',
      brier: valid.length ? brier / valid.length : null, baseline_brier: valid.length ? baseBrier / valid.length : null,
      log_loss: valid.length ? loss / valid.length : null, baseline_log_loss: valid.length ? baseLoss / valid.length : null,
      bins: bins.filter(b => b.n).map(b => ({ lo: b.lo, hi: b.hi, n: b.n, mean_score: b.sum / b.n, observed_rate: b.hits / b.n }))
    }
  }
}
