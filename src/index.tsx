import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { computeOutcomes, judge, isValidBet, ODDS, LIMITS, ROOMS, sha256, hmacSha256, randomHex, type Room, type BetType } from './engine'
import { getNowBlock, findFirstBlockAtOrAfter, type TronBlock } from './tron'
import { page } from './page'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ------------------------------------------------------------------ helpers
const now = () => Date.now()
const isRoom = (r: string): r is Room => r in ROOMS
const bad = (c: any, msg: string, code = 400) => c.json({ ok: false, error: msg }, code)

async function getUser(c: any) {
  const token = c.req.header('X-Token') || c.req.query('token')
  if (!token) return null
  return await c.env.DB.prepare('SELECT * FROM users WHERE token = ?').bind(token).first()
}

// ------------------------------------------------------------------ round lifecycle
function roundWindow(room: Room, t: number) {
  const { roundMs, closeBeforeMs } = ROOMS[room]
  const no = Math.floor(t / roundMs)
  const start = no * roundMs
  return { round_no: no, start_ms: start, end_ms: start + roundMs, close_ms: start + roundMs - closeBeforeMs }
}

async function ensureCurrentRound(db: D1Database, room: Room) {
  const w = roundWindow(room, now())
  let r = await db.prepare('SELECT * FROM rounds WHERE room=? AND round_no=?').bind(room, w.round_no).first<any>()
  if (r) return r
  let seed: string | null = null, commitment: string | null = null
  if (room === 'seed') { seed = randomHex(32); commitment = await sha256(seed) }
  await db.prepare(`INSERT OR IGNORE INTO rounds (room, round_no, start_ms, close_ms, end_ms, status, server_seed, commitment)
                    VALUES (?,?,?,?,?,'open',?,?)`).bind(room, w.round_no, w.start_ms, w.close_ms, w.end_ms, seed, commitment).run()
  return await db.prepare('SELECT * FROM rounds WHERE room=? AND round_no=?').bind(room, w.round_no).first<any>()
}

/** 结算所有已到期的局（懒执行：每次请求触发） */
async function settleDue(db: D1Database, room: Room) {
  const t = now()
  const due = await db.prepare(`SELECT * FROM rounds WHERE room=? AND status IN ('open','settling') AND end_ms <= ? ORDER BY round_no ASC LIMIT 5`)
    .bind(room, t).all<any>()
  if (!due.results.length) return
  let head: TronBlock | null = null
  if (room === 'tron') { try { head = await getNowBlock() } catch { return } }
  for (const r of due.results) {
    // 抢锁：open -> settling（或 settling 超时 20s 重试）
    const lock = await db.prepare(`UPDATE rounds SET status='settling', settling_ms=? WHERE id=? AND (status='open' OR (status='settling' AND settling_ms < ?))`)
      .bind(t, r.id, t - 20_000).run()
    if (!lock.meta.changes) continue
    try {
      const ok = await settleRound(db, r, head)
      if (!ok) await db.prepare(`UPDATE rounds SET status='open' WHERE id=? AND status='settling'`).bind(r.id).run()
    } catch (e) {
      await db.prepare(`UPDATE rounds SET status='open' WHERE id=? AND status='settling'`).bind(r.id).run()
    }
  }
}

async function settleRound(db: D1Database, r: any, head: TronBlock | null): Promise<boolean> {
  const bets = (await db.prepare('SELECT * FROM bets WHERE round_id=? ORDER BY id ASC').bind(r.id).all<any>()).results
  const betIds = bets.map(b => b.id).sort()
  const betsHash = await sha256(betIds.join(','))

  let resultHash: string, blockNumber: number | null = null, blockTs: number | null = null
  if (r.room === 'tron') {
    // 超过 10 分钟仍取不到区块 -> 作废退款
    const blk = await findFirstBlockAtOrAfter(r.end_ms, head ?? undefined)
    if (!blk) {
      if (now() - r.end_ms > 10 * 60_000) return await voidRound(db, r, bets)
      return false
    }
    resultHash = blk.hash; blockNumber = blk.number; blockTs = blk.timestamp
  } else {
    resultHash = await hmacSha256(r.server_seed, `${r.room}:${r.round_no}:${betsHash}`)
  }

  const o = computeOutcomes(resultHash)
  const stmts: D1PreparedStatement[] = []
  let payoutTotal = 0
  const userDelta = new Map<string, { pay: number; win: number }>()
  for (const b of bets) {
    const res = judge(o, b.bet_type as BetType, b.selection)
    const payout = res === 'win' ? Math.floor(b.amount * b.odds) : res === 'refund' ? b.amount : 0
    payoutTotal += payout
    stmts.push(db.prepare('UPDATE bets SET status=?, payout=? WHERE id=?').bind(res, payout, b.id))
    if (payout > 0) {
      const d = userDelta.get(b.user_id) ?? { pay: 0, win: 0 }
      d.pay += payout; if (res === 'win') d.win += payout - b.amount
      userDelta.set(b.user_id, d)
    }
  }
  for (const [uid, d] of userDelta) stmts.push(db.prepare('UPDATE users SET balance=balance+?, total_win=total_win+? WHERE id=?').bind(d.pay, d.win, uid))
  stmts.push(db.prepare(`UPDATE rounds SET status='settled', bets_hash=?, block_number=?, block_ts=?, result_hash=?, digit1=?, digit2=?, outcomes=?, payout_total=?, settled_ms=? WHERE id=?`)
    .bind(betsHash, blockNumber, blockTs, resultHash, o.digit1, o.digit2, JSON.stringify(o), payoutTotal, now(), r.id))
  await db.batch(stmts)
  return true
}

async function voidRound(db: D1Database, r: any, bets: any[]) {
  const stmts: D1PreparedStatement[] = []
  for (const b of bets) {
    stmts.push(db.prepare(`UPDATE bets SET status='refund', payout=amount WHERE id=?`).bind(b.id))
    stmts.push(db.prepare('UPDATE users SET balance=balance+? WHERE id=?').bind(b.amount, b.user_id))
  }
  stmts.push(db.prepare(`UPDATE rounds SET status='void', settled_ms=? WHERE id=?`).bind(now(), r.id))
  await db.batch(stmts)
  return true
}

async function tick(db: D1Database, room: Room) {
  await settleDue(db, room)
  return await ensureCurrentRound(db, room)
}

function publicRound(r: any) {
  if (!r) return null
  const { server_seed, ...rest } = r
  const settled = r.status === 'settled' || r.status === 'void'
  return { ...rest, server_seed: settled ? server_seed : null, outcomes: r.outcomes ? JSON.parse(r.outcomes) : null }
}

// ------------------------------------------------------------------ API: meta
app.get('/api/rooms', (c) => c.json({ ok: true, rooms: ROOMS, odds: ODDS, limits: LIMITS, server_time: now() }))

// ------------------------------------------------------------------ API: auth (匿名虚拟账户)
app.post('/api/auth/guest', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const id = randomHex(8), token = randomHex(24)
  const nickname = (body.nickname || `玩家${id.slice(0, 4).toUpperCase()}`).toString().slice(0, 16)
  await c.env.DB.prepare('INSERT INTO users (id, token, nickname, balance, created_ms) VALUES (?,?,?,?,?)')
    .bind(id, token, nickname, LIMITS.initBalance, now()).run()
  return c.json({ ok: true, token, user: { id, nickname, balance: LIMITS.initBalance } })
})

app.get('/api/me', async (c) => {
  const u = await getUser(c)
  if (!u) return bad(c, 'unauthorized', 401)
  const { token, ...rest } = u
  return c.json({ ok: true, user: rest })
})

/** 余额低于阈值时领取救济积分（每小时一次）—— 纯虚拟 */
app.post('/api/me/relief', async (c) => {
  const u = await getUser(c)
  if (!u) return bad(c, 'unauthorized', 401)
  if (u.balance >= LIMITS.reliefBelow) return bad(c, `余额 ≥ ${LIMITS.reliefBelow} 不可领取`)
  if (now() - u.last_claim_ms < LIMITS.reliefCooldownMs) return bad(c, '每小时只能领取一次')
  await c.env.DB.prepare('UPDATE users SET balance=balance+?, last_claim_ms=? WHERE id=?').bind(LIMITS.reliefAmount, now(), u.id).run()
  return c.json({ ok: true, balance: u.balance + LIMITS.reliefAmount })
})

// ------------------------------------------------------------------ API: 实时状态
app.get('/api/state', async (c) => {
  const room = c.req.query('room') || 'tron'
  if (!isRoom(room)) return bad(c, 'unknown room')
  const db = c.env.DB
  const cur = await tick(db, room)
  const last = await db.prepare(`SELECT * FROM rounds WHERE room=? AND status IN ('settled','void') ORDER BY round_no DESC LIMIT 1`).bind(room).first<any>()
  const pending = await db.prepare(`SELECT round_no, status FROM rounds WHERE room=? AND status IN ('open','settling') AND round_no < ? ORDER BY round_no DESC LIMIT 3`).bind(room, cur.round_no).all<any>()
  const u = await getUser(c)
  let myBets: any[] = [], user: any = null
  if (u) {
    myBets = (await db.prepare('SELECT bet_type, selection, amount, odds, status, payout FROM bets WHERE round_id=? AND user_id=?').bind(cur.id, u.id).all<any>()).results
    const { token, ...rest } = u; user = rest
  }
  const pool = (await db.prepare('SELECT bet_type, selection, SUM(amount) amt, COUNT(*) n FROM bets WHERE round_id=? GROUP BY bet_type, selection').bind(cur.id).all<any>()).results
  return c.json({ ok: true, server_time: now(), room, current: publicRound(cur), last: publicRound(last), pending: pending.results, my_bets: myBets, pool, user })
})

// ------------------------------------------------------------------ API: 下注
app.post('/api/bet', async (c) => {
  const u = await getUser(c)
  if (!u) return bad(c, 'unauthorized', 401)
  const body = await c.req.json().catch(() => null) as any
  if (!body) return bad(c, 'bad json')
  const { room, bet_type, selection } = body
  const amount = Math.floor(Number(body.amount))
  if (!isRoom(room)) return bad(c, 'unknown room')
  if (!isValidBet(bet_type, String(selection))) return bad(c, '无效玩法或选项')
  if (!Number.isFinite(amount) || amount < LIMITS.minBet || amount > LIMITS.maxBet) return bad(c, `单注 ${LIMITS.minBet} ~ ${LIMITS.maxBet}`)

  const db = c.env.DB
  const cur = await tick(db, room)
  const t = now()
  if (cur.status !== 'open' || t >= cur.close_ms) return bad(c, '本局已封盘，请等待下一局')
  const mine = await db.prepare('SELECT COALESCE(SUM(amount),0) s FROM bets WHERE round_id=? AND user_id=?').bind(cur.id, u.id).first<any>()
  if ((mine?.s ?? 0) + amount > LIMITS.maxPerRound) return bad(c, `单局累计上限 ${LIMITS.maxPerRound}`)

  // 原子扣款
  const deduct = await db.prepare('UPDATE users SET balance=balance-?, total_bet=total_bet+?, bet_count=bet_count+1 WHERE id=? AND balance>=?').bind(amount, amount, u.id, amount).run()
  if (!deduct.meta.changes) return bad(c, '余额不足')

  const odds = ODDS[bet_type as BetType][String(selection)]
  const id = await sha256(`${u.id}:${cur.id}:${t}:${randomHex(8)}`)
  await db.batch([
    db.prepare('INSERT INTO bets (id, round_id, user_id, room, round_no, bet_type, selection, amount, odds, created_ms) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, cur.id, u.id, room, cur.round_no, bet_type, String(selection), amount, odds, t),
    db.prepare('UPDATE rounds SET bet_total=bet_total+? WHERE id=?').bind(amount, cur.id),
  ])
  const fresh = await db.prepare('SELECT balance FROM users WHERE id=?').bind(u.id).first<any>()
  return c.json({ ok: true, bet: { id, round_no: cur.round_no, bet_type, selection, amount, odds }, balance: fresh.balance })
})

// ------------------------------------------------------------------ API: 历史 / 走势 / 详情 / 验证
app.get('/api/history', async (c) => {
  const room = c.req.query('room') || 'tron'
  if (!isRoom(room)) return bad(c, 'unknown room')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)))
  await tick(c.env.DB, room)
  const rows = await c.env.DB.prepare(`SELECT id, room, round_no, end_ms, status, block_number, result_hash, digit1, digit2, outcomes, bet_total, payout_total, commitment FROM rounds WHERE room=? AND status IN ('settled','void') ORDER BY round_no DESC LIMIT ?`).bind(room, limit).all<any>()
  return c.json({ ok: true, rows: rows.results.map(r => ({ ...r, outcomes: r.outcomes ? JSON.parse(r.outcomes) : null })) })
})

app.get('/api/stats', async (c) => {
  const room = c.req.query('room') || 'tron'
  if (!isRoom(room)) return bad(c, 'unknown room')
  const rows = (await c.env.DB.prepare(`SELECT outcomes FROM rounds WHERE room=? AND status='settled' ORDER BY round_no DESC LIMIT 100`).bind(room).all<any>()).results
  const cnt: Record<string, Record<string, number>> = { parity: {}, size: {}, bp: {}, chartype: {}, lucky: {} }
  for (const r of rows) {
    const o = JSON.parse(r.outcomes)
    for (const k of Object.keys(cnt)) { const v = o[k]; if (v !== null && v !== undefined) cnt[k][String(v)] = (cnt[k][String(v)] || 0) + 1 }
  }
  return c.json({ ok: true, sample: rows.length, counts: cnt })
})

app.get('/api/round/:room/:no', async (c) => {
  const room = c.req.param('room'); const no = Number(c.req.param('no'))
  if (!isRoom(room)) return bad(c, 'unknown room')
  const r = await c.env.DB.prepare('SELECT * FROM rounds WHERE room=? AND round_no=?').bind(room, no).first<any>()
  if (!r) return bad(c, 'not found', 404)
  const agg = (await c.env.DB.prepare('SELECT bet_type, selection, SUM(amount) amt, COUNT(*) n, SUM(payout) pay FROM bets WHERE round_id=? GROUP BY bet_type, selection').bind(r.id).all<any>()).results
  return c.json({ ok: true, round: publicRound(r), bets: agg })
})

/** 可验证公平：返回完整推导链，任何人可离线重算 */
app.get('/api/verify/:room/:no', async (c) => {
  const room = c.req.param('room'); const no = Number(c.req.param('no'))
  if (!isRoom(room)) return bad(c, 'unknown room')
  const db = c.env.DB
  const r = await db.prepare('SELECT * FROM rounds WHERE room=? AND round_no=?').bind(room, no).first<any>()
  if (!r) return bad(c, 'not found', 404)
  if (r.status !== 'settled') return c.json({ ok: true, status: r.status, message: '尚未开奖', commitment: r.commitment, end_ms: r.end_ms })
  const betIds = (await db.prepare('SELECT id FROM bets WHERE round_id=? ORDER BY id ASC').bind(r.id).all<any>()).results.map(b => b.id)
  const recomputedBetsHash = await sha256(betIds.join(','))
  const recomputed = computeOutcomes(r.result_hash)
  const steps: any[] = []
  let recomputedHash = r.result_hash, seedOk: boolean | null = null
  if (room === 'tron') {
    steps.push({ step: 1, title: '确定开奖区块', detail: `本局截止时间 end_ms=${r.end_ms}（${new Date(r.end_ms).toISOString()}），取「区块时间戳 ≥ end_ms 的第一个 TRON 区块」`, value: `#${r.block_number} @ ${r.block_ts}` })
    steps.push({ step: 2, title: '读取区块哈希', detail: '可在 Tronscan 独立核对', value: r.result_hash, link: `https://tronscan.org/#/block/${r.block_number}` })
  } else {
    seedOk = (await sha256(r.server_seed)) === r.commitment
    recomputedHash = await hmacSha256(r.server_seed, `${room}:${no}:${recomputedBetsHash}`)
    steps.push({ step: 1, title: '开局公示承诺值', detail: 'commitment = sha256(server_seed)，开局即公开，开奖前无法更改种子', value: r.commitment })
    steps.push({ step: 2, title: '开奖公开服务端种子', detail: `sha256(server_seed) ${seedOk ? '==' : '!='} commitment → ${seedOk ? '承诺一致 ✓' : '承诺不一致 ✗'}`, value: r.server_seed })
    steps.push({ step: 3, title: '全场注单哈希（客户端熵）', detail: `bets_hash = sha256(sorted(bet_ids).join(','))，共 ${betIds.length} 注`, value: recomputedBetsHash, bet_ids: betIds })
    steps.push({ step: 4, title: 'HMAC 开奖', detail: `result = HMAC_SHA256(server_seed, "${room}:${no}:" + bets_hash)`, value: recomputedHash })
  }
  steps.push({ step: steps.length + 1, title: '取数规则', detail: '从哈希末位向左取第 1 个数字 = 闲/单双/大小/幸运数；第 2 个数字 = 庄；末位字符类型 = 数字/字母', value: `digit1=${recomputed.digit1}  digit2=${recomputed.digit2}  last='${recomputed.lastChar}'` })
  const consistent = recomputedHash === r.result_hash && recomputedBetsHash === r.bets_hash && JSON.stringify(recomputed) === r.outcomes && (seedOk ?? true)
  return c.json({ ok: true, room, round_no: no, status: r.status, consistent, stored: { result_hash: r.result_hash, bets_hash: r.bets_hash, outcomes: JSON.parse(r.outcomes) }, recomputed: { result_hash: recomputedHash, bets_hash: recomputedBetsHash, outcomes: recomputed }, steps })
})

app.get('/api/my/bets', async (c) => {
  const u = await getUser(c)
  if (!u) return bad(c, 'unauthorized', 401)
  const limit = Math.min(200, Number(c.req.query('limit') || 50))
  const rows = await c.env.DB.prepare('SELECT room, round_no, bet_type, selection, amount, odds, status, payout, created_ms FROM bets WHERE user_id=? ORDER BY created_ms DESC LIMIT ?').bind(u.id, limit).all<any>()
  return c.json({ ok: true, rows: rows.results })
})

app.get('/api/leaderboard', async (c) => {
  const rows = await c.env.DB.prepare('SELECT nickname, balance, total_bet, total_win, bet_count FROM users WHERE bet_count > 0 ORDER BY balance DESC LIMIT 20').all<any>()
  return c.json({ ok: true, rows: rows.results })
})

// ------------------------------------------------------------------ 页面
app.get('/', (c) => c.html(page()))

export default app
