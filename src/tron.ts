// ============ TRON 公链区块读取（TronGrid 公共接口） ============
/** 多个公共全节点轮询：TronGrid 匿名限流较严（429），失败自动切换到备用节点并退避重试 */
const NODES = ['https://api.trongrid.io', 'https://api.tronstack.io', 'https://tron-rpc.publicnode.com']
const BLOCK_INTERVAL = 3000
let nodeIdx = 0
let apiKey: string | undefined
/** 可选：配置 TronGrid API Key 提升限额（设置后仅对 trongrid 生效） */
export function setTronApiKey(k?: string | null) { apiKey = k || undefined }

export interface TronBlock { number: number; hash: string; timestamp: number }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function postOnce(base: string, path: string, body: unknown): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    if (apiKey && base.includes('trongrid')) headers['TRON-PRO-API-KEY'] = apiKey
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) { await res.text().catch(() => {}); const e: any = new Error(`TronGrid ${path} HTTP ${res.status}`); e.status = res.status; throw e }
    return await res.json()
  } finally { clearTimeout(t) }
}

/** 429/5xx/网络错误 → 切换节点 + 指数退避，最多 4 次 */
async function post(path: string, body: unknown): Promise<any> {
  let lastErr: any = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const base = NODES[nodeIdx % NODES.length]
    try { return await postOnce(base, path, body) }
    catch (e: any) {
      lastErr = e
      const st = e?.status
      if (st && st !== 429 && st < 500) throw e          // 4xx（非限流）不重试
      nodeIdx++                                            // 换节点
      await sleep(300 * Math.pow(2, attempt))
    }
  }
  throw lastErr
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
