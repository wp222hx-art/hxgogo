/**
 * HashPlay Keeper —— 沙盒内独立常驻进程（PM2 管理），与网页完全无关。
 * 每 15 秒打一次 /api/keeper/tick：
 *   1) 触发 /api/* 中间件的 ensureHeartbeat → 服务端心跳链持续续命（同步 → 结算 → AI 推理 → 档位学习 → 漏期补齐）
 *   2) 记录最近一次续命时刻，供 /query 页「后台在跑」指示灯
 * 若服务短暂不可用，指数退避重试，最长 60s；任何异常都不会让进程退出。
 */
const BASE = process.env.KEEPER_BASE || 'http://127.0.0.1:3000'
const EVERY = Number(process.env.KEEPER_EVERY_MS || 15_000)
let fails = 0, ticks = 0

async function tick() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(BASE + '/api/keeper/tick', { signal: ctrl.signal, headers: { 'x-keeper': '1' } })
    const j = await res.json().catch(() => ({}))
    fails = 0; ticks++
    if (ticks % 20 === 1) console.log(new Date().toISOString(), 'keeper ok', JSON.stringify({ hb: j.heartbeat_alive, left: j.heartbeat_left_s, ticks: j.ticks, latest: (j.sources || [])[0]?.latest_draw, pending: (j.sources || [])[0]?.ai_pending }))
  } catch (e) {
    fails++
    console.error(new Date().toISOString(), 'keeper fail #' + fails, String(e && e.message || e))
  } finally { clearTimeout(t) }
}

async function loop() {
  for (;;) {
    await tick()
    const wait = fails ? Math.min(60_000, EVERY * Math.pow(2, Math.min(fails, 3))) : EVERY
    await new Promise(r => setTimeout(r, wait))
  }
}
console.log('keeper start →', BASE, 'every', EVERY, 'ms')
loop()
