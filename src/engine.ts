// ============ 哈希开奖引擎（纯函数，可被前端/验证工具复用） ============

export type BetType = 'parity' | 'size' | 'bp' | 'chartype' | 'lucky'

export interface Outcomes {
  lastChar: string          // 哈希最后一个字符
  digit1: number | null     // 从右向左第 1 个数字（闲 / 单双 / 大小 / 幸运数字）
  digit2: number | null     // 从右向左第 2 个数字（庄）
  parity: 'odd' | 'even' | null
  size: 'big' | 'small' | null
  bp: 'banker' | 'player' | 'tie' | null
  chartype: 'digit' | 'letter'
  lucky: number | null
}

export const ODDS: Record<BetType, Record<string, number>> = {
  parity:   { odd: 1.95, even: 1.95 },
  size:     { big: 1.95, small: 1.95 },
  bp:       { banker: 1.95, player: 1.95, tie: 8.5 },
  chartype: { digit: 1.55, letter: 2.55 },
  lucky:    { '0': 9.5, '1': 9.5, '2': 9.5, '3': 9.5, '4': 9.5, '5': 9.5, '6': 9.5, '7': 9.5, '8': 9.5, '9': 9.5 },
}

export const LIMITS = { minBet: 10, maxBet: 5000, maxPerRound: 20000, initBalance: 10000, reliefAmount: 5000, reliefBelow: 500, reliefCooldownMs: 60 * 60 * 1000 }

export const ROOMS = {
  tron: { name: 'TRON 区块厅', roundMs: 30_000, closeBeforeMs: 6_000, desc: '以波场公链真实区块哈希开奖，可在 Tronscan 独立核验' },
  seed: { name: '种子承诺厅', roundMs: 20_000, closeBeforeMs: 4_000, desc: '服务端种子承诺 + 全场注单哈希 HMAC 开奖，开局先公示承诺值' },
} as const
export type Room = keyof typeof ROOMS

/** 从右向左提取数字，返回 [digit1, digit2] */
export function extractDigits(hash: string): (number | null)[] {
  const digits: number[] = []
  for (let i = hash.length - 1; i >= 0 && digits.length < 2; i--) {
    const ch = hash[i]
    if (ch >= '0' && ch <= '9') digits.push(Number(ch))
  }
  return [digits[0] ?? null, digits[1] ?? null]
}

export function computeOutcomes(hashInput: string): Outcomes {
  const hash = hashInput.toLowerCase().replace(/^0x/, '')
  const lastChar = hash[hash.length - 1] ?? ''
  const [d1, d2] = extractDigits(hash)
  const isDigit = lastChar >= '0' && lastChar <= '9'
  let bp: Outcomes['bp'] = null
  if (d1 !== null && d2 !== null) bp = d2 > d1 ? 'banker' : d2 < d1 ? 'player' : 'tie'
  return {
    lastChar,
    digit1: d1,
    digit2: d2,
    parity: d1 === null ? null : (d1 % 2 === 1 ? 'odd' : 'even'),
    size: d1 === null ? null : (d1 >= 5 ? 'big' : 'small'),
    bp,
    chartype: isDigit ? 'digit' : 'letter',
    lucky: d1,
  }
}

/** 判定单注结果：win / lose / refund */
export function judge(o: Outcomes, betType: BetType, selection: string): 'win' | 'lose' | 'refund' {
  switch (betType) {
    case 'parity': return o.parity === null ? 'refund' : (o.parity === selection ? 'win' : 'lose')
    case 'size':   return o.size === null ? 'refund' : (o.size === selection ? 'win' : 'lose')
    case 'bp':
      if (o.bp === null) return 'refund'
      if (o.bp === selection) return 'win'
      if (o.bp === 'tie' && (selection === 'banker' || selection === 'player')) return 'refund' // 和局退本
      return 'lose'
    case 'chartype': return o.chartype === selection ? 'win' : 'lose'
    case 'lucky':  return o.lucky === null ? 'refund' : (String(o.lucky) === selection ? 'win' : 'lose')
  }
}

export function isValidBet(betType: string, selection: string): betType is BetType {
  return betType in ODDS && selection in ODDS[betType as BetType]
}

// ============ Web Crypto 工具 ============
const enc = new TextEncoder()
export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function sha256(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}
export async function hmacSha256(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export function randomHex(bytes = 32): string {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a)
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('')
}
