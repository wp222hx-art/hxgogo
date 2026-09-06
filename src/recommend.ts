// ============ 排序研究：集成分数、理论基线与验证状态 ============
// 集成分数未经概率校准；不据此推断本期命中概率或正收益。
import { MARKETS, buildSeries, backtest, ensemble, outcomesForDraw, type Draw } from './analysis'
import { POS_NAMES } from './engine5'

export interface Candidate { key: string; label: string; p: number; score: number; calibrated: false; calibrated_probability: null; prior: number; odds: number; ev: number; baseline_ev: number; ev_kind: 'theoretical_baseline'; votes: number; gap: number; rank: number; star: number }
export interface PlayRec { play: string; name: string; odds: string; groups: { key: string; name: string; classes: string[]; candidates: Candidate[]; tilt: number; consensus: number; streak: { v: number; len: number; label: string }; n: number; edge: number; advice: string; level: 'strong' | 'mild' | 'neutral' }[] }

const r4 = (x: number) => Math.round(x * 10000) / 10000
const r2 = (x: number) => Math.round(x * 100) / 100

// Until an independent calibration study passes, all outputs are descriptive rankings.
function advise(labels: string[], en: ReturnType<typeof ensemble>, edge: number) {
  const top = labels[en.top] || '—'
  return '排序首位「' + top + '」；机制分歧及历史冷热仅作研究描述。近期机制平均命中率相对基线 ' + (edge * 100).toFixed(1) + ' 个百分点，未经独立验证，不能据此认定本期有优势；排序分不是校准命中概率。'
}

export function recommend(draws: Draw[], steps = 60) {
  const asc = [...draws].reverse().map(d => outcomesForDraw(d)!).filter(Boolean)
  const n = asc.length
  const tieRate = n ? asc.filter(o => o.dragon === 'tie').length / n : 0.1
  const byKey: Record<string, any> = {}
  for (const m of MARKETS) {
    const s = buildSeries(draws, m); const bt = backtest(s, m, steps); const en = ensemble(s, m, bt.res)
    const avgAcc = bt.res.reduce((x, r) => x + r.acc, 0) / bt.res.length
    // 形态盘先验非均匀：基线 = 永远猜「杂六」的命中率 0.672，倒向也相对先验计算
    const baseline = m.key === 'shape' ? 0.672 : bt.baseline
    if (m.key === 'shape') { const pr = [0.01, 0.048, 0.27, 0.672]; en.tilt = Math.round(Math.max(0, (en.p[en.top] - pr[en.top]) / (1 - pr[en.top])) * 1000) / 10 }
    byKey[m.key] = { m, s, bt, en, edge: avgAcc - baseline }
  }
  const mk = (key: string, oddsOf: (cls: string, i: number) => number, priorOf?: (i: number) => number, pOverride?: (p: number[]) => { labels: string[]; classes: string[]; p: number[]; votes: number[]; gaps: number[] }) => {
    const { m, en, edge } = byKey[key]
    let labels = m.labels, classes = m.classes, p = en.p as number[], votes = en.votes as number[], gaps = en.gaps as number[]
    if (pOverride) ({ labels, classes, p, votes, gaps } = pOverride(p))
    const prior = labels.map((_, i) => priorOf ? priorOf(i) : (key === 'shape' ? [0.01, 0.048, 0.27, 0.672][i] : 1 / labels.length))
    const cands: Candidate[] = labels.map((label, i) => {
      const odds = oddsOf(classes[i], i)
      // Dragon/tiger bets are refunded on ties; use the settlement rule and theoretical prior.
      const baselineEv = prior[i] * odds + (key === 'dragon' && classes[i] !== 'tie' ? 0.1 : 0) - 1
      return { key: classes[i], label, p: p[i], score: p[i], calibrated: false, calibrated_probability: null, prior: prior[i], odds, ev: baselineEv, baseline_ev: baselineEv, ev_kind: 'theoretical_baseline', votes: votes[i], gap: gaps[i], rank: 0, star: 1 }
    })
    const order = [...cands].sort((a, b) => b.p - a.p); order.forEach((c, i) => c.rank = i + 1)
    const lv = 'neutral' as const
    return { key, name: m.name, classes, candidates: order, tilt: en.tilt, consensus: en.consensus, streak: { ...en.streak, label: m.labels[en.streak.v] ?? '—' }, n: en.n, edge: r4(edge), advice: advise(labels, en, edge), level: lv }
  }
  const plays: PlayRec[] = [
    { play: 'pos', name: '定位胆（万千百十个 各 0-9）', odds: '×9.5', groups: [0, 1, 2, 3, 4].map(i => mk(`pos-digit-${i}`, () => 9.5)) },
    { play: 'pos2', name: '定位两面（各位 大小 / 单双）', odds: '×1.95', groups: [0, 1, 2, 3, 4].flatMap(i => [mk(`pos-size-${i}`, () => 1.95), mk(`pos-parity-${i}`, () => 1.95)]) },
    { play: 'sum', name: '总和 大小 / 单双', odds: '×1.95', groups: [mk('sum-size', () => 1.95), mk('sum-parity', () => 1.95)] },
    { play: 'dragon', name: '龙虎（万 vs 个）', odds: '龙虎 ×1.95 · 和 ×8.5', groups: [mk('dragon', (c) => c === 'tie' ? 8.5 : 1.95, (i) => i === 2 ? 0.1 : 0.45, (p) => ({ labels: ['龙', '虎', '和'], classes: ['dragon', 'tiger', 'tie'], p: [p[0] * (1 - tieRate), p[1] * (1 - tieRate), tieRate], votes: [...byKey['dragon'].en.votes, 0], gaps: [...byKey['dragon'].en.gaps, gapOf(asc, o => o.dragon === 'tie')] }))] },
    { play: 'shape', name: '前三形态', odds: '豹子 ×70 · 顺子 ×15 · 对子 ×3.3 · 杂六 ×1.35', groups: [mk('shape', (c) => ({ leopard: 70, straight: 15, pair: 3.3, mixed: 1.35 } as any)[c])] },
  ]
  // ---- 幸运数字综合榜：5 个位置的定位胆概率合并 → “本期最可能出现的数字”（任意位置至少出现一次的概率）
  const digitBoard = [...Array(10).keys()].map(d => {
    const perPos = [0, 1, 2, 3, 4].map(i => byKey[`pos-digit-${i}`].en.p[d] as number)
    const pAny = 1 - perPos.reduce((acc, p) => acc * (1 - p), 1)
    const bestPos = perPos.indexOf(Math.max(...perPos))
    const gapAny = gapOf(asc, o => o.nums.includes(d))
    const cnt30 = asc.slice(-30).reduce((a, o) => a + o.nums.filter(v => v === d).length, 0)
    return { digit: d, pAny: r4(pAny), scoreAny: r4(pAny), calibrated: false, calibrated_probability: null, priorAny: r4(1 - 0.9 ** 5), perPos: perPos.map(r4), bestPos, bestPosName: POS_NAMES[bestPos], gapAny, cnt30, exp30: 15, heat: r2((cnt30 - 15) / 15) }
  }).sort((a, b) => b.pAny - a.pAny).map((x, i) => ({ ...x, rank: i + 1 }))
  // ---- 全局策略
  const allGroups = plays.flatMap(p => p.groups.map(g => ({ ...g, play: p.play, playName: p.name })))
  const strong = allGroups.filter(g => g.level === 'strong').sort((a, b) => b.tilt * b.consensus - a.tilt * a.consensus)
  const mild = allGroups.filter(g => g.level === 'mild').sort((a, b) => b.tilt - a.tilt)
  const neutral = allGroups.filter(g => g.level === 'neutral')
  const longStreaks = allGroups.filter(g => g.streak.len >= 4).sort((a, b) => b.streak.len - a.streak.len)
  const posEv: (Candidate & { market: string; level: string })[] = [] // No positive-EV claims from uncalibrated scores.
  // 形态盘先验极不均匀，机制均值天然低于「永远押杂六」基线，不计入整体 regime 判断
  const evenGroups = allGroups.filter(g => g.key !== 'shape')
  const avgEdge = evenGroups.reduce((s, g) => s + g.edge, 0) / evenGroups.length
  const regime = 'unvalidated'
  const strategy = {
    regime, regimeText: '尚无经过独立样本外检验及概率校准的优势证据。下列分数描述排序，理论基线用于解释机会与成本；历史连开、遗漏和短期领先不代表下一期概率改变。',
    avgEdge: r4(avgEdge),
    focus: strong.slice(0, 4).map(g => ({ market: g.name, pick: g.candidates[0].label, p: g.candidates[0].p, tilt: g.tilt, consensus: g.consensus, play: g.play })),
    secondary: mild.slice(0, 4).map(g => ({ market: g.name, pick: g.candidates[0].label, p: g.candidates[0].p, tilt: g.tilt, consensus: g.consensus, play: g.play })),
    avoid: neutral.slice(0, 5).map(g => g.name),
    streakWatch: longStreaks.slice(0, 4).map(g => ({ market: g.name, label: g.streak.label, len: g.streak.len })),
    evTop: posEv,
    luckyTop: digitBoard.slice(0, 3).map(x => x.digit),
    luckyCold: [...digitBoard].sort((a, b) => b.gapAny - a.gapAny).slice(0, 2).map(x => ({ digit: x.digit, gap: x.gapAny })),
    steps: [
      '① 查看理论基线：同样的注数决定同样的随机覆盖率，增加注数同时增加成本。',
      '② 查看验证口径：区分历史回放与开奖前锁定的实时预测。',
      '③ 查看不确定性：累计命中率必须结合样本量、置信区间与等注数随机对照。',
      '④ 冻结规则：不要因单次命中、连错或某个短期冠军临时改权重。',
      '⑤ 排序分与模型自评未经校准，不作为命中率、正收益或加注依据。',
    ],
  }
  return { n, tieRate: r4(tieRate), calibrated: false, probability_kind: 'uncalibrated_score', plays, digitBoard, strategy, disclaimer: '排序分及累计分数不是校准命中概率；EV 字段仅表示按理论先验和结算规则计算的基线期望。未证明可重复的样本外优势前，不依据热冷、连开、模型自评或机制共识推断下一期概率提高。' }
}

function gapOf(asc: any[], pred: (o: any) => boolean) { let g = 0; for (let i = asc.length - 1; i >= 0 && !pred(asc[i]); i--) g++; return g }
