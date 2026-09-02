// ============ TRON 公链区块读取（TronGrid 公共接口） ============
const TRONGRID = 'https://api.trongrid.io'
const BLOCK_INTERVAL = 3000

export interface TronBlock { number: number; hash: string; timestamp: number }

async function post(path: string, body: unknown): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(TRONGRID + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TronGrid ${path} HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

function parse(raw: any): TronBlock | null {
  const h = raw?.block_header?.raw_data
  if (!raw?.blockID || !h) return null
  return { number: h.number, hash: raw.blockID, timestamp: h.timestamp }
}

export async function getNowBlock(): Promise<TronBlock> {
  const b = parse(await post('/wallet/getnowblock', {}))
  if (!b) throw new Error('getnowblock: bad response')
  return b
}

export async function getBlockByNum(num: number): Promise<TronBlock | null> {
  return parse(await post('/wallet/getblockbynum', { num }))
}

/**
 * 找到「区块时间戳 >= targetMs 的第一个区块」——这就是本局的开奖区块。
 * 规则确定且可独立复核：任何人拿 targetMs 去 Tronscan 都能找到同一个区块。
 */
export async function findFirstBlockAtOrAfter(targetMs: number, now?: TronBlock): Promise<TronBlock | null> {
  const head = now ?? await getNowBlock()
  if (head.timestamp < targetMs) return null // 链还没走到那个时间
  let num = head.number - Math.floor((head.timestamp - targetMs) / BLOCK_INTERVAL)
  let blk = await getBlockByNum(num)
  if (!blk) return null
  // 向前推：直到 timestamp >= target
  let guard = 0
  while (blk.timestamp < targetMs && guard++ < 12) {
    const next = await getBlockByNum(blk.number + 1)
    if (!next) return null
    blk = next
  }
  // 向后退：确保前一个区块 < target
  guard = 0
  while (guard++ < 12) {
    const prev = await getBlockByNum(blk.number - 1)
    if (!prev || prev.timestamp < targetMs) break
    blk = prev
  }
  return blk.timestamp >= targetMs ? blk : null
}
