import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { computeOutcomes, judge, isValidBet, ODDS, LIMITS, ROOMS, sha256, hmacSha256, randomHex, type Room, type BetType } from './engine'
import { getNowBlock, findFirstBlockAtOrAfter, type TronBlock } from './tron'
import { page } from './page'
import { analysisPage } from './page_analysis'
import { computeOutcomes5, judge5, isBet5Type, ODDS5, type Bet5Type } from './engine5'
import { SOURCES, isSource, syncSource, loadDraws, syncStatus, dataVersion, onInvalidate, fetchQkltj } from './sync'
import { MARKETS, marketByKey, buildSeries, backtest, ensemble, stats as drawStats, MECHANISMS } from './analysis'
import { kline, marketKlines } from './kline'
import { recommend } from './recommend'
import { parityKline } from './parity_kline'
import { pick } from './picker'
import { recordPick, pickTrack } from './pick_track'
import { autoArena, arenaBoard, arenaRound, replayArena, settleArena, externalRound, nextOf, STRATEGIES, AI_SUBSETS, ARENA_N, ARENA_ODDS, ARENA_MIN_HIST } from './arena'
import { arenaPage } from './page_arena'
import { aiPage } from './page_ai'
import { aiEnabled, aiModel, aiEffort, aiProviderName, aiLeadMs, backfillAiSubsets, backfillCustomTiers, tierDigest, forecastFor, aiScores, aiHistory, generateReport, latestReport, aiExtraPlans, aiPlansMaintain, aiPick, type AiEnv } from './ai'
import { listAiPlans } from './ai_plans'
import { effectiveEnv, saveConfig, configView, validateProvider, CONFIG_KEYS, parseCustomNs } from './config'
import { top3Round, top3View, top3Backfill, TOP3_KEY } from './top3'
import { scanGaps, fillGapsFromChain, coverageReport } from './gapfill'
import { top3Page } from './page_top3'
import { settingsPage } from './page_settings'
import { queryPage } from './page_query'

type Bindings = { DB: D1Database } & AiEnv
const app = new Hono<{ Bindings: Bindings; Variables: { ai: AiEnv } }>()
app.use('/api/*', cors())
// AI 生效配置 = D1 app_config（/settings 页面填写）> 环境变量；每个请求解析一次，后续所有 AI 调用都用 c.var.ai
app.use('/api/*', async (c, next) => { c.set('ai', await effectiveEnv(c.env.DB, c.env)); ensureHeartbeat(c); await next() })

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
/** qkltj 哈希分分彩：官方固定取每分钟 03 秒的 TRON 区块（实测 60/60 期区块时间戳秒位=03） */
const FIVE_BLOCK_OFFSET_MS = 3_000
function fmtUtc8(ms: number) { return new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') }
/** 官方期号格式：YYYYMMDD + 当日分钟序号(4位, UTC+8)，如 202609030670 = 09-03 11:10 */
function officialExpect(minuteMs: number) {
  const d = new Date(minuteMs + 8 * 3600_000)
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
  return ymd + String(d.getUTCHours() * 60 + d.getUTCMinutes()).padStart(4, '0')
}

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
  if (room === 'tron' || room === 'five') { try { head = await getNowBlock() } catch { return } }
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
  if (r.room === 'tron' || r.room === 'five') {
    // 五位厅对齐 qkltj 官方口径：取每分钟 03 秒的区块（官方“固定采用每分钟 03 秒区块，如 03 秒没有区块则取下一个”）
    const target = r.room === 'five' ? r.end_ms + FIVE_BLOCK_OFFSET_MS : r.end_ms
    // 超过 10 分钟仍取不到区块 -> 作废退款
    const blk = await findFirstBlockAtOrAfter(target, head ?? undefined)
    if (!blk) {
      if (now() - r.end_ms > 10 * 60_000) return await voidRound(db, r, bets)
      return false
    }
    resultHash = blk.hash; blockNumber = blk.number; blockTs = blk.timestamp
  } else {
    resultHash = await hmacSha256(r.server_seed, `${r.room}:${r.round_no}:${betsHash}`)
  }

  const isFive = r.room === 'five'
  const o5 = isFive ? computeOutcomes5(resultHash) : null
  const o = computeOutcomes(resultHash)
  if (isFive && !o5) return await voidRound(db, r, bets)
  const stmts: D1PreparedStatement[] = []
  let payoutTotal = 0
  const userDelta = new Map<string, { pay: number; win: number }>()
  for (const b of bets) {
    const res = isFive ? judge5(o5!, b.bet_type as Bet5Type, b.selection) : judge(o, b.bet_type as BetType, b.selection)
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
    .bind(betsHash, blockNumber, blockTs, resultHash, o.digit1, o.digit2, JSON.stringify(isFive ? o5 : o), payoutTotal, now(), r.id))
  if (isFive && o5) {
    // 期号采用官方同样的 YYYYMMDD+当日分钟序号(UTC+8) 格式，便于与 qkltj:6001 逐期对照
    const expect = officialExpect(r.end_ms)
    stmts.push(db.prepare(`INSERT INTO draws (source, expect, block, hash, n1,n2,n3,n4,n5, open_ms, opennumber, lotto_type, lotto_type_cn, open_time, mismatch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
      ON CONFLICT(source, expect) DO UPDATE SET block=excluded.block, hash=excluded.hash, n1=excluded.n1, n2=excluded.n2, n3=excluded.n3, n4=excluded.n4, n5=excluded.n5, open_ms=excluded.open_ms, opennumber=excluded.opennumber, open_time=excluded.open_time`)
      .bind('local:five', expect, blockNumber, resultHash, ...o5.nums, blockTs ?? r.end_ms, o5.nums.join(','), 'trxbhffc', 'HashPlay 五位厅', fmtUtc8(blockTs ?? r.end_ms)))
  }
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
app.get('/api/rooms', (c) => c.json({ ok: true, rooms: ROOMS, odds: ODDS, limits: LIMITS, server_time: now(), sources: SOURCES }))

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
  let odds: number
  if (room === 'five') {
    if (!isBet5Type(bet_type)) return bad(c, '无效玩法')
    const o = ODDS5[bet_type](String(selection)); if (!o) return bad(c, '无效选项'); odds = o
  } else {
    if (!isValidBet(bet_type, String(selection))) return bad(c, '无效玩法或选项')
    odds = ODDS[bet_type as BetType][String(selection)]
  }
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
  const cnt: Record<string, Record<string, number>> = room === 'five' ? { sumSize: {}, sumParity: {}, dragon: {}, shape: {} } : { parity: {}, size: {}, bp: {}, chartype: {}, lucky: {} }
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
  if (room === 'tron' || room === 'five') {
    const tgt = room === 'five' ? r.end_ms + FIVE_BLOCK_OFFSET_MS : r.end_ms
    steps.push({ step: 1, title: '确定开奖区块', detail: room === 'five'
      ? `官方口径（qkltj 哈希分分彩）：期号 ${officialExpect(r.end_ms)}，取「本分钟 03 秒」的 TRON 区块，即区块时间戳 ≥ ${fmtUtc8(tgt)} (UTC+8) 的第一个区块；如 03 秒无区块则取下一个`
      : `本局截止时间 end_ms=${r.end_ms}（${new Date(r.end_ms).toISOString()}），取「区块时间戳 ≥ end_ms 的第一个 TRON 区块」`, value: `#${r.block_number} @ ${r.block_ts}${r.block_ts ? ' (' + fmtUtc8(r.block_ts) + ' UTC+8)' : ''}` })
    steps.push({ step: 2, title: '读取区块哈希', detail: '可在 Tronscan 独立核对', value: r.result_hash, link: `https://tronscan.org/#/block/${r.block_number}` })
  } else {
    seedOk = (await sha256(r.server_seed)) === r.commitment
    recomputedHash = await hmacSha256(r.server_seed, `${room}:${no}:${recomputedBetsHash}`)
    steps.push({ step: 1, title: '开局公示承诺值', detail: 'commitment = sha256(server_seed)，开局即公开，开奖前无法更改种子', value: r.commitment })
    steps.push({ step: 2, title: '开奖公开服务端种子', detail: `sha256(server_seed) ${seedOk ? '==' : '!='} commitment → ${seedOk ? '承诺一致 ✓' : '承诺不一致 ✗'}`, value: r.server_seed })
    steps.push({ step: 3, title: '全场注单哈希（客户端熵）', detail: `bets_hash = sha256(sorted(bet_ids).join(','))，共 ${betIds.length} 注`, value: recomputedBetsHash, bet_ids: betIds })
    steps.push({ step: 4, title: 'HMAC 开奖', detail: `result = HMAC_SHA256(server_seed, "${room}:${no}:" + bets_hash)`, value: recomputedHash })
  }
  const isFive = room === 'five'
  const recomputedAny: any = isFive ? computeOutcomes5(r.result_hash) : recomputed
  if (isFive) steps.push({ step: steps.length + 1, title: '取数规则（哈希分分彩）', detail: '剔除哈希中的字母 a-f，取最后 5 个数字 → 万千百十个', value: recomputedAny ? recomputedAny.nums.join(',') + `  总和=${recomputedAny.sum} 龙虎=${recomputedAny.dragon} 形态=${recomputedAny.shape}` : '数字不足' })
  else steps.push({ step: steps.length + 1, title: '取数规则', detail: '从哈希末位向左取第 1 个数字 = 闲/单双/大小/幸运数；第 2 个数字 = 庄；末位字符类型 = 数字/字母', value: `digit1=${recomputed.digit1}  digit2=${recomputed.digit2}  last='${recomputed.lastChar}'` })
  const consistent = recomputedHash === r.result_hash && recomputedBetsHash === r.bets_hash && JSON.stringify(recomputedAny) === r.outcomes && (seedOk ?? true)
  return c.json({ ok: true, room, round_no: no, status: r.status, consistent, stored: { result_hash: r.result_hash, bets_hash: r.bets_hash, outcomes: JSON.parse(r.outcomes) }, recomputed: { result_hash: recomputedHash, bets_hash: recomputedBetsHash, outcomes: recomputedAny }, steps })
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

// ------------------------------------------------------------------ API: 数据采集 & 分析
const analysisCache = new Map<string, { t: number; v: any }>()
// 数据写入 → 立刻清掉该源的分析缓存（保证「同步后即一致」）
onInvalidate((source) => { for (const k of [...analysisCache.keys()]) if (k.includes(source)) analysisCache.delete(k); invalidateArena(source) })
async function drawsFor(db: D1Database, source: string, limit = 1000) {
  if (source.startsWith('qkltj:')) await syncSource(db, source)
  return await loadDraws(db, source, limit)
}

app.get('/api/sources', async (c) => {
  const meta = (await c.env.DB.prepare('SELECT * FROM sync_meta').all<any>()).results
  const counts = (await c.env.DB.prepare('SELECT source, COUNT(*) n, MAX(open_ms) latest FROM draws GROUP BY source').all<any>()).results
  return c.json({ ok: true, sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, ...v, meta: meta.find(m => m.source === k) || null, count: counts.find(x => x.source === k)?.n || 0, latest: counts.find(x => x.source === k)?.latest || null })) })
})

app.post('/api/sync', async (c) => {
  const source = c.req.query('source')
  const targets = source && isSource(source) ? [source] : Object.keys(SOURCES).filter(s => s.startsWith('qkltj:'))
  const force = c.req.query('force') === '1'
  const out: any = {}
  for (const s of targets) out[s] = await syncSource(c.env.DB, s, force)
  const status: any = {}
  for (const s of targets) status[s] = await syncStatus(c.env.DB, s)
  return c.json({ ok: true, force, result: out, status })
})

/** 同步状态：最新期、下一期预计时间、审计结果、数据版本（前端状态条 & 手动同步按钮的依据） */
app.get('/api/sync/status', async (c) => {
  const source = c.req.query('source')
  const targets = source && isSource(source) ? [source] : Object.keys(SOURCES).filter(s => s.startsWith('qkltj:'))
  if (c.req.query('tick') === '1') for (const s of targets) { await syncSource(c.env.DB, s); await autoTrack(c.env.DB, s); await arenaTick(c.env.DB, s); if (await aiNeeded(c.env.DB, s)) bg(c, aiKick(c.env.DB, c.var.ai, s, 'page')) } // 顺带触发到点同步 + 战绩快照 + 竞技场生成/结算
  const status: any = {}
  for (const s of targets) status[s] = await syncStatus(c.env.DB, s)
  return c.json({ ok: true, status })
})

/** 哈希中被用作运算结果的 5 个数字字符下标（从尾部倒数 5 个 0-9 字符） */
function hashDigitIdx(hash: string): number[] {
  const idx: number[] = []
  for (let i = hash.length - 1; i >= 0 && idx.length < 5; i--) if (hash[i] >= '0' && hash[i] <= '9') idx.push(i)
  return idx.reverse()
}

/** 首页“统计结果”表：严格按 qkltj 接口字段输出（opennumber 为运算结果） */
app.get('/api/qkltj/table', async (c) => {
  const code = c.req.query('code') || '6001'
  const source = 'qkltj:' + code
  if (!isSource(source)) return bad(c, 'unknown code')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 30)))
  const rows = await drawsFor(c.env.DB, source, limit)
  const cfg = SOURCES[source]
  return c.json({
    ok: true, code, name: cfg.name, chain: cfg.chain, intervalMs: cfg.intervalMs, sync: await syncStatus(c.env.DB, source),
    rows: rows.map((d: any) => ({
      openTime: d.open_time || new Date(d.open_ms + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' '),
      expect: d.expect, block: d.block, hash: d.hash,
      opennumber: d.opennumber || [d.n1, d.n2, d.n3, d.n4, d.n5].join(','),
      lottoType: d.lotto_type, lottoTypeCn: d.lotto_type_cn, id: d.src_id,
      mismatch: d.mismatch || 0, highlight: hashDigitIdx(d.hash),
    })),
  })
})

/** 对账：本地五位厅 vs 官方 6001 逐期比对（同期号→同区块→同结果） */
app.get('/api/qkltj/reconcile', async (c) => {
  const limit = Math.min(200, Number(c.req.query('limit') || 30))
  const off = await drawsFor(c.env.DB, 'qkltj:6001', limit + 5)
  const loc = (await c.env.DB.prepare('SELECT * FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT ?').bind('local:five', limit + 5).all<any>()).results
  const lm = new Map(loc.map((d: any) => [d.expect, d]))
  const rows = off.slice(0, limit).map((o: any) => {
    const l = lm.get(o.expect)
    return { expect: o.expect, official: { block: o.block, opennumber: o.opennumber, openTime: o.open_time }, local: l ? { block: l.block, opennumber: l.opennumber || [l.n1, l.n2, l.n3, l.n4, l.n5].join(','), openTime: l.open_time } : null,
      match: l ? (l.block === o.block && l.hash === o.hash ? 'exact' : 'diff') : 'missing' }
  })
  const compared = rows.filter(r => r.local)
  return c.json({ ok: true, rule: '官方哈希分分彩：每分钟取 03 秒的 TRON 区块（区块时间戳秒位=03，相邻期区块号差=20），openTime 为该区块时间 +10~12s 的统计入库时间；hash=blockID；运算结果=去 a-f 后末 5 位',
    total: rows.length, compared: compared.length, exact: compared.filter(r => r.match === 'exact').length, rows })
})

/** 严格直通：原样转发 qkltj 接口（用于逐期一致性核对） */
app.get('/api/qkltj/raw', async (c) => {
  const code = c.req.query('code') || '6001'
  if (!isSource('qkltj:' + code)) return bad(c, 'unknown code')
  const rows = Math.min(1000, Math.max(1, Number(c.req.query('rows') || 1)))
  const res = await fetch(`https://api.qkltj.com/api/draw-result?code=${code}&rows=${rows}`, { headers: { accept: 'application/json' } })
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
})

app.get('/api/draws', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const limit = Math.min(1000, Number(c.req.query('limit') || 100))
  const rows = await drawsFor(c.env.DB, source, limit)
  return c.json({ ok: true, source, rows: rows.map(d => ({ ...d, outcomes: computeOutcomes5(d.hash) })) })
})

app.get('/api/analysis/markets', (c) => c.json({ ok: true, markets: MARKETS.map(m => ({ key: m.key, name: m.name, classes: m.classes, labels: m.labels })), mechanisms: MECHANISMS.map(m => ({ id: m.id, name: m.name, group: m.group, desc: m.desc })) }))

app.get('/api/analysis/stats', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const limit = Math.min(1000, Number(c.req.query('limit') || 1000))
  const rows = await drawsFor(c.env.DB, source, limit)
  return c.json({ ok: true, source, ...drawStats(rows as any) })
})

/** 核心：20 机制预测 + 回测 + 集成量化 */
app.get('/api/analysis/predict', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  const mk = c.req.query('market') || 'sum-size'
  if (!isSource(source)) return bad(c, 'unknown source')
  const m = marketByKey(mk); if (!m) return bad(c, 'unknown market')
  const limit = Math.min(1000, Number(c.req.query('limit') || 1000))
  const steps = Math.min(300, Number(c.req.query('steps') || 150))
  const rows = await drawsFor(c.env.DB, source, limit)
  const latest = rows[0]?.expect || ''
  const ck = `${source}|${mk}|${limit}|${steps}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 60_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const series = buildSeries(rows as any, m)
  const bt = backtest(series, m, steps)
  const en = ensemble(series, m, bt.res)
  const v = { ok: true, source, market: { key: m.key, name: m.name, classes: m.classes, labels: m.labels }, sample: series.seq.length, latest_expect: latest,
    backtest: { steps: bt.steps, baseline: bt.baseline, mechanisms: bt.res },
    ensemble: { p: en.p, top: en.top, top_label: m.labels[en.top], tilt: en.tilt, consensus: en.consensus, votes: en.votes, streak: en.streak, gaps: en.gaps, per: en.per.map(x => ({ id: x.id, name: x.name, pick: x.p.indexOf(Math.max(...x.p)), p: x.p, weight: x.weight })) },
    recent: series.seq.slice(-60), recent_expects: series.expects.slice(-60),
    disclaimer: '哈希结果为密码学随机数，回测命中率长期应收敛于基线。本分析仅为统计展示，不构成任何预测保证。' }
  analysisCache.set(ck, { t: now(), v }); if (analysisCache.size > 200) analysisCache.delete(analysisCache.keys().next().value!)
  return c.json(v)
})

/** 全市场概览：每个市场的集成倒向（轻量回测 60 步） */
app.get('/api/analysis/overview', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const rows = await drawsFor(c.env.DB, source, 600)
  const latest = rows[0]?.expect || ''
  const ck = `ov|${source}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 60_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const out = MARKETS.filter(m => !m.key.startsWith('pos-digit')).map(m => {
    const s = buildSeries(rows as any, m); const bt = backtest(s, m, 60); const en = ensemble(s, m, bt.res)
    const best = [...bt.res].sort((a, b) => b.acc - a.acc)[0]
    return { key: m.key, name: m.name, labels: m.labels, p: en.p, top: en.top, top_label: m.labels[en.top], tilt: en.tilt, consensus: en.consensus, streak: en.streak, best_mech: { name: best.name, acc: best.acc }, baseline: bt.baseline, avg_acc: bt.res.reduce((x, r) => x + r.acc, 0) / bt.res.length }
  })
  const v = { ok: true, source, sample: rows.length, latest_expect: latest, markets: out }
  analysisCache.set(ck, { t: now(), v })
  return c.json(v)
})

/** K 线：幸运数字出现频率 OHLC（用户自选数字 + 位置 + K 线粒度 + 滚动窗口） */
/** 单双 K 线 + BOLL/MACD/KDJ 预判（默认万位，最近 500 期） */
/** 量化选号器：Top-N 五位号码（可自定义数量）+ 复式方案 + 诚实回测 */
app.get('/api/analysis/pick', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const count = Math.max(10, Math.min(1000, Number(c.req.query('count') || 500)))  // 前三位空间 1000
  const steps = Math.max(20, Math.min(150, Number(c.req.query('steps') || 60)))
  const bt = Math.max(0, Math.min(60, Number(c.req.query('bt') ?? 20)))
  const wParity = Math.max(0, Math.min(1, Number(c.req.query('wp') ?? 0.6)))
  const wSize = Math.max(0, Math.min(1, Number(c.req.query('ws') ?? 0.4)))
  const wCombo = Math.max(0, Math.min(1, Number(c.req.query('wc') ?? 0.35)))
  const temp = Math.max(0.5, Math.min(3, Number(c.req.query('temp') ?? 1)))
  const rows = await drawsFor(c.env.DB, source, 600)
  const latest = rows[0]?.expect || ''
  const ck = `pick|${source}|${count}|${steps}|${bt}|${wParity}|${wSize}|${wCombo}|${temp}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 60_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const src = SOURCES[source as keyof typeof SOURCES]
  const t0 = now()
  const v: any = { ok: true, source, interval_ms: src.intervalMs, ...pick(rows as any, { count, steps, btSteps: bt, wParity, wSize, wCombo, temp }), compute_ms: 0 }
  v.compute_ms = now() - t0
  // 战绩追踪：默认参数下（wp/ws/wc 默认）把下一期 Top-N 快照锁定入库，开奖后自动评分
  if (wParity === 0.6 && wSize === 0.4 && wCombo === 0.35 && steps === 60) {
    try { v.tracked = await recordPick(c.env.DB, { source, next_expect: v.next_expect, latest_expect: v.latest_expect, count, temp, numbers: v.numbers.map((x: any) => x.no), coverage: v.coverage.p }) } catch (e: any) { v.track_error = String(e?.message || e) }
  }
  analysisCache.set(ck, { t: now(), v })
  return c.json(v)
})

/** 自动战绩快照：每期为固定预设（300/500 注 · 均衡）锁定 Top-N，不依赖有人打开分析页 */
const AUTO_TRACK = [{ count: 300, temp: 1.5 }, { count: 500, temp: 1.5 }]
const autoTracked = new Map<string, string>()   // source|count|temp → 已记录的期号（进程内去重，DB 侧还有 INSERT OR IGNORE）
async function autoTrack(db: D1Database, source: string) {
  const latest = (await db.prepare('SELECT expect FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT 1').bind(source).first<any>())?.expect
  if (!latest || !/^\d+$/.test(latest)) return
  const next = String(BigInt(latest) + 1n)
  let rows: any[] | null = null
  for (const cfg of AUTO_TRACK) {
    const k = `${source}|${cfg.count}|${cfg.temp}`
    if (autoTracked.get(k) === next) continue
    const exists = await db.prepare('SELECT 1 FROM pick_log WHERE source=? AND expect=? AND count=? AND temp=?').bind(source, next, cfg.count, cfg.temp).first()
    if (!exists) {
      rows ||= await loadDraws(db, source, 600)
      const r = pick(rows as any, { count: cfg.count, temp: cfg.temp, btSteps: 0 })
      await recordPick(db, { source, next_expect: r.next_expect, latest_expect: r.latest_expect, count: cfg.count, temp: cfg.temp, numbers: r.numbers.map(x => x.no), coverage: r.coverage.p })
    }
    autoTracked.set(k, next)
  }
}

/** 策略竞技场每期自动：结算已开奖 → 为下一期生成全部策略 500 注 → 顺带补齐最近漏掉的期（每 tick 最多 2 期，避免拖慢心跳）
 *  AI 选手的模型调用（6-15s）不在请求内等待：由 aiKick 放到 waitUntil 后台执行，页面请求只做毫秒级 DB 读写 */
const arenaBusy = new Set<string>()
async function arenaTick(db: D1Database, source: string) {
  if (arenaBusy.has(source)) return
  arenaBusy.add(source)
  try { const rows = await loadDraws(db, source, 800); const r = await autoArena(db, source, rows as any, 2); if (rows.length && await top3Round(db, source, (rows[0] as any).expect)) invalidateArena(source); if (r.generated) invalidateArena(source) }
  catch (e) { console.error('arena tick', e) }
  finally { arenaBusy.delete(source) }
}
/** 后台触发 AI 推理（进程内去重；INSERT OR IGNORE 兜底多实例）；返回 Promise 供 waitUntil */
const aiBusy = new Set<string>()
async function aiKick(db: D1Database, env: AiEnv, source: string, trigger = 'page') {
  if (!aiEnabled(env) || aiBusy.has(source)) return
  aiBusy.add(source)
  try {
    const rows = await loadDraws(db, source, 800)
    // 报单截止 = 下期理论开奖时刻 − AI_LEAD_MS（默认 20s）：留出足够的下单时间；超时则本期由兜底策略顶上
    const lockByMs = rows.length ? (rows[0] as any).open_ms + SOURCES[source].intervalMs - aiLeadMs(env) : undefined
    const done = await externalRound(db, source, rows as any, 'ai', async (ctx) => { const f = await forecastFor(db, env, source, ctx.next, ctx.hist, ctx.perf, ctx.weights, { lockByMs, trigger }); return f ? aiScores(f, ctx.vec, ctx.perf) : null }, parseCustomNs(env.AI_CUSTOM_N))
    if (done) invalidateArena(source)
  } catch (e) { console.error('ai kick', e) } finally { aiBusy.delete(source) }
}

/** ---------------- 服务端心跳：不依赖任何页面打开，按开奖节拍自己跑「同步 → 生成/结算 → AI 推理」 ----------------
 *  Cloudflare Pages 无 cron，这里用「每个到达的请求顺带续命」的方式：任何 /api 请求进来，若心跳链未在跑则用 waitUntil 起一条，
 *  链内按 HEARTBEAT_MS 轮询直到 HEARTBEAT_LIFE_MS 到期（Worker 隔离体存活期内持续）。本地 wrangler dev 下等价于常驻。
 *  每一跳只做：syncSource（受 dueInfo 节流，不到点不打网络）→ arenaTick → aiNeeded ? aiKick('heartbeat') */
const HEARTBEAT_MS = 2_000, HEARTBEAT_LIFE_MS = 20 * 60_000, GAP_CHECK_MS = 5 * 60_000
let heartbeatUntil = 0, lastGapCheck = 0, heartbeatTicks = 0, heartbeatStarted = 0, lastKeeperMs = 0
async function heartbeat(db: D1Database, baseEnv: AiEnv) {
  const until = Date.now() + HEARTBEAT_LIFE_MS; heartbeatUntil = until; if (!heartbeatStarted) heartbeatStarted = Date.now()
  while (Date.now() < until && heartbeatUntil === until) {
    heartbeatTicks++
    const env = await effectiveEnv(db, baseEnv)   // 每跳重新解析：/settings 改了 key / 模型 / 思考档立刻生效
    for (const s of Object.keys(SOURCES).filter(k => k.startsWith('qkltj:'))) {
      try {
        const r = await syncSource(db, s)
        if (!r.skipped) await arenaTick(db, s)
        // 只对刚有新开奖或 AI 缺失的期触发；aiKick 自带 busy 锁
        if (await aiNeeded(db, s)) aiKick(db, env, s, 'heartbeat')
        // 每 5 分钟：扫近 2 天漏期，链上补齐（每次 ≤10 期，串行、不阻塞主链路）
        if (Date.now() - lastGapCheck > GAP_CHECK_MS && SOURCES[s].chain === 'tron') { lastGapCheck = Date.now(); const g = await scanGaps(db, s, { days: 2 }); if (g.missing.length) { const r = await fillGapsFromChain(db, s, g.missing, 10); if (r.filled) { invalidateArena(s); console.log('gapfill', s, r.filled) } } }
      } catch (e) { console.error('heartbeat', s, e) }
    }
    await new Promise(r => setTimeout(r, HEARTBEAT_MS))
  }
}
const ensureHeartbeat = (c: any) => { if (Date.now() < heartbeatUntil - 60_000) return; heartbeatUntil = Date.now() + HEARTBEAT_LIFE_MS; bg(c, heartbeat(c.env.DB, c.env)) }
/**
 * Keeper 续命接口：由沙盒内独立 PM2 进程（keeper.cjs）每 15s 调一次，保证关掉所有网页后
 * 同步 → 结算 → AI 推理 → 档位学习 → 漏期补齐 仍持续运行。生产环境可用任何外部 uptime 监控打此接口。
 */
app.get('/api/keeper/tick', async (c) => {
  lastKeeperMs = Date.now()
  const db = c.env.DB
  const src: any[] = []
  for (const s of Object.keys(SOURCES).filter(k => k.startsWith('qkltj:'))) {
    const pend = await db.prepare(`SELECT expect FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NULL ORDER BY expect DESC LIMIT 1`).bind(s).first<any>()
    const last = await db.prepare(`SELECT expect, open_ms FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT 1`).bind(s).first<any>()
    src.push({ source: s, latest_draw: last?.expect || null, latest_open_ms: last?.open_ms || null, ai_pending: pend?.expect || null })
  }
  return c.json({ ok: true, now: Date.now(), heartbeat_alive: Date.now() < heartbeatUntil, heartbeat_left_s: Math.max(0, Math.round((heartbeatUntil - Date.now()) / 1000)), ticks: heartbeatTicks, up_since_ms: heartbeatStarted || null, sources: src })
})
/** 后台运行状态（给 /query 页顶部的“后台在跑”指示灯） */
app.get('/api/keeper/status', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  const db = c.env.DB
  const lastF = await db.prepare(`SELECT expect, created_ms, error, trigger FROM ai_forecasts WHERE source=? ORDER BY expect DESC LIMIT 1`).bind(source).first<any>()
  const today = await db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) ok FROM ai_forecasts WHERE source=? AND created_ms>?`).bind(source, Date.now() - 86400_000).first<any>()
  const scored = await db.prepare(`SELECT COUNT(*) n, SUM(hit) h FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL`).bind(source).first<any>()
  return c.json({ ok: true, source, now: Date.now(), heartbeat_alive: Date.now() < heartbeatUntil, heartbeat_left_s: Math.max(0, Math.round((heartbeatUntil - Date.now()) / 1000)), ticks: heartbeatTicks, up_since_ms: heartbeatStarted || null, keeper_last_ms: lastKeeperMs || null, keeper_alive: (lastKeeperMs > 0 && Date.now() - lastKeeperMs < 60_000) || (heartbeatStarted > 0 && Date.now() - heartbeatStarted < 30_000), keeper_warming: lastKeeperMs === 0, last_forecast: lastF ? { expect: lastF.expect, created_ms: lastF.created_ms, ok: !lastF.error, trigger: lastF.trigger } : null, forecasts_24h: { n: today?.n || 0, ok: today?.ok || 0 }, scored: { n: scored?.n || 0, hits: scored?.h || 0 } })
})
/** 是否需要为当前待开期跑 AI（无 forecast 记录时才需要；有 error 记录 = 本期已放弃） */
async function aiNeeded(db: D1Database, source: string) {
  const latest = (await db.prepare('SELECT expect FROM draws WHERE source=? ORDER BY expect DESC LIMIT 1').bind(source).first<any>())?.expect
  if (!latest) return false
  const next = nextOf(latest)
  const f = await db.prepare('SELECT 1 FROM ai_forecasts WHERE source=? AND expect=?').bind(source, next).first()
  return !f
}
const bg = (c: any, job: Promise<any>) => { try { c.executionCtx.waitUntil(job) } catch { /* 非 Worker 环境：让其自然完成 */ } }

/** 竞技场结果缓存：key 含数据版本 + 竞技场写入版本，TTL 30s；任何 arena 写入（生成/结算/AI 落库）都会 bump */
const arenaCache = new Map<string, { t: number; v: any }>()
const arenaVer = new Map<string, number>()
const invalidateArena = (source: string) => { arenaVer.set(source, (arenaVer.get(source) || 0) + 1); for (const k of [...arenaCache.keys()]) if (k.includes(source)) arenaCache.delete(k) }
async function cachedArena<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<{ v: T; cached: boolean; age: number }> {
  const hit = arenaCache.get(key); if (hit && now() - hit.t < ttl) return { v: hit.v, cached: true, age: now() - hit.t }
  const v = await fn(); arenaCache.set(key, { t: now(), v }); if (arenaCache.size > 100) arenaCache.delete(arenaCache.keys().next().value!)
  return { v, cached: false, age: 0 }
}

/** 自动报告节奏（实盘每 N 期一份；默认 0 = 关闭，只保留逐期推荐；需要时用 AI_REPORT_EVERY=30 开启） */
const reportEvery = (env: AiEnv & { AI_REPORT_EVERY?: string }) => { const n = Number(env.AI_REPORT_EVERY ?? 0); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0 }
const reportBusy = new Set<string>()
async function autoReport(db: D1Database, env: AiEnv, source: string, board: any) {
  const every = reportEvery(env as any); if (!every || reportBusy.has(source)) return
  const latest = board.periods.at(-1)?.expect; if (!latest) return
  const last = await latestReport(db, source)
  const liveSince = (await db.prepare(`SELECT COUNT(DISTINCT expect) n FROM arena_rounds WHERE source=? AND mode='live' AND scored_ms IS NOT NULL AND expect>?`).bind(source, last?.expect || '0').first<any>())?.n || 0
  if (last && liveSince < every) return
  if (!last && liveSince < 1) return
  reportBusy.add(source)
  try { await generateReport(db, env, source, board) } catch (e) { console.error('auto report', e) } finally { reportBusy.delete(source) }
}

// ---- 策略竞技场 API
app.get('/api/arena/board', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const mode = (c.req.query('mode') || 'all') as 'all' | 'live' | 'replay'
  const limit = Number(c.req.query('limit') || 200)
  const tm: Record<string, number> = {}; let tt = now()
  if (source.startsWith('qkltj:')) await syncSource(c.env.DB, source); tm.sync = now() - tt; tt = now()
  await arenaTick(c.env.DB, source); tm.tick = now() - tt; tt = now()      // 毫秒级：保证当前期基础策略已生成、已开奖期已结算
  const gen = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM arena_rounds WHERE source=? AND created_ms>?`).bind(source, now() - 3000).first<any>())?.n || 0
  if (gen) invalidateArena(source)
  if (await aiNeeded(c.env.DB, source)) bg(c, aiKick(c.env.DB, c.var.ai, source, 'board'))   // AI 推理放后台，不阻塞本请求
  tm.check = now() - tt
  const t0 = now()
  const key = `board|${source}|${mode}|${limit}|v${dataVersion(source)}|a${arenaVer.get(source) || 0}`
  const { v: r, cached, age } = await cachedArena(key, 30_000, async () => {
    const r = await arenaBoard(c.env.DB, source, { mode, limit, extraPlans: await aiExtraPlans(c.env.DB, source) })
    const retired = await aiPlansMaintain(c.env.DB, source, r)
    const ai = { enabled: aiEnabled(c.var.ai), model: aiEnabled(c.var.ai) ? aiModel(c.var.ai) : null, effort: aiEffort(c.var.ai), report_every: reportEvery(c.var.ai), history: await aiHistory(c.env.DB, source, 8), plans_retired_now: retired }
    return { ...r, ai }
  })
  if (aiEnabled(c.var.ai) && reportEvery(c.var.ai) > 0) bg(c, autoReport(c.env.DB, c.var.ai, source, r))
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, mode, ...r, cached, cache_age_ms: age, compute_ms: now() - t0, timing: { ...tm, board: now() - t0 } })
})

/** 本期 AI 推荐（轻量、极快）：只读 DB；AI 未就绪时 status=thinking 并在后台触发推理，前端轮询。history = 最近 N 期 AI 500 注 + 结算 */
/**
 * AI 逐期记录（紧凑版）：只回摘要列，不带 500 注号码 / 推理文本，可一次取 50/100/200/500/1000 期。
 * 每行：expect, actual, open_ms, hit, rank, pnl, regime, confidence, sub{tierKey:hit}；附该窗口各档位汇总。
 */
app.get('/api/ai/history', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const n = Math.max(10, Math.min(1000, Number(c.req.query('n') || 50)))
  const customNs = parseCustomNs(c.var.ai.AI_CUSTOM_N)
  const tiers = [...AI_SUBSETS.map(a => ({ key: a.key, n: a.n, custom: false })), ...customNs.map(x => ({ key: `ai-custom-${x}`, n: x, custom: true })), { key: 'ai', n: 500, custom: false }].sort((a, b) => a.n - b.n)
  const key = `aihist|${source}|${n}|c${c.var.ai.AI_CUSTOM_N || ''}|v${dataVersion(source)}|a${arenaVer.get(source) || 0}`
  const { v, cached, age } = await cachedArena(key, 20_000, async () => {
    const rows = (await c.env.DB.prepare(`SELECT a.expect, a.actual, a.hit, a.rank, a.pnl, a.created_ms, f.regime, f.confidence, f.error, d.open_ms
      FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect LEFT JOIN draws d ON d.source=a.source AND d.expect=a.expect
      WHERE a.source=? AND a.strategy='ai' AND a.scored_ms IS NOT NULL ORDER BY a.expect DESC LIMIT ?`).bind(source, n).all<any>()).results
    const sum: Record<string, { n: number; hits: number; pnl: number }> = {}
    for (const t of tiers) sum[t.key] = { n: 0, hits: 0, pnl: 0 }
    const history = rows.map(r => {
      const sub: Record<string, 0 | 1> = {}
      for (const t of tiers) { const hit = !!r.hit && r.rank != null && r.rank <= t.n; sub[t.key] = hit ? 1 : 0; sum[t.key].n++; if (hit) sum[t.key].hits++; sum[t.key].pnl += hit ? ARENA_ODDS - t.n : -t.n }
      return { expect: r.expect, actual: r.actual, open_ms: r.open_ms, hit: !!r.hit, rank: r.rank, pnl: r.pnl, regime: r.regime || null, confidence: r.confidence, fallback: !r.regime || !!r.error, sub }
    })
    const summary = tiers.map(t => { const s = sum[t.key]; const p = t.n / 1000; return { key: t.key, n_pick: t.n, custom: t.custom, n: s.n, hits: s.hits, rate: s.n ? Math.round(s.hits / s.n * 1000) / 1000 : null, breakeven: Math.round(t.n / ARENA_ODDS * 1000) / 1000, pnl: s.pnl, roi: s.n ? Math.round(s.pnl / (s.n * t.n) * 10000) / 10000 : null, z: s.n ? Math.round((s.hits - s.n * p) / Math.sqrt(s.n * p * (1 - p)) * 100) / 100 : null } })
    return { tiers: tiers.map(t => ({ key: t.key, n_pick: t.n, custom: t.custom })), history, summary }
  })
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, n, cached, cache_age_ms: age, ...v })
})
/**
 * 逐期命中查询：?expect=12位 | ?seq=4位当日序号(+可选 date) | ?date=YYYY-MM-DD | ?n=最近N期；&hit=1 只看命中
 * 返回同 /api/ai/history 的紧凑行 + tiers + summary
 */
app.get('/api/ai/query', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const q = { expect: (c.req.query('expect') || '').replace(/\D/g, ''), date: c.req.query('date') || '', n: Math.min(1000, Math.max(1, Number(c.req.query('n') || 100))), hit: c.req.query('hit') === '1' }
  const customNs = parseCustomNs(c.var.ai.AI_CUSTOM_N)
  const tiers = [...AI_SUBSETS.map(a => ({ key: a.key, n: a.n, custom: false })), ...customNs.map(x => ({ key: `ai-custom-${x}`, n: x, custom: true })), { key: 'ai', n: 500, custom: false }].sort((a, b) => a.n - b.n)
  const where: string[] = [`a.source=?`, `a.strategy='ai'`, `a.scored_ms IS NOT NULL`]; const args: any[] = [source]
  let mode = 'recent'
  if (q.expect.length === 12) { where.push('a.expect=?'); args.push(q.expect); mode = 'expect' }
  else if (q.expect.length >= 1 && q.expect.length <= 4) {
    // 当日序号：配合 date；无 date 则默认查有记录的最近一天
    const seq = q.expect.padStart(4, '0')
    let day = q.date.replace(/-/g, '')
    if (!day) { const last = await c.env.DB.prepare(`SELECT expect FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT 1`).bind(source).first<any>(); day = last ? String(last.expect).slice(0, 8) : '' }
    where.push('a.expect=?'); args.push(day + seq); mode = 'expect'
  } else if (q.date) { where.push('a.expect LIKE ?'); args.push(q.date.replace(/-/g, '') + '%'); mode = 'date' }
  if (q.hit) where.push('a.hit=1')
  const limit = mode === 'date' ? 1440 : q.n
  const rows = (await c.env.DB.prepare(`SELECT a.expect, a.actual, a.hit, a.rank, a.pnl, f.regime, f.confidence, f.error, d.open_ms
    FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect LEFT JOIN draws d ON d.source=a.source AND d.expect=a.expect
    WHERE ${where.join(' AND ')} ORDER BY a.expect DESC LIMIT ?`).bind(...args, limit).all<any>()).results
  const sum: Record<string, { n: number; hits: number; pnl: number }> = {}; for (const t of tiers) sum[t.key] = { n: 0, hits: 0, pnl: 0 }
  const history = rows.map(r => { const sub: Record<string, 0 | 1> = {}; for (const t of tiers) { const hit = !!r.hit && r.rank != null && r.rank <= t.n; sub[t.key] = hit ? 1 : 0; sum[t.key].n++; if (hit) sum[t.key].hits++; sum[t.key].pnl += hit ? ARENA_ODDS - t.n : -t.n }
    return { expect: r.expect, actual: r.actual, open_ms: r.open_ms, hit: !!r.hit, rank: r.rank, pnl: r.pnl, regime: r.regime || null, confidence: r.confidence, fallback: !r.regime || !!r.error, sub } })
  const summary = tiers.map(t => { const s = sum[t.key]; return { key: t.key, n_pick: t.n, custom: t.custom, n: s.n, hits: s.hits, rate: s.n ? Math.round(s.hits / s.n * 1000) / 1000 : null, breakeven: Math.round(t.n / ARENA_ODDS * 1000) / 1000, pnl: s.pnl } })
  return c.json({ ok: true, source, mode, query: q, tiers: tiers.map(t => ({ key: t.key, n_pick: t.n, custom: t.custom })), history, summary })
})
/**
 * 连挂风险统计：AI 各投注档位（100/150/自定义/300/500）出现「连续 ≥K 期不命中」的概率。
 *   理论：单期不中概率 q = 1 − N/1000；任意连续 K 期全挂 = q^K；一段连挂一旦开始、延续到 ≥K 期 = q^(K−1)
 *   实测：按时间顺序切分连挂段，统计 ≥K 段占全部连挂段比例、处于 ≥K 连挂中的期占比、每 100 期发生次数、最长/当前连挂、长度分布
 * ?source&n=（最近 N 期，默认全部）&k=4
 */
app.get('/api/ai/streaks', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const K = Math.max(2, Math.min(10, Number(c.req.query('k') || 4)))
  const nQ = Number(c.req.query('n') || 0)
  const customNs = parseCustomNs(c.var.ai.AI_CUSTOM_N)
  const tiers = [...AI_SUBSETS.map(a => ({ key: a.key, n: a.n, custom: false })), ...customNs.map(x => ({ key: `ai-custom-${x}`, n: x, custom: true })), { key: 'ai', n: 500, custom: false }].sort((a, b) => a.n - b.n)
  const key = `streaks|${source}|${nQ}|${K}|c${c.var.ai.AI_CUSTOM_N || ''}|a${arenaVer.get(source) || 0}`
  const { v, cached } = await cachedArena(key, 20_000, async () => {
    const sql = nQ > 0
      ? `SELECT hit, rank, expect FROM (SELECT hit, rank, expect FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT ?) ORDER BY expect ASC`
      : `SELECT hit, rank, expect FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL ORDER BY expect ASC`
    const rows = (nQ > 0 ? await c.env.DB.prepare(sql).bind(source, nQ).all<any>() : await c.env.DB.prepare(sql).bind(source).all<any>()).results
    const total = rows.length
    const r4 = (x: number) => Math.round(x * 10000) / 10000
    const out = tiers.map(t => {
      const q = 1 - t.n / 1000
      const runs: number[] = []; let cur = 0, longest = 0, hits = 0
      const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6+': 0 }
      for (const r of rows) {
        const hit = !!r.hit && r.rank != null && r.rank <= t.n
        if (hit) { hits++; if (cur) runs.push(cur); cur = 0 } else { cur++; if (cur > longest) longest = cur }
      }
      const current = cur; if (cur) runs.push(cur)   // 末尾未闭合的连挂也计入段
      for (const L of runs) dist[L >= 6 ? '6+' : String(L)]++
      const runsK = runs.filter(L => L >= K)
      const periodsInK = runsK.reduce((a, L) => a + L, 0)
      return {
        key: t.key, n_pick: t.n, custom: t.custom, periods: total, hits, rate: total ? r4(hits / total) : null,
        theory: { miss_p: r4(q), any_k_in_row: r4(Math.pow(q, K)), run_reaches_k: r4(Math.pow(q, K - 1)), expected_runs_k_per_100: r4(100 * (1 - q) * Math.pow(q, K)) },
        actual: { runs: runs.length, runs_k: runsK.length, run_reaches_k: runs.length ? r4(runsK.length / runs.length) : null, periods_in_k: periodsInK, periods_in_k_share: total ? r4(periodsInK / total) : null, runs_k_per_100: total ? r4(runsK.length / total * 100) : null, longest, current, dist },
      }
    })
    return { k: K, periods: total, first: rows[0]?.expect || null, last: rows[rows.length - 1]?.expect || null, tiers: out }
  })
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, ...v })
})
/**
 * 投注档位综合分析（/query「档位分析」面板）：
 *  对每个档位（100/150/300/450/500 + 自定义）用全部已结算 AI 记录：
 *   • 下一期命中概率：理论 p=N/1000；实测全量/近 100/近 30 命中率（Wilson 95% 区间）；条件概率 P(中 | 当前已连挂 c 期)——检验"长龙后更容易中"是否成立
 *   • 长龙机制：连挂段长度分布、长度 ≥L 段的存活率（实测 vs 理论 q），下一期终结当前连挂的概率
 *   • 连续进坑：从现在起再连挂 1/2/3/4 期的概率（理论与按实测命中率计算），以及 10 期内至少出现一次 ≥4 连挂的概率
 *   • 倍投模拟（每 10 期为一轮）：策略 A「命中后翻倍」——本期中 → 下期 ×2（若 AI 置信度≥阈值），再中继续，未中回 1；策略 B「挂后加码」（马丁 1-2-4，最多 3 级）；对比平注
 *  ?source&conf=0.6（倍投触发的 AI 置信度阈值，0 = 不看置信度）&round=10
 */
app.get('/api/ai/tier-analysis', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const CONF = Math.max(0, Math.min(1, Number(c.req.query('conf') ?? 0.6)))
  const ROUND = Math.max(5, Math.min(50, Number(c.req.query('round') || 10)))
  const customNs = parseCustomNs(c.var.ai.AI_CUSTOM_N)
  const tiers = [...AI_SUBSETS.map(a => ({ key: a.key, n: a.n, custom: false })), ...customNs.map(x => ({ key: `ai-custom-${x}`, n: x, custom: true })), { key: 'ai', n: 500, custom: false }].sort((a, b) => a.n - b.n)
  const key = `tieran|${source}|${CONF}|${ROUND}|c${c.var.ai.AI_CUSTOM_N || ''}|a${arenaVer.get(source) || 0}`
  const { v, cached } = await cachedArena(key, 20_000, async () => {
    const rows = (await c.env.DB.prepare(`SELECT a.expect, a.hit, a.rank, f.confidence FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect WHERE a.source=? AND a.strategy='ai' AND a.scored_ms IS NOT NULL ORDER BY a.expect ASC`).bind(source).all<any>()).results
    const T = rows.length
    const r4 = (x: number | null) => x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000
    const wilson = (h: number, n: number) => { if (!n) return null; const z = 1.96, p = h / n, d = 1 + z * z / n, ctr = p + z * z / (2 * n), sp = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return { lo: r4((ctr - sp) / d), hi: r4((ctr + sp) / d) } }
    // 下一期 AI 置信度（若已锁定）
    const nextF = await c.env.DB.prepare(`SELECT f.expect, f.confidence FROM ai_forecasts f WHERE f.source=? AND f.error IS NULL AND NOT EXISTS (SELECT 1 FROM arena_rounds a WHERE a.source=f.source AND a.expect=f.expect AND a.strategy='ai' AND a.scored_ms IS NOT NULL) ORDER BY f.expect DESC LIMIT 1`).bind(source).first<any>()
    const out = tiers.map(t => {
      const p0 = t.n / 1000, q0 = 1 - p0, be = t.n / 950
      const hits: boolean[] = rows.map(r => !!r.hit && r.rank != null && r.rank <= t.n)
      const H = hits.filter(Boolean).length
      const last = (k: number) => hits.slice(-k)
      const rate = (arr: boolean[]) => arr.length ? arr.filter(Boolean).length / arr.length : null
      // 当前连挂
      let cur = 0; for (let i = hits.length - 1; i >= 0 && !hits[i]; i--) cur++
      // 条件概率：在历史中"已连挂 c 期"之后下一期命中的频率（c = 0..6+）
      const cond: Record<string, { n: number; hits: number; rate: number | null }> = {}
      for (let c0 = 0; c0 <= 6; c0++) cond[c0 === 6 ? '6+' : String(c0)] = { n: 0, hits: 0, rate: null }
      let run = 0
      for (let i = 0; i < hits.length; i++) { const k = run >= 6 ? '6+' : String(run); cond[k].n++; if (hits[i]) cond[k].hits++; run = hits[i] ? 0 : run + 1 }
      for (const k of Object.keys(cond)) cond[k].rate = cond[k].n >= 5 ? r4(cond[k].hits / cond[k].n) : null
      // 连挂段与存活率：处于长度 ≥L 的段占比 → 挂了 L 期后继续挂的实测概率
      const runs: number[] = []; let rl = 0
      for (const h of hits) { if (h) { if (rl) runs.push(rl); rl = 0 } else rl++ } if (rl) runs.push(rl)
      const survive: { L: number; reached: number; continued: number; p_continue: number | null; theory: number }[] = []
      for (let L = 1; L <= 6; L++) { const reached = runs.filter(x => x >= L).length, continued = runs.filter(x => x > L).length; survive.push({ L, reached, continued, p_continue: reached >= 5 ? r4(continued / reached) : null, theory: r4(q0) as number }) }
      const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6+': 0 }; for (const L of runs) dist[L >= 6 ? '6+' : String(L)]++
      const longest = runs.length ? Math.max(...runs) : 0
      // 下一期命中概率的三种估计
      const pAll = rate(hits), p100 = rate(last(100)), p30 = rate(last(30))
      const pCond = cond[cur >= 6 ? '6+' : String(cur)].rate
      const pEst = pAll != null ? r4(0.5 * pAll + 0.3 * (p100 ?? pAll) + 0.2 * (p30 ?? pAll)) : r4(p0)   // 综合估计：全量 50% + 近 100 30% + 近 30 20%
      const qEst = 1 - (pEst ?? p0)
      // 连续进坑：从现在起再连挂 k 期
      const pit = [1, 2, 3, 4].map(k => ({ k, theory: r4(Math.pow(q0, k)), est: r4(Math.pow(qEst, k)) }))
      // 10 期内至少出现一次 ≥4 连挂（马氏链精确计算）
      const atLeastOneRun = (q: number, n: number, K: number) => { // 状态 = 当前连挂长度 0..K-1；到达 K 即吸收
        let st = new Array(K).fill(0); st[0] = 1; let absorbed = 0
        for (let i = 0; i < n; i++) { const nx = new Array(K).fill(0); for (let s = 0; s < K; s++) { if (!st[s]) continue; nx[0] += st[s] * (1 - q); if (s + 1 >= K) absorbed += st[s] * q; else nx[s + 1] += st[s] * q } st = nx }
        return absorbed
      }
      const pit10 = { theory: r4(atLeastOneRun(q0, ROUND, 4)), est: r4(atLeastOneRun(qEst, ROUND, 4)) }
      // ---------------- 倍投模拟（每 ROUND 期一轮，轮内独立，轮末清零）
      const ODDS = ARENA_ODDS, N = t.n
      const simulate = (mode: 'flat' | 'win-double' | 'loss-martin') => {
        let pnl = 0, staked = 0, maxDD = 0, peak = 0, doubled = 0, doubledHit = 0, roundsWin = 0, roundsN = 0, worstRound = 0
        for (let s = 0; s < hits.length; s += ROUND) {
          const seg = hits.slice(s, s + ROUND), segConf = rows.slice(s, s + ROUND).map(r => r.confidence)
          let mult = 1, rp = 0
          for (let i = 0; i < seg.length; i++) {
            const m = mode === 'flat' ? 1 : mult
            const stake = N * m; staked += stake
            const gain = seg[i] ? (ODDS - N) * m : -N * m
            pnl += gain; rp += gain
            if (m > 1) { doubled++; if (seg[i]) doubledHit++ }
            peak = Math.max(peak, pnl); maxDD = Math.max(maxDD, peak - pnl)
            if (mode === 'win-double') {
              // 命中 → 下期翻倍（若下一期 AI 置信度 ≥ CONF；CONF=0 则总是）；未中 → 回 1 倍
              const nextConf = segConf[i + 1]; const ok = CONF === 0 || (nextConf != null && nextConf >= CONF)
              mult = seg[i] && ok ? Math.min(mult * 2, 8) : 1
            } else if (mode === 'loss-martin') {
              mult = seg[i] ? 1 : Math.min(mult * 2, 4)   // 1-2-4 三级
            }
          }
          roundsN++; if (rp > 0) roundsWin++; worstRound = Math.min(worstRound, rp)
        }
        return { pnl, staked, roi: staked ? r4(pnl / staked) : null, max_drawdown: maxDD, rounds: roundsN, rounds_win: roundsWin, round_win_rate: roundsN ? r4(roundsWin / roundsN) : null, worst_round: worstRound, doubled_bets: doubled, doubled_hit: doubledHit, doubled_hit_rate: doubled ? r4(doubledHit / doubled) : null }
      }
      const sims = { flat: simulate('flat'), win_double: simulate('win-double'), loss_martin: simulate('loss-martin') }
      // 命中后下一期的实测命中率（倍投是否有依据）
      let afterHitN = 0, afterHitH = 0, afterHitConfN = 0, afterHitConfH = 0
      for (let i = 0; i + 1 < hits.length; i++) if (hits[i]) { afterHitN++; if (hits[i + 1]) afterHitH++; const cf = rows[i + 1].confidence; if (cf != null && cf >= CONF) { afterHitConfN++; if (hits[i + 1]) afterHitConfH++ } }
      return {
        key: t.key, n_pick: t.n, custom: t.custom, periods: T, hits: H, breakeven: r4(be),
        next: { theory: r4(p0), all: r4(pAll), ci_all: wilson(H, T), last100: r4(p100), last30: r4(p30), cond_after_current_streak: pCond, current_streak: cur, estimate: pEst, edge_vs_breakeven: pEst != null ? r4(pEst - be) : null, verdict: pEst == null ? 'n/a' : (pEst >= be + 0.02 && (pAll ?? 0) >= be - 0.01) ? 'favorable' : pEst >= be ? 'marginal' : 'unfavorable' },
        streak: { dist, longest, current: cur, cond, survive, end_now_p: pCond ?? r4(p0) },
        pit: { steps: pit, at_least_one_4run_in_round: pit10, round: ROUND },
        martingale: { conf_threshold: CONF, round: ROUND, after_hit: { n: afterHitN, hits: afterHitH, rate: afterHitN ? r4(afterHitH / afterHitN) : null }, after_hit_conf: { n: afterHitConfN, hits: afterHitConfH, rate: afterHitConfN ? r4(afterHitConfH / afterHitConfN) : null }, sims },
      }
    })
    return { periods: T, first: rows[0]?.expect || null, last: rows[T - 1]?.expect || null, next_forecast: nextF ? { expect: nextF.expect, confidence: nextF.confidence, double_ok: CONF === 0 || (nextF.confidence != null && nextF.confidence >= CONF) } : null, tiers: out }
  })
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, ...v })
})
/** 单期 AI 详情（展开时懒加载）：500 注号码、boost、推理、方案 */
app.get('/api/ai/history/:expect', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const expect = c.req.param('expect')
  const r = await c.env.DB.prepare(`SELECT a.expect, a.numbers, a.count, a.actual, a.hit, a.rank, a.pnl, a.created_ms, f.regime, f.confidence, f.reasoning, f.output, f.model, f.latency_ms, d.open_ms
    FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect LEFT JOIN draws d ON d.source=a.source AND d.expect=a.expect
    WHERE a.source=? AND a.strategy='ai' AND a.expect=?`).bind(source, expect).first<any>()
  if (!r) return bad(c, 'not found', 404)
  let o: any = null; try { o = JSON.parse(r.output) } catch {}
  c.header('Cache-Control', 'public, max-age=3600')
  return c.json({ ok: true, expect: r.expect, numbers: r.numbers, count: r.count, actual: r.actual, hit: !!r.hit, rank: r.rank, pnl: r.pnl, open_ms: r.open_ms, created_ms: r.created_ms, regime: r.regime, confidence: r.confidence, reasoning: r.reasoning, pick_plan: o?.pick_plan || '', boost: o?.boost || [], model: r.model, latency_ms: r.latency_ms })
})
app.get('/api/arena/pick', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  if (!aiEnabled(c.var.ai)) return c.json({ ok: false, error: 'AI 未配置（需 DEEPSEEK_API_KEY 或 OPENAI_API_KEY+OPENAI_BASE_URL）' }, 400)
  const hist = Math.min(60, Number(c.req.query('history') || 12))
  if (source.startsWith('qkltj:')) await syncSource(c.env.DB, source)
  await arenaTick(c.env.DB, source)
  const needAi = await aiNeeded(c.env.DB, source)
  if (needAi) bg(c, aiKick(c.env.DB, c.var.ai, source, 'pick'))
  const t0 = now()
  const key = `pick|${source}|${hist}|c${c.var.ai.AI_CUSTOM_N || ''}|v${dataVersion(source)}|a${arenaVer.get(source) || 0}`
  const { v, cached, age } = await cachedArena(key, 20_000, async () => {
    const db = c.env.DB
    const pend = (await db.prepare(`SELECT expect, strategy, based_on, numbers, count, coverage, weight FROM arena_rounds WHERE source=? AND scored_ms IS NULL ORDER BY expect DESC LIMIT 40`).bind(source).all<any>()).results
    const expect = pend[0]?.expect
    const current = expect ? { expect, based_on: pend[0].based_on, strategies: pend.filter(r => r.expect === expect) } : null
    const pick = await aiPick(db, source, current, c.var.ai.AI_CUSTOM_N)
    const st = await db.prepare(`SELECT COUNT(*) n, SUM(hit) h, SUM(pnl) pnl FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL`).bind(source).first<any>()
    const rows = (await db.prepare(`SELECT a.expect, a.numbers, a.count, a.actual, a.hit, a.rank, a.pnl, a.created_ms, f.regime, f.confidence, f.reasoning, f.output, d.open_ms
      FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect LEFT JOIN draws d ON d.source=a.source AND d.expect=a.expect
      WHERE a.source=? AND a.strategy='ai' AND a.scored_ms IS NOT NULL ORDER BY a.expect DESC LIMIT ?`).bind(source, hist).all<any>()).results
    const history = rows.map(r => { let o: any = null; try { o = JSON.parse(r.output) } catch {} const sub: Record<string, { hit: boolean; pnl: number }> = {}; for (const x of [...AI_SUBSETS.map(a => ({ key: a.key, n: a.n })), ...parseCustomNs(c.var.ai.AI_CUSTOM_N).map(n => ({ key: `ai-custom-${n}`, n }))]) sub[x.key] = { hit: !!r.hit && r.rank != null && r.rank <= x.n, pnl: (!!r.hit && r.rank != null && r.rank <= x.n) ? ARENA_ODDS - x.n : -x.n }
      return { expect: r.expect, numbers: r.numbers, count: r.count, actual: r.actual, hit: !!r.hit, rank: r.rank, pnl: r.pnl, open_ms: r.open_ms, regime: r.regime, confidence: r.confidence, reasoning: r.reasoning, pick_plan: o?.pick_plan || '', boost: o?.boost || [], subsets: sub } })
    // 最近 20 期命中序列（新→旧）供迷你条形图
    const streak = (await db.prepare(`SELECT hit FROM arena_rounds WHERE source=? AND strategy='ai' AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT 20`).bind(source).all<any>()).results.map(r => r.hit ? 1 : 0)
    // 报单同步：近 20 期 AI 是否在截止前锁定、平均锁定用时
    const sy = (await db.prepare(`SELECT f.created_ms, f.error, f.lock_by_ms, p.open_ms prev_open FROM ai_forecasts f LEFT JOIN draws p ON p.source=f.source AND p.expect=f.based_on WHERE f.source=? ORDER BY f.expect DESC LIMIT 20`).bind(source).all<any>()).results
    const okRows = sy.filter(r => !r.error && (!r.lock_by_ms || r.created_ms <= r.lock_by_ms))
    const lockSecs = sy.filter(r => !r.error && r.prev_open).map(r => (r.created_ms - r.prev_open) / 1000)
    const sync = { n: sy.length, in_time: okRows.length, avg_lock_s: lockSecs.length ? +(lockSecs.reduce((a, b) => a + b, 0) / lockSecs.length).toFixed(1) : null, max_lock_s: lockSecs.length ? +Math.max(...lockSecs).toFixed(1) : null, heartbeat_alive: Date.now() < heartbeatUntil }
    return { pick, record: st && st.n ? { n: st.n, hits: st.h || 0, rate: Math.round((st.h || 0) / st.n * 1000) / 1000, pnl: st.pnl || 0, streak } : null, history, sync }
  })
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, provider: aiProviderName(c.var.ai), model: aiModel(c.var.ai), effort: aiEffort(c.var.ai), lead_ms: aiLeadMs(c.var.ai), interval_ms: SOURCES[source].intervalMs, ...v, cached, cache_age_ms: age, compute_ms: now() - t0 })
})
/** 自校验：此刻直接拉上游 API 原始数据，与本库 draws、AI 推荐（待开期/历史结算）逐字段比对 */
app.get('/api/ai/self-check', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source) || !SOURCES[source].code) return bad(c, 'unknown or local source')
  const n = Math.min(30, Number(c.req.query('n') || 10))
  const t0 = now(); const db = c.env.DB
  let upstream: any[] = []; let upErr: string | null = null
  try { upstream = await fetchQkltj(SOURCES[source].code, n) } catch (e: any) { upErr = String(e.message || e) }
  const upMs = now() - t0
  // 顺带同步一次（到点才会真的打网络），保证比对的是最新态
  if (!upErr) { try { await syncSource(db, source); await arenaTick(db, source) } catch {} }
  const local = (await db.prepare('SELECT expect, opennumber, open_time, open_ms, block, hash FROM draws WHERE source=? ORDER BY expect DESC LIMIT ?').bind(source, n).all<any>()).results
  const ai = (await db.prepare(`SELECT a.expect, a.based_on, a.actual, a.hit, a.rank, a.scored_ms, a.created_ms, f.error FROM arena_rounds a LEFT JOIN ai_forecasts f ON f.source=a.source AND f.expect=a.expect WHERE a.source=? AND a.strategy='ai' ORDER BY a.expect DESC LIMIT ?`).bind(source, n + 1).all<any>()).results
  const byExpect = new Map(local.map(r => [r.expect, r]))
  const rows = upstream.map(u => {
    const l = byExpect.get(u.expect)
    const a = ai.find(x => x.expect === u.expect)
    const first3 = String(u.opennumber || '').split(',').slice(0, 3).join('')
    const diffs: string[] = []
    if (!l) diffs.push('本库缺此期')
    else { if (l.opennumber !== u.opennumber) diffs.push(`号码 ${l.opennumber}≠${u.opennumber}`); if (l.open_time !== u.openTime) diffs.push(`时间 ${l.open_time}≠${u.openTime}`); if (String(l.block) !== String(u.block)) diffs.push(`区块 ${l.block}≠${u.block}`); if (l.hash !== u.hash) diffs.push('hash 不一致') }
    if (a) { if (a.scored_ms && a.actual !== first3) diffs.push(`AI 结算实开 ${a.actual}≠${first3}`); if (!a.scored_ms) diffs.push('AI 该期未结算') }
    return { expect: u.expect, upstream: { opennumber: u.opennumber, openTime: u.openTime, block: u.block }, local: l ? { opennumber: l.opennumber, open_time: l.open_time, block: l.block } : null, ai: a ? { based_on: a.based_on, actual: a.actual, hit: !!a.hit, rank: a.rank, scored: !!a.scored_ms, locked_bj: new Date(a.created_ms + 8 * 3600_000).toISOString().slice(11, 19), error: a.error } : null, ok: diffs.length === 0, diffs }
  })
  // 待开期：AI 是否正指向「上游最新期 + 1」
  const latestUp = upstream[0]?.expect || null
  const pending = ai.find(x => !x.scored_ms)
  const expectedNext = latestUp ? nextOf(latestUp) : null
  const pendingOk = !!pending && pending.expect === expectedNext && pending.based_on === latestUp
  const localLatest = local[0]?.expect || null
  const summary = { upstream_latest: latestUp, local_latest: localLatest, in_sync: latestUp === localLatest, upstream_ms: upMs, upstream_error: upErr,
    compared: rows.length, all_match: rows.every(r => r.ok), mismatches: rows.filter(r => !r.ok).length,
    pending_expect: pending?.expect || null, pending_based_on: pending?.based_on || null, expected_next: expectedNext, pending_ok: pendingOk,
    server_now_bj: new Date(now() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' '), tz_note: '上游 openTime 为北京时间(UTC+8)；本库 open_ms 为对应 UTC 毫秒；页面按浏览器本地时区显示' }
  return c.json({ ok: true, source, summary, rows })
})

/** D 方案 · 注数回测：若每期只投该策略排名前 N 注（N=100..600），命中率 / 盈亏 / ROI 如何。
 *  用已结算期的 rank（命中位次）直接推算：rank ≤ N 即命中；pnl = hit ? 950 − N : −N。保本命中率 = N/950 */
app.get('/api/arena/stake-curve', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const keys = String(c.req.query('strategies') || 'ai,top3,meta,markov,quant,random').split(',').filter(Boolean).slice(0, 8)
  const Ns = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600]
  const limit = Math.min(3000, Number(c.req.query('limit') || 2000))
  const out: any[] = []
  for (const k of keys) {
    const rows = (await c.env.DB.prepare(`SELECT hit, rank, count FROM arena_rounds WHERE source=? AND strategy=? AND scored_ms IS NOT NULL ORDER BY expect DESC LIMIT ?`).bind(source, k, limit).all<any>()).results
    if (!rows.length) continue
    const curve = Ns.map(N => {
      // N > 该期实际注数时无法推断 → 只统计 count ≥ N 的期；N ≤ 500 时全部可用
      const usable = rows.filter(r => r.count >= N); const n = usable.length
      const hits = usable.filter(r => r.hit && r.rank != null && r.rank <= N).length
      const pnl = hits * (ARENA_ODDS - N) - (n - hits) * N
      const p = N / 1000, z = n ? (hits - n * p) / Math.sqrt(n * p * (1 - p)) : 0
      return { N, n, hits, rate: n ? +(hits / n).toFixed(4) : null, breakeven: +(N / ARENA_ODDS).toFixed(4), edge: n ? +((hits / n) - N / ARENA_ODDS).toFixed(4) : null, z: +z.toFixed(2), pnl, roi: n ? +(pnl / (n * N)).toFixed(4) : null }
    }).filter(x => x.n >= 30)
    const best = curve.slice().sort((a, b) => (b.roi ?? -9) - (a.roi ?? -9))[0] || null
    out.push({ strategy: k, periods: rows.length, curve, best_N: best?.N ?? null, best_roi: best?.roi ?? null })
  }
  return c.json({ ok: true, source, odds: ARENA_ODDS, strategies: out })
})
/** 开奖完整性：覆盖率报告 + 缺失期 */
app.get('/api/draws/coverage', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  return c.json({ ok: true, source, ...(await coverageReport(c.env.DB, source, Math.min(30, Number(c.req.query('days') || 7)))) })
})
/** 链上补齐缺失期（每次最多 max 期） */
app.post('/api/draws/gapfill', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const g = await scanGaps(c.env.DB, source, { days: Math.min(30, Number(c.req.query('days') || 7)) })
  if (!g.missing.length) return c.json({ ok: true, source, checked: g.checked, filled: 0, failed: 0, missing_total: 0 })
  const r = await fillGapsFromChain(c.env.DB, source, g.missing, Math.min(50, Number(c.req.query('max') || 20)))
  if (r.filled) { invalidateArena(source) }
  return c.json({ ok: true, source, checked: g.checked, ...r, missing_total: g.missing_total })
})
/** 拉取告警 */
app.get('/api/sync/alerts', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  const rows = (await c.env.DB.prepare(`SELECT id, kind, detail, created_ms, resolved_ms FROM sync_alerts WHERE source=? ORDER BY id DESC LIMIT 30`).bind(source).all<any>()).results
  return c.json({ ok: true, source, open: rows.filter(r => !r.resolved_ms).length, alerts: rows })
})

/** 报单同步审计：每期 AI 锁定时刻 vs 报单截止 vs 实际开奖；heartbeat 状态 */
app.get('/api/ai/sync-audit', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const n = Math.min(100, Number(c.req.query('n') || 30))
  const lead = aiLeadMs(c.var.ai), interval = SOURCES[source].intervalMs
  const rows = (await c.env.DB.prepare(`SELECT f.expect, f.model, f.latency_ms, f.error, f.created_ms, f.started_ms, f.lock_by_ms, f.trigger, d.open_ms AS target_open_ms, p.open_ms AS prev_open_ms, a.created_ms AS round_ms, a.hit
    FROM ai_forecasts f LEFT JOIN draws d ON d.source=f.source AND d.expect=f.expect LEFT JOIN draws p ON p.source=f.source AND p.expect=f.based_on LEFT JOIN arena_rounds a ON a.source=f.source AND a.expect=f.expect AND a.strategy='ai'
    WHERE f.source=? ORDER BY f.expect DESC LIMIT ?`).bind(source, n).all<any>()).results
  const items = rows.map(r => {
    const targetOpen = r.target_open_ms || (r.prev_open_ms ? r.prev_open_ms + interval : null)
    const lockBy = r.lock_by_ms || (targetOpen ? targetOpen - lead : null)
    const locked = !r.error
    return { expect: r.expect, model: r.model, trigger: r.trigger, hit: r.hit, error: r.error, latency_ms: r.latency_ms,
      started_after_prev_s: r.prev_open_ms && r.started_ms ? +((r.started_ms - r.prev_open_ms) / 1000).toFixed(1) : null,
      locked_after_prev_s: r.prev_open_ms ? +((r.created_ms - r.prev_open_ms) / 1000).toFixed(1) : null,
      margin_to_lock_s: lockBy ? +((lockBy - r.created_ms) / 1000).toFixed(1) : null,      // >0 = 截止前锁定
      margin_to_open_s: targetOpen ? +((targetOpen - r.created_ms) / 1000).toFixed(1) : null, // 距实际开奖余量
      ok: locked && (lockBy ? r.created_ms <= lockBy : true), drawn: !!r.target_open_ms, locked }
  })
  const scored = items.filter(x => x.drawn)
  const inTime = scored.filter(x => x.ok).length, aiOk = scored.filter(x => x.locked).length
  const margins = scored.filter(x => x.margin_to_open_s != null).map(x => x.margin_to_open_s!)
  const summary = { n: scored.length, locked_in_time: inTime, locked_in_time_rate: scored.length ? +(inTime / scored.length).toFixed(3) : null, ai_success: aiOk, fallback: scored.length - aiOk,
    margin_open_min_s: margins.length ? Math.min(...margins) : null, margin_open_avg_s: margins.length ? +(margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1) : null,
    lead_ms: lead, interval_ms: interval, heartbeat_alive: Date.now() < heartbeatUntil, heartbeat_left_s: Math.max(0, Math.round((heartbeatUntil - Date.now()) / 1000)) }
  return c.json({ ok: true, source, summary, items })
})

/** AI 建议回测方案：活跃 + 已退役（含规则文本、样本内/样本外战绩） */
app.get('/api/arena/plans', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const board = await arenaBoard(c.env.DB, source, { mode: 'all', limit: 600, extraPlans: await aiExtraPlans(c.env.DB, source) })
  const rows = await listAiPlans(c.env.DB, source, true)
  return c.json({ ok: true, source, active: board.plans.filter((p: any) => p.ai), retired: rows.filter(r => r.retired_ms).map(r => ({ id: r.id, name: r.name, report_expect: r.report_expect, rationale: r.rationale, created_ms: r.created_ms, retired_ms: r.retired_ms, retire_reason: r.retire_reason, rule: JSON.parse(r.rule) })), builtin: board.plans.filter((p: any) => !p.ai) })
})
app.post('/api/arena/plans/:id/retire', async (c) => {
  const id = Number(c.req.param('id')); if (!id) return bad(c, 'bad id')
  await c.env.DB.prepare('UPDATE ai_plans SET retired_ms=?, retire_reason=? WHERE id=? AND retired_ms IS NULL').bind(now(), '手动退役', id).run()
  return c.json({ ok: true, id })
})
/** AI 预测官逐期记录（推理 + 结算） */
app.get('/api/arena/ai', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const k = Math.max(1, Math.min(200, Number(c.req.query('limit') || 30)))
  return c.json({ ok: true, source, enabled: aiEnabled(c.var.ai), model: aiEnabled(c.var.ai) ? aiModel(c.var.ai) : null, history: await aiHistory(c.env.DB, source, k) })
})
/** AI 分析官阶段报告：GET 取最新；POST 基于当前战绩生成（同一结算期只生成一次） */
app.get('/api/arena/report', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const r = await latestReport(c.env.DB, source)
  return c.json({ ok: true, source, enabled: aiEnabled(c.var.ai), report: r || null })
})
app.post('/api/arena/report', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  if (!aiEnabled(c.var.ai)) return bad(c, 'AI 未配置（需 DEEPSEEK_API_KEY 或 OPENAI_API_KEY+OPENAI_BASE_URL）', 503)
  try {
    const board = await arenaBoard(c.env.DB, source, { mode: 'all', limit: 300, extraPlans: await aiExtraPlans(c.env.DB, source) })
    const r = await generateReport(c.env.DB, c.var.ai, source, board)
    return c.json({ ok: true, source, ...r })
  } catch (e: any) { return bad(c, 'AI 报告生成失败：' + (e.message || e), 502) }
})
app.get('/api/arena/strategies', (c) => c.json({ ok: true, count: ARENA_N, odds: ARENA_ODDS, min_hist: ARENA_MIN_HIST, strategies: STRATEGIES }))
app.get('/api/arena/round', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001', expect = c.req.query('expect') || '', strategy = c.req.query('strategy') || 'meta'
  if (!isSource(source)) return bad(c, 'unknown source')
  const r = await arenaRound(c.env.DB, source, expect, strategy)
  if (!r) return bad(c, 'round not found', 404)
  return c.json({ ok: true, ...r, numbers: (r.numbers as string).split(' ') })
})
/** 回放补齐：把最近 n 期没有记录的已开奖期按时间正序生成并结算（严格 walk-forward），每次最多 30 期 */
app.post('/api/arena/replay', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const n = Math.max(1, Math.min(30, Number(c.req.query('n') || 20)))
  const lookback = Math.max(n, Math.min(600, Number(c.req.query('lookback') || 300)))
  const t0 = now()
  const rows = await loadDraws(c.env.DB, source, lookback + ARENA_MIN_HIST + 5)
  await settleArena(c.env.DB, source)
  const replayed = await replayArena(c.env.DB, source, rows as any, n, lookback)
  if (replayed) invalidateArena(source)
  const remaining = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM draws d WHERE d.source=? AND NOT EXISTS (SELECT 1 FROM arena_rounds a WHERE a.source=d.source AND a.expect=d.expect AND a.strategy='meta') AND d.open_ms >= (SELECT MIN(open_ms) FROM (SELECT open_ms FROM draws WHERE source=? ORDER BY open_ms DESC LIMIT ?))`).bind(source, source, Math.min(lookback, rows.length - ARENA_MIN_HIST)).first<any>())?.n || 0
  return c.json({ ok: true, source, replayed, remaining: Math.max(0, remaining), compute_ms: now() - t0 })
})

// 选号器战绩：累计命中率 vs 理论基线（快照在开奖前锁定，开奖后自动评分）
app.get('/api/analysis/pick/track', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const count = Math.max(10, Math.min(1000, Number(c.req.query('count') || 500)))
  const temp = Math.max(0.5, Math.min(3, Number(c.req.query('temp') ?? 1)))
  const all = c.req.query('all') === '1'
  const limit = Number(c.req.query('limit') || 500)
  if (source.startsWith('qkltj:')) await syncSource(c.env.DB, source)  // 确保最新开奖已入库再评分
  const t0 = now()
  const r = await pickTrack(c.env.DB, source, { count, temp, all, limit })
  return c.json({ ok: true, source, count, temp, all, ...r, compute_ms: now() - t0 })
})

app.get('/api/analysis/parity', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const pos = Math.max(0, Math.min(4, Number(c.req.query('pos') ?? 0)))
  const bucket = Math.max(1, Math.min(20, Number(c.req.query('bucket') || 1)))
  const limit = Math.max(60, Math.min(1000, Number(c.req.query('limit') || 500)))
  const rows = await drawsFor(c.env.DB, source, limit)
  const latest = rows[0]?.expect || ''
  const ck = `pk|${source}|${pos}|${bucket}|${limit}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 30_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const src = SOURCES[source as keyof typeof SOURCES]
  const v = { ok: true, source, interval_ms: src.intervalMs, ...parityKline(rows as any, { pos, bucket }) }
  analysisCache.set(ck, { t: now(), v })
  return c.json(v)
})

app.get('/api/analysis/kline', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const digit = Math.max(0, Math.min(9, Number(c.req.query('digit') ?? 7)))
  const posQ = c.req.query('pos') ?? 'any'
  const pos: number | 'any' = posQ === 'any' ? 'any' : Math.max(0, Math.min(4, Number(posQ)))
  const bucket = Math.max(1, Math.min(50, Number(c.req.query('bucket') || 5)))
  const window = Math.max(5, Math.min(200, Number(c.req.query('window') || 20)))
  const limit = Math.min(1000, Number(c.req.query('limit') || 1000))
  const rows = await drawsFor(c.env.DB, source, limit)
  const latest = rows[0]?.expect || ''
  const ck = `kl|${source}|${digit}|${pos}|${bucket}|${window}|${limit}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 60_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const v = { ok: true, source, latest_expect: latest, ...kline(rows as any, { digit, pos, bucket, window }), markets: marketKlines(rows as any, bucket, window) }
  analysisCache.set(ck, { t: now(), v })
  return c.json(v)
})

/** 本期推荐：每个玩法全部候选的集成概率 + 幸运数字综合榜 + 预见性策略 */
app.get('/api/analysis/recommend', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const steps = Math.min(150, Number(c.req.query('steps') || 60))
  const rows = await drawsFor(c.env.DB, source, 600)
  const latest = rows[0]?.expect || ''
  const ck = `rc|${source}|${steps}|${latest}|v${dataVersion(source)}`
  const hit = analysisCache.get(ck); if (hit && now() - hit.t < 60_000) { c.header('X-Cache', 'HIT'); return c.json({ ...hit.v, cached: true, cached_ms: hit.t, cache_age_ms: now() - hit.t }) }
  const src = SOURCES[source as keyof typeof SOURCES]
  const nextExpect = latest && /^\d+$/.test(latest) ? String(BigInt(latest) + 1n) : ''
  const v = { ok: true, source, latest_expect: latest, next_expect: nextExpect, interval_ms: src.intervalMs, ...recommend(rows as any, steps) }
  analysisCache.set(ck, { t: now(), v })
  return c.json(v)
})

// ------------------------------------------------------------------ 页面
app.get('/', (c) => c.html(page()))
app.get('/analysis', (c) => c.html(analysisPage()))
app.get('/arena', (c) => c.html(arenaPage()))
app.get('/ai', (c) => c.html(aiPage()))
app.get('/settings', (c) => c.html(settingsPage()))
app.get('/top3', (c) => c.html(top3Page()))
app.get('/query', (c) => c.html(queryPage()))

/** AI 自学习摘要：每期喷给模型的 your_tier_performance（各档位真实战绩 + 命中位次分布），前端与审计都能看到模型“学到了什么” */
app.get('/api/ai/tier-digest', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const digest = await tierDigest(c.env.DB, source, '99999999999', parseCustomNs(c.var.ai.AI_CUSTOM_N))
  return c.json({ ok: true, source, custom_n: parseCustomNs(c.var.ai.AI_CUSTOM_N), digest })
})
/** 回填 AI 精选（100/150/300 注）历史 */
app.post('/api/ai/backfill-subsets', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const n = Math.min(500, Number(c.req.query('n') || 300))
  const done = await backfillAiSubsets(c.env.DB, source, n)
  const custom = await backfillCustomTiers(c.env.DB, source, parseCustomNs(c.var.ai.AI_CUSTOM_N), n)
  if (done || custom.periods) invalidateArena(source)
  return c.json({ ok: true, source, backfilled: done, custom })
})
/** 回放补齐 top3 历史（幂等；每次最多 N 期） */
app.post('/api/top3/backfill', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const n = Math.min(300, Number(c.req.query('n') || 100))
  const done = await top3Backfill(c.env.DB, source, n); if (done) invalidateArena(source)
  return c.json({ ok: true, source, backfilled: done })
})
/** 战绩榜优质策略推荐选号：前三名各 500 注 + 融合 500 注（strategy='top3'）+ 逐期战绩 */
app.get('/api/top3/pick', async (c) => {
  const source = c.req.query('source') || 'qkltj:6001'
  if (!isSource(source)) return bad(c, 'unknown source')
  const hist = Math.min(60, Number(c.req.query('history') || 12))
  if (source.startsWith('qkltj:')) await syncSource(c.env.DB, source)
  await arenaTick(c.env.DB, source)
  const t0 = now()
  const key = `top3|${source}|${hist}|v${dataVersion(source)}|a${arenaVer.get(source) || 0}`
  const { v, cached, age } = await cachedArena(key, 20_000, () => top3View(c.env.DB, source, hist))
  c.header('X-Cache', cached ? 'HIT' : 'MISS')
  return c.json({ ok: true, source, strategy: TOP3_KEY, interval_ms: SOURCES[source].intervalMs, ...v, cached, cache_age_ms: age, compute_ms: now() - t0 })
})

// ------------------------------------------------------------------ 配置中心：AI 供应商 key / 模型 / 报单窗口（存 D1，覆盖环境变量）
app.get('/api/config', async (c) => c.json({ ok: true, keys: CONFIG_KEYS, ...(await configView(c.env.DB, c.env)) }))
app.put('/api/config', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, string | null>
  const patch: Record<string, string | null> = {}
  for (const k of CONFIG_KEYS) if (k in body) patch[k] = body[k] == null ? null : String(body[k])
  // 数值项做基本校验
  if (patch.AI_LEAD_MS && !(Number(patch.AI_LEAD_MS) >= 5000 && Number(patch.AI_LEAD_MS) <= 120000)) return bad(c, 'AI_LEAD_MS 需在 5000–120000 毫秒之间')
  if (patch.AI_TIMEOUT_MS && !(Number(patch.AI_TIMEOUT_MS) >= 3000 && Number(patch.AI_TIMEOUT_MS) <= 90000)) return bad(c, 'AI_TIMEOUT_MS 需在 3000–90000 毫秒之间')
  if (patch.AI_PROVIDER && !['', 'deepseek', 'openai'].includes(patch.AI_PROVIDER)) return bad(c, 'AI_PROVIDER 只能是 deepseek / openai / 空')
  if (patch.DEEPSEEK_THINKING && !['', 'off', 'low', 'high', 'max'].includes(patch.DEEPSEEK_THINKING)) return bad(c, 'DEEPSEEK_THINKING 只能是 off / low / high / max')
  if (patch.AI_CUSTOM_N) { const ns = parseCustomNs(patch.AI_CUSTOM_N); if (!ns.length) return bad(c, 'AI_CUSTOM_N 需为 10–900 的整数（逗号分隔，最多 4 个，不能与 100/150/300/450/500 重复）'); patch.AI_CUSTOM_N = ns.join(',') }
  await saveConfig(c.env.DB, patch)
  // 自定义注数一旦定义：立即从 ai 主榜派生历史（N ≤ 500），让新档位不从零起步；下一期起由 AI 推理实时生成
  let custom_backfill: any = null
  if (patch.AI_CUSTOM_N) {
    const ns = parseCustomNs(patch.AI_CUSTOM_N)
    custom_backfill = {}
    for (const s of Object.keys(SOURCES)) { const r = await backfillCustomTiers(c.env.DB, s, ns, 400); if (r.periods) { invalidateArena(s); custom_backfill[s] = r } }
  }
  return c.json({ ok: true, custom_backfill, ...(await configView(c.env.DB, c.env)) })
})
/** 校验：body 可带未保存的草稿（含明文 key）临时覆盖后测试；不带则测当前生效配置 */
app.post('/api/config/validate', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, string>
  const base = await effectiveEnv(c.env.DB, c.env)
  const draft: any = { ...base }
  for (const k of CONFIG_KEYS) if (body[k] != null && body[k] !== '') draft[k] = String(body[k]).trim()
  // 若草稿明确选择了供应商但没填 key，则用已保存的 key
  const r = await validateProvider(draft, { rounds: Math.min(3, Number(body.rounds || 1)) })
  return c.json({ ok: true, result: r })
})

export default app
