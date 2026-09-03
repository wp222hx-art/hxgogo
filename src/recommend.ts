// ============ 本期推荐引擎：每个玩法 → 全部候选的集成概率 + 规则生成的预见性策略 ============
// 声明：概率来自 20 机制回测加权集成，属于「统计倾向」而非预测能力；哈希是密码学随机数。
import { MARKETS, buildSeries, backtest, ensemble, type Draw } from './analysis'
import { computeOutcomes5, POS_NAMES } from './engine5'

export interface Candidate { key: string; label: string; p: number; prior: number; odds: number; ev: number; votes: number; gap: number; rank: number; star: number }
export interface PlayRec { play: string; name: string; odds: string; groups: { key: string; name: string; classes: string[]; candidates: Candidate[]; tilt: number; consensus: number; streak: { v: number; len: number; label: string }; n: number; edge: number; advice: string; level: 'strong' | 'mild' | 'neutral' }[] }

const r4 = (x: number) => Math.round(x * 10000) / 10000
const r2 = (x: number) => Math.round(x * 100) / 100

function level(tilt: number, consensus: number): 'strong' | 'mild' | 'neutral' { if (tilt >= 12 && consensus >= 45) return 'strong'; if (tilt >= 6 || consensus >= 35) return 'mild'; return 'neutral' }

function stars(p: number, prior: number, votes: number, total: number) {
  const lift = p / prior; const vshare = votes / total
  let s = 1; if (lift > 1.05) s++; if (lift > 1.15) s++; if (vshare > 0.3) s++; if (vshare > 0.5) s++
  return Math.min(5, s)
}

/** 针对单个市场生成一句「预见性」建议 */
function advise(name: string, labels: string[], en: ReturnType<typeof ensemble>, edge: number, lv: string, k: number) {
  const top = labels[en.top]; const second = [...en.p.keys()].sort((a, b) => en.p[b] - en.p[a])[1]
  const parts: string[] = []
  if (lv === 'strong') parts.push(`机制高度共识倾向「${top}」（倾向 ${en.tilt}，共识 ${en.consensus}%）`)
  else if (lv === 'mild') parts.push(`温和倾向「${top}」，次选「${labels[second]}」`)
  else parts.push(`各机制分歧大，接近随机（倾向 ${en.tilt}）——建议观望或轻仓`)
  if (en.streak.len >= 4) parts.push(`当前「${labels[en.streak.v]}」已连开 ${en.streak.len} 期：反转派与顺龙派正面博弈，注意波动`)
  else if (en.streak.len === 3) parts.push(`「${labels[en.streak.v]}」三连，进入长龙观察区`)
  const maxGapI = en.gaps.indexOf(Math.max(...en.gaps))
  if (k <= 4 && en.gaps[maxGapI] >= (k === 2 ? 5 : 8)) parts.push(`「${labels[maxGapI]}」已遗漏 ${en.gaps[maxGapI]} 期（追冷派信号）`)
  if (k === 10) { const cold = [...en.gaps.keys()].sort((a, b) => en.gaps[b] - en.gaps[a]).slice(0, 2); parts.push(`最冷数字 ${cold.map(i => `${labels[i]}(遗漏${en.gaps[i]})`).join('、')}`) }
  if (edge > 0.02) parts.push(`近期回测机制均值高于基线 +${(edge * 100).toFixed(1)}%（可能是短期噪声）`)
  else if (edge < -0.02) parts.push(`近期回测机制均值低于基线 ${(edge * 100).toFixed(1)}%，说明该盘近期“反规律”`)
  return parts.join('；') + '。'
}

export function recommend(draws: Draw[], steps = 60) {
  const asc = [...draws].reverse().map(d => computeOutcomes5(d.hash)!).filter(Boolean)
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
    const k = m.classes.length
    let labels = m.labels, classes = m.classes, p = en.p as number[], votes = en.votes as number[], gaps = en.gaps as number[]
    if (pOverride) ({ labels, classes, p, votes, gaps } = pOverride(p))
    const prior = labels.map((_, i) => priorOf ? priorOf(i) : (key === 'shape' ? [0.01, 0.048, 0.27, 0.672][i] : 1 / labels.length))
    const totalVotes = votes.reduce((a, b) => a + b, 0) || 1
    const cands: Candidate[] = labels.map((label, i) => ({ key: classes[i], label, p: r4(p[i]), prior: r4(prior[i]), odds: oddsOf(classes[i], i), ev: r2(p[i] * oddsOf(classes[i], i) - 1), votes: votes[i], gap: gaps[i], rank: 0, star: stars(p[i], prior[i], votes[i], totalVotes) }))
    const order = [...cands].sort((a, b) => b.p - a.p); order.forEach((c, i) => c.rank = i + 1)
    const lv = level(en.tilt, en.consensus)
    return { key, name: m.name, classes, candidates: order, tilt: en.tilt, consensus: en.consensus, streak: { ...en.streak, label: m.labels[en.streak.v] ?? '—' }, n: en.n, edge: r4(edge), advice: advise(m.name, labels, en, edge, lv, k), level: lv }
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
    return { digit: d, pAny: r4(pAny), priorAny: r4(1 - 0.9 ** 5), perPos: perPos.map(r4), bestPos, bestPosName: POS_NAMES[bestPos], gapAny, cnt30, exp30: 15, heat: r2((cnt30 - 15) / 15) }
  }).sort((a, b) => b.pAny - a.pAny).map((x, i) => ({ ...x, rank: i + 1 }))
  // ---- 全局策略
  const allGroups = plays.flatMap(p => p.groups.map(g => ({ ...g, play: p.play, playName: p.name })))
  const strong = allGroups.filter(g => g.level === 'strong').sort((a, b) => b.tilt * b.consensus - a.tilt * a.consensus)
  const mild = allGroups.filter(g => g.level === 'mild').sort((a, b) => b.tilt - a.tilt)
  const neutral = allGroups.filter(g => g.level === 'neutral')
  const longStreaks = allGroups.filter(g => g.streak.len >= 4).sort((a, b) => b.streak.len - a.streak.len)
  const posEv = allGroups.flatMap(g => g.candidates.filter(c => c.ev > 0).map(c => ({ ...c, market: g.name, level: g.level }))).sort((a, b) => b.ev - a.ev).slice(0, 8)
  // 形态盘先验极不均匀，机制均值天然低于「永远押杂六」基线，不计入整体 regime 判断
  const evenGroups = allGroups.filter(g => g.key !== 'shape')
  const avgEdge = evenGroups.reduce((s, g) => s + g.edge, 0) / evenGroups.length
  const regime = avgEdge > 0.015 ? 'pattern' : avgEdge < -0.015 ? 'anti' : 'random'
  const strategy = {
    regime, regimeText: regime === 'pattern' ? '近期回测机制整体略胜基线 → 「跟随倾向」的短期盈亏比略优（但极可能是噪声）' : regime === 'anti' ? '近期回测机制整体落后基线 → 市场处于“反规律”期，跟随倾向反而吃亏，建议轻仓/反向思考' : '近期回测机制整体贴合基线 → 教科书级随机，任何倾向都只是统计涨落',
    avgEdge: r4(avgEdge),
    focus: strong.slice(0, 4).map(g => ({ market: g.name, pick: g.candidates[0].label, p: g.candidates[0].p, tilt: g.tilt, consensus: g.consensus, play: g.play })),
    secondary: mild.slice(0, 4).map(g => ({ market: g.name, pick: g.candidates[0].label, p: g.candidates[0].p, tilt: g.tilt, consensus: g.consensus, play: g.play })),
    avoid: neutral.slice(0, 5).map(g => g.name),
    streakWatch: longStreaks.slice(0, 4).map(g => ({ market: g.name, label: g.streak.label, len: g.streak.len })),
    evTop: posEv,
    luckyTop: digitBoard.slice(0, 3).map(x => x.digit),
    luckyCold: [...digitBoard].sort((a, b) => b.gapAny - a.gapAny).slice(0, 2).map(x => ({ digit: x.digit, gap: x.gapAny })),
    steps: [
      `① 主攻：${strong.length ? strong.slice(0, 2).map(g => `${g.name} → ${g.candidates[0].label}`).join('，') : '本期无强共识市场，主攻位空缺'}`,
      `② 辅攻：${mild.length ? mild.slice(0, 2).map(g => `${g.name} → ${g.candidates[0].label}`).join('，') : '无'}`,
      `③ 幸运数字：综合榜前三 ${digitBoard.slice(0, 3).map(x => x.digit).join(' / ')}（任意位出现概率 ${digitBoard.slice(0, 3).map(x => (x.pAny * 100).toFixed(0) + '%').join(' / ')}）；最冷 ${[...digitBoard].sort((a, b) => b.gapAny - a.gapAny)[0].digit}（已 ${[...digitBoard].sort((a, b) => b.gapAny - a.gapAny)[0].gapAny} 期未出）`,
      `④ 规避：${neutral.slice(0, 3).map(g => g.name).join('、') || '无'} 机制分歧大，视为纯随机`,
      `⑤ 仓位：单市场 ≤ 总积分 5%，两面盘与定位胆按 3:1 分配；连续 3 期失手即停手复盘——这是演示平台，虚拟积分，练的是纪律不是运气`,
    ],
  }
  return { n, tieRate: r4(tieRate), plays, digitBoard, strategy, disclaimer: '以上概率为 20 种统计机制的回测加权集成，仅描述历史序列的统计倾向。区块哈希是密码学随机数，任何“预测”长期都将收敛到理论基线。本页为统计教学与产品演示，不构成任何预测保证或投注建议。' }
}

function gapOf(asc: any[], pred: (o: any) => boolean) { let g = 0; for (let i = asc.length - 1; i >= 0 && !pred(asc[i]); i--) g++; return g }
