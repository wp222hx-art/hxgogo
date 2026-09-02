// ============ 五位数（哈希分分彩规则）玩法引擎 ============
// 规则：区块哈希中「最后 5 个数字字符」(跳过 a-f) => n1..n5 (万千百十个)

export type Five = [number, number, number, number, number]
export type Bet5Type = 'pos' | 'pos2' | 'sum' | 'dragon' | 'shape'
export const POS_NAMES = ['万', '千', '百', '十', '个']

export interface Outcomes5 {
  nums: Five
  sum: number
  sumSize: 'big' | 'small'        // ≥23 大
  sumParity: 'odd' | 'even'
  dragon: 'dragon' | 'tiger' | 'tie' // n1 vs n5
  shape: 'leopard' | 'straight' | 'pair' | 'mixed'  // 前三形态
  pos: { size: ('big' | 'small')[]; parity: ('odd' | 'even')[] }
}

export function extractFive(hash: string): Five | null {
  const d = hash.toLowerCase().replace(/^0x/, '').replace(/[^0-9]/g, '')
  if (d.length < 5) return null
  return d.slice(-5).split('').map(Number) as Five
}

export function computeOutcomes5(hash: string): Outcomes5 | null {
  const nums = extractFive(hash); if (!nums) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  const [a, b, c] = nums
  const s = [a, b, c].sort((x, y) => x - y)
  let shape: Outcomes5['shape'] = 'mixed'
  if (a === b && b === c) shape = 'leopard'
  else if (s[2] - s[1] === 1 && s[1] - s[0] === 1) shape = 'straight'
  else if (a === b || b === c || a === c) shape = 'pair'
  return {
    nums, sum,
    sumSize: sum >= 23 ? 'big' : 'small',
    sumParity: sum % 2 ? 'odd' : 'even',
    dragon: nums[0] > nums[4] ? 'dragon' : nums[0] < nums[4] ? 'tiger' : 'tie',
    shape,
    pos: { size: nums.map(n => (n >= 5 ? 'big' : 'small')), parity: nums.map(n => (n % 2 ? 'odd' : 'even')) },
  }
}

// 玩法 -> selection 编码
// pos:   "<pos>-<digit>"      定位胆  e.g. "0-7" 万位=7            ×9.5
// pos2:  "<pos>-big|small|odd|even" 定位两面                       ×1.95
// sum:   "big|small|odd|even" 总和大小单双                          ×1.95
// dragon:"dragon|tiger|tie"  龙虎（万 vs 个）                        ×1.95 / 和 ×8.5 (押龙虎遇和退本)
// shape: "leopard|straight|pair|mixed" 前三形态                      ×70 / ×15 / ×3.3 / ×1.35
export const ODDS5: Record<Bet5Type, (sel: string) => number | null> = {
  pos: (s) => /^[0-4]-[0-9]$/.test(s) ? 9.5 : null,
  pos2: (s) => /^[0-4]-(big|small|odd|even)$/.test(s) ? 1.95 : null,
  sum: (s) => ['big', 'small', 'odd', 'even'].includes(s) ? 1.95 : null,
  dragon: (s) => s === 'tie' ? 8.5 : ['dragon', 'tiger'].includes(s) ? 1.95 : null,
  shape: (s) => ({ leopard: 70, straight: 15, pair: 3.3, mixed: 1.35 } as any)[s] ?? null,
}
export const isBet5Type = (t: string): t is Bet5Type => t in ODDS5

export function judge5(o: Outcomes5, t: Bet5Type, sel: string): 'win' | 'lose' | 'refund' {
  switch (t) {
    case 'pos': { const [p, d] = sel.split('-').map(Number); return o.nums[p] === d ? 'win' : 'lose' }
    case 'pos2': { const [p, k] = sel.split('-'); const i = Number(p); const v = (k === 'big' || k === 'small') ? o.pos.size[i] : o.pos.parity[i]; return v === k ? 'win' : 'lose' }
    case 'sum': return (o.sumSize === sel || o.sumParity === sel) ? 'win' : 'lose'
    case 'dragon': if (o.dragon === sel) return 'win'; if (o.dragon === 'tie') return 'refund'; return 'lose'
    case 'shape': return o.shape === sel ? 'win' : 'lose'
  }
}
