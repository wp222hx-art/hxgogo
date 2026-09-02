// ================= HashPlay 前端 =================
const $ = (id) => document.getElementById(id)
const LABEL = { odd: '单', even: '双', big: '大', small: '小', banker: '庄', player: '闲', tie: '和', digit: '数字', letter: '字母', dragon: '龙', tiger: '虎', leopard: '豹子', straight: '顺子', pair: '对子', mixed: '杂六' }
const TYPE_LABEL = { parity: '单双', size: '大小', bp: '庄闲', chartype: '字符', lucky: '幸运', sum: '总和', dragon: '龙虎', shape: '形态', pos: '定位胆', pos2: '定位' }
const POS = ['万', '千', '百', '十', '个']
const selLabel = (t, s) => { if (t === 'pos') { const [p, d] = s.split('-'); return POS[p] + '=' + d } if (t === 'pos2') { const [p, k] = s.split('-'); return POS[p] + LABEL[k] } return LABEL[s] ?? s }
const state = { room: 'tron', token: localStorage.getItem('hp_token'), chip: 100, meta: null, cur: null, last: null, lastSettledNo: null, offset: 0, history: [], trendType: 'parity', busy: false }

const api = axios.create({ baseURL: '/api' })
api.interceptors.request.use(cfg => { if (state.token) cfg.headers['X-Token'] = state.token; return cfg })

function toast(msg, ok = true) {
  const t = $('toast'); t.textContent = msg
  t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm shadow-xl ${ok ? 'bg-emerald-600' : 'bg-red-600'} text-white`
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2200)
}
const fmt = (n) => Number(n).toLocaleString()
const tm = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })

// ---------- 高亮哈希：末位 digit1 / digit2 ----------
function highlightHash(hash) {
  if (!hash) return ''
  const chars = hash.split('')
  if (state.room === 'five') {
    let found = 0
    for (let i = chars.length - 1; i >= 0 && found < 5; i--) if (chars[i] >= '0' && chars[i] <= '9') { found++; chars[i] = `<span class="hl-d1">${chars[i]}</span>` }
    return chars.join('')
  }
  let found = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]
    if (found < 2 && ch >= '0' && ch <= '9') { found++; chars[i] = `<span class="${found === 1 ? 'hl-d1' : 'hl-d2'}">${ch}</span>` }
  }
  return chars.join('')
}
function badges(o, status) {
  if (status === 'void') return `<span class="badge b-void">作废退款</span>`
  if (!o) return ''
  if (o.nums) {
    return `<span class="badge b-lucky text-lg tracking-widest">${o.nums.join(' ')}</span><span class="badge b-${o.sumSize}">和 ${o.sum} ${LABEL[o.sumSize]}</span><span class="badge b-${o.sumParity}">${LABEL[o.sumParity]}</span><span class="badge ${o.dragon === 'dragon' ? 'b-odd' : o.dragon === 'tiger' ? 'b-even' : 'b-tie'}">${LABEL[o.dragon]}</span><span class="badge b-void">${LABEL[o.shape]}</span>`
  }
  const b = []
  if (o.parity) b.push(`<span class="badge b-${o.parity}">${LABEL[o.parity]}</span>`)
  if (o.size) b.push(`<span class="badge b-${o.size}">${LABEL[o.size]}</span>`)
  if (o.bp) b.push(`<span class="badge b-${o.bp}">${LABEL[o.bp]}</span>`)
  b.push(`<span class="badge b-${o.chartype}">${LABEL[o.chartype]}</span>`)
  if (o.lucky !== null) b.push(`<span class="badge b-lucky">幸运 ${o.lucky}</span>`)
  return b.join('')
}

// ---------- 账户 ----------
async function ensureUser() {
  if (state.token) {
    try { const r = await api.get('/me'); renderUser(r.data.user); return } catch { state.token = null; localStorage.removeItem('hp_token') }
  }
  const r = await api.post('/auth/guest', {})
  state.token = r.data.token; localStorage.setItem('hp_token', state.token); renderUser(r.data.user)
  toast(`欢迎！已发放 ${fmt(r.data.user.balance)} 虚拟积分`)
}
function renderUser(u) {
  if (!u) return
  state.user = u
  $('user-nick').textContent = u.nickname
  const bal = $('user-balance'); if (bal.textContent !== fmt(u.balance)) { bal.textContent = fmt(u.balance); bal.classList.add('flash'); setTimeout(() => bal.classList.remove('flash'), 600) }
  $('relief-btn').classList.toggle('hidden', u.balance >= state.meta.limits.reliefBelow)
}

// ---------- 状态轮询 ----------
async function poll() {
  try {
    const r = await api.get('/state', { params: { room: state.room } })
    const d = r.data
    state.offset = d.server_time - Date.now()
    state.cur = d.current; state.pool = d.pool; state.myBets = d.my_bets
    if (d.user) renderUser(d.user)
    if (d.last && d.last.round_no !== state.lastSettledNo) {
      const first = state.lastSettledNo === null
      state.lastSettledNo = d.last.round_no; state.last = d.last; renderLast(d.last, !first)
      if (!first) { loadHistory(); loadLeaderboard() }
    }
    renderRound(); renderMyBets()
  } catch (e) { console.error(e) }
}
function renderRound() {
  const c = state.cur; if (!c) return
  $('round-no').textContent = c.round_no
  const cb = $('commit-box'); if (c.commitment) { cb.classList.remove('hidden'); $('commit-val').textContent = c.commitment } else cb.classList.add('hidden')
}
function renderMyBets() {
  document.querySelectorAll('.bet-btn .mine').forEach(e => e.remove())
  const box = $('my-bets'); const mb = state.myBets || []
  if (!mb.length) { box.innerHTML = '<span class="text-slate-600">本局尚未下注</span>'; return }
  const agg = {}
  for (const b of mb) { const k = b.bet_type + ':' + b.selection; agg[k] = (agg[k] || 0) + b.amount }
  box.innerHTML = '<span class="text-slate-500">本局已投：</span>' + Object.entries(agg).map(([k, v]) => {
    const [t, s] = k.split(':'); const btn = document.querySelector(`.bet-btn[data-t="${t}"][data-s="${s}"]`)
    if (btn) btn.insertAdjacentHTML('beforeend', `<span class="mine">${fmt(v)}</span>`)
    return `<span class="bg-slate-800 px-2 py-0.5 rounded">${TYPE_LABEL[t]}·${selLabel(t, s)} <b class="text-amber-400">${fmt(v)}</b></span>`
  }).join('')
}
function renderLast(r, animate) {
  $('last-no').textContent = r.round_no
  $('last-block').innerHTML = r.block_number ? `<a class="text-cyan-400 hover:underline" target="_blank" href="https://tronscan.org/#/block/${r.block_number}">区块 #${r.block_number} <i class="fas fa-arrow-up-right-from-square text-[10px]"></i></a>` : ''
  const h = $('last-hash')
  if (r.status === 'void') { h.innerHTML = '<span class="text-slate-500">本局未能取得区块，已作废退款</span>' }
  else if (animate) {
    // 滚动动画
    let n = 0; const target = r.result_hash
    const iv = setInterval(() => {
      n++
      h.innerHTML = target.split('').map((ch, i) => i < n * 6 ? ch : '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
      if (n * 6 >= target.length) { clearInterval(iv); h.innerHTML = highlightHash(target); $('last-badges').innerHTML = badges(r.outcomes, r.status); settleToast(r) }
    }, 50)
    return
  } else h.innerHTML = highlightHash(r.result_hash)
  $('last-badges').innerHTML = badges(r.outcomes, r.status)
}
async function settleToast(r) {
  try {
    const me = await api.get('/my/bets', { params: { limit: 30 } })
    const mine = me.data.rows.filter(b => b.room === r.room && b.round_no === r.round_no)
    if (!mine.length) return
    const bet = mine.reduce((s, b) => s + b.amount, 0), pay = mine.reduce((s, b) => s + b.payout, 0)
    const net = pay - bet
    toast(net > 0 ? `🎉 第 ${r.round_no} 局净赢 +${fmt(net)}` : net === 0 ? `第 ${r.round_no} 局 退还/持平` : `第 ${r.round_no} 局 -${fmt(-net)}`, net >= 0)
  } catch {}
}

// ---------- 倒计时（本地每 250ms） ----------
function tickCountdown() {
  const c = state.cur; if (!c) return
  const now = Date.now() + state.offset
  const cd = $('countdown'), pl = $('phase-label'), pg = $('progress')
  const total = c.end_ms - c.start_ms
  const betting = now < c.close_ms
  const remain = Math.max(0, (betting ? c.close_ms : c.end_ms) - now)
  cd.textContent = (remain / 1000).toFixed(1)
  cd.className = `font-mono text-4xl font-bold tabular-nums ${betting ? 'text-emerald-400' : 'text-amber-400'} ${betting && remain < 3000 ? 'countdown-warn' : ''}`
  pl.textContent = betting ? '下注中' : (now < c.end_ms ? '已封盘 · 等待区块' : '开奖中…')
  pg.style.width = Math.min(100, (now - c.start_ms) / total * 100) + '%'
  pg.className = `h-full transition-all duration-200 ease-linear ${betting ? 'bg-emerald-500' : 'bg-amber-500'}`
  document.querySelectorAll('.bet-btn').forEach(b => b.disabled = !betting || state.busy)
  if (now >= c.end_ms + 300 && !state._settlePolling) { state._settlePolling = true; poll().finally(() => setTimeout(() => state._settlePolling = false, 1200)) }
}

// ---------- 下注 ----------
async function placeBet(t, s) {
  if (state.busy) return; state.busy = true
  try {
    const r = await api.post('/bet', { room: state.room, bet_type: t, selection: s, amount: state.chip })
    $('user-balance').textContent = fmt(r.data.balance)
    state.myBets = [...(state.myBets || []), { bet_type: t, selection: s, amount: state.chip }]
    renderMyBets()
    toast(`已投 ${TYPE_LABEL[t]}·${selLabel(t, s)} ${fmt(state.chip)}`)
  } catch (e) { toast(e.response?.data?.error || '下注失败', false) }
  finally { state.busy = false }
}

// ---------- 历史 / 走势 / 统计 ----------
async function loadHistory() {
  const [h, s] = await Promise.all([api.get('/history', { params: { room: state.room, limit: 60 } }), api.get('/stats', { params: { room: state.room } })])
  state.history = h.data.rows
  renderTrend(); renderHistory(); renderStats(s.data)
}
function renderHistory() {
  $('history-list').innerHTML = state.history.map(r => `
    <div class="hist-row" data-no="${r.round_no}">
      <span class="font-mono text-slate-400">#${String(r.round_no).slice(-6)}</span>
      <span class="hist-hash">${r.status === 'void' ? '<i class="text-slate-500">作废</i>' : r.outcomes?.nums ? '<b class="tracking-widest">' + r.outcomes.nums.join(' ') + '</b>' : '…' + r.result_hash.slice(-14, -2) + '<b>' + r.result_hash.slice(-2) + '</b>'}</span>
      <span class="flex gap-1">${r.status === 'void' ? '' : r.outcomes?.nums ? [['sumSize', r.outcomes.sumSize], ['sumParity', r.outcomes.sumParity], ['dragon', r.outcomes.dragon]].map(([k, v]) => `<span class="badge ${v === 'dragon' ? 'b-odd' : v === 'tiger' ? 'b-even' : 'b-' + v} !px-1.5 !py-0.5 !text-[10px]">${LABEL[v]}</span>`).join('') : ['parity', 'size', 'bp'].map(k => r.outcomes[k] ? `<span class="badge b-${r.outcomes[k]} !px-1.5 !py-0.5 !text-[10px]">${LABEL[r.outcomes[k]]}</span>` : '').join('')}</span>
    </div>`).join('') || '<div class="text-slate-600">暂无记录</div>'
}
const TREND_CLS = { odd: 't-red', big: 't-red', banker: 't-red', letter: 't-red', dragon: 't-red', even: 't-blue', small: 't-blue', player: 't-blue', digit: 't-blue', tiger: 't-blue', tie: 't-green' }
function renderTrend() {
  const rows = [...state.history].reverse().filter(r => r.status === 'settled')
  // 大路：同色连续纵向排列，换色换列
  const cols = []; let prev = null
  for (const r of rows) {
    const v = r.outcomes[state.trendType]; if (!v) continue
    const key = v === 'tie' ? prev : v
    if (v !== 'tie' && (v !== prev || cols[cols.length - 1].length >= 6)) cols.push([])
    if (!cols.length) cols.push([])
    cols[cols.length - 1].push(v); if (v !== 'tie') prev = v
  }
  const flat = cols.slice(-16).flatMap(col => { const c = [...col]; while (c.length < 6) c.push(null); return c })
  $('trend-grid').innerHTML = flat.map(v => v ? `<div class="trend-cell ${TREND_CLS[v]}" title="${LABEL[v]}">${LABEL[v]}</div>` : '<div class="trend-cell"></div>').join('')
}
function renderStats(s) {
  const c = s.counts; const n = s.sample || 1
  if (state.room === 'five') {
    const bar = (label, a, b, ca, cb) => { const pa = Math.round((a / n) * 100), pb = Math.round((b / n) * 100)
      return `<div><div class="flex justify-between text-slate-400 mb-0.5"><span>${label}</span><span>${a} : ${b}</span></div><div class="flex h-2 rounded overflow-hidden bg-slate-800"><div class="${ca}" style="width:${pa}%"></div><div class="${cb}" style="width:${pb}%"></div></div></div>` }
    $('stats-bar').innerHTML = `<div class="text-slate-500 mb-1">近 ${s.sample} 局分布</div>` + bar('和 大/小', c.sumSize?.big || 0, c.sumSize?.small || 0, 'bg-red-600', 'bg-blue-600') + bar('和 单/双', c.sumParity?.odd || 0, c.sumParity?.even || 0, 'bg-red-600', 'bg-blue-600') + bar('龙/虎', c.dragon?.dragon || 0, c.dragon?.tiger || 0, 'bg-red-600', 'bg-blue-600') + `<div class="text-slate-500">和局 ${c.dragon?.tie || 0} · 豹子 ${c.shape?.leopard || 0} · 顺子 ${c.shape?.straight || 0} · 对子 ${c.shape?.pair || 0}</div><a href="/analysis?source=local:five" class="block mt-2 text-cyan-400 hover:underline"><i class="fas fa-chart-line mr-1"></i>进入 20 机制量化分析 →</a>`
    return
  }
  const bar = (label, a, b, ca, cb) => { const pa = Math.round((a / n) * 100), pb = Math.round((b / n) * 100)
    return `<div><div class="flex justify-between text-slate-400 mb-0.5"><span>${label}</span><span>${a} : ${b}</span></div><div class="flex h-2 rounded overflow-hidden bg-slate-800"><div class="${ca}" style="width:${pa}%"></div><div class="${cb}" style="width:${pb}%"></div></div></div>` }
  $('stats-bar').innerHTML = `<div class="text-slate-500 mb-1">近 ${s.sample} 局分布（历史不预测未来）</div>` +
    bar('单 / 双', c.parity.odd || 0, c.parity.even || 0, 'bg-red-600', 'bg-blue-600') +
    bar('大 / 小', c.size.big || 0, c.size.small || 0, 'bg-red-600', 'bg-blue-600') +
    bar('庄 / 闲', c.bp.banker || 0, c.bp.player || 0, 'bg-red-600', 'bg-blue-600') + `<div class="text-slate-500">和局 ${c.bp.tie || 0} 次</div>`
}
async function loadLeaderboard() {
  const r = await api.get('/leaderboard')
  $('leaderboard').innerHTML = r.data.rows.map((u, i) => `<div class="flex justify-between ${u.nickname === state.user?.nickname ? 'text-amber-400' : ''}"><span><span class="inline-block w-5 text-slate-500">${i + 1}</span>${u.nickname}</span><span class="font-mono">${fmt(u.balance)}</span></div>`).join('') || '<div class="text-slate-600">暂无</div>'
}

// ---------- 验证弹窗 ----------
async function openVerify(no) {
  $('verify-modal').classList.remove('hidden'); $('v-no').textContent = no
  $('verify-body').innerHTML = '<div class="text-slate-500">加载中…</div>'
  try {
    const r = (await api.get(`/verify/${state.room}/${no}`)).data
    if (r.status !== 'settled') { $('verify-body').innerHTML = `<div class="step">${r.message || r.status}${r.commitment ? `<div class="val">承诺值：${r.commitment}</div>` : ''}</div>`; return }
    const o = r.stored.outcomes
    $('verify-body').innerHTML = `
      <div class="rounded-lg p-3 ${r.consistent ? 'bg-emerald-900/40 border border-emerald-700' : 'bg-red-900/40 border border-red-700'}">
        <i class="fas ${r.consistent ? 'fa-circle-check text-emerald-400' : 'fa-triangle-exclamation text-red-400'} mr-2"></i>
        ${r.consistent ? '服务端重算与存储结果完全一致，本局结果可信' : '重算结果与存储不一致！'}
      </div>
      ${r.steps.map(s => `<div class="step"><div class="font-bold text-slate-200">Step ${s.step} · ${s.title}</div><div class="text-slate-400 text-xs mt-1">${s.detail}</div>
        <div class="val">${s.value}${s.link ? ` <a class="text-amber-400 ml-2" target="_blank" href="${s.link}">Tronscan ↗</a>` : ''}</div></div>`).join('')}
      <div class="step"><div class="font-bold">最终哈希与取数</div><div class="val text-base">${highlightHash(r.stored.result_hash)}</div>
        <div class="flex flex-wrap gap-2 mt-2">${badges(o, 'settled')}</div>
        <div class="text-xs text-slate-500 mt-2"><span class="hl-d1">黄</span> = 末位数字 digit1（单双/大小/闲/幸运）　<span class="hl-d2">红</span> = 倒数第二个数字 digit2（庄）　庄 &gt; 闲 → 庄赢；相等 → 和</div></div>
      <details class="text-xs text-slate-500"><summary class="cursor-pointer">离线复算方法</summary>
        <pre class="bg-black/40 rounded p-2 mt-2 overflow-x-auto">${state.room === 'tron'
          ? `// 任何区块浏览器查询区块 #${r.stored.result_hash && (r.steps[0]?.value || '')}\n// 取 blockID 作为 result_hash，然后：\nconst digits = [...result_hash].reverse().filter(c => /[0-9]/.test(c))\ndigit1 = digits[0]; digit2 = digits[1]`
          : `// Node.js\nconst crypto = require('crypto')\nconsole.log(crypto.createHash('sha256').update(server_seed).digest('hex') === commitment)\nconst bets_hash = crypto.createHash('sha256').update(sorted_bet_ids.join(',')).digest('hex')\nconst result = crypto.createHmac('sha256', server_seed).update('${state.room}:${no}:' + bets_hash).digest('hex')`}</pre></details>`
  } catch (e) { $('verify-body').innerHTML = `<div class="text-red-400">${e.response?.data?.error || '加载失败'}</div>` }
}

// ---------- 个人中心 ----------
async function openMe() {
  $('me-modal').classList.remove('hidden')
  const [me, bets] = await Promise.all([api.get('/me'), api.get('/my/bets', { params: { limit: 100 } })])
  const u = me.data.user
  const stat = (l, v) => `<div class="bg-slate-800 rounded-lg p-2"><div class="text-slate-500">${l}</div><div class="font-mono font-bold text-amber-400 mt-0.5">${fmt(v)}</div></div>`
  $('me-stats').innerHTML = stat('余额', u.balance) + stat('累计投注', u.total_bet) + stat('累计净赢', u.total_win) + stat('注数', u.bet_count)
  $('me-bets').innerHTML = bets.data.rows.map(b => `<div class="flex justify-between bg-slate-800/60 rounded px-2 py-1">
    <span class="text-slate-400">${tm(b.created_ms)} <span class="text-slate-600">${b.room}</span> #${String(b.round_no).slice(-6)}</span>
    <span>${TYPE_LABEL[b.bet_type]}·${LABEL[b.selection] ?? b.selection} <span class="font-mono">${fmt(b.amount)}</span></span>
    <span class="font-mono ${b.status === 'win' ? 'text-emerald-400' : b.status === 'lose' ? 'text-red-400' : 'text-slate-400'}">${b.status === 'pending' ? '待开' : b.status === 'win' ? '+' + fmt(b.payout - b.amount) : b.status === 'refund' ? '退款' : '-' + fmt(b.amount)}</span></div>`).join('') || '<div class="text-slate-600">暂无投注</div>'
}

// ---------- 切换房间 ----------
function switchRoom(room) {
  state.room = room; state.cur = null; state.last = null; state.lastSettledNo = null
  document.querySelectorAll('.room-tab').forEach(b => b.classList.toggle('active', b.dataset.room === room))
  $('room-name').textContent = state.meta.rooms[room].name; $('room-desc').textContent = state.meta.rooms[room].desc
  $('last-hash').textContent = '等待开奖…'; $('last-badges').innerHTML = ''; $('last-block').innerHTML = ''
  const five = room === 'five'
  $('bet-grid').classList.toggle('hidden', five); $('bet-grid-five').classList.toggle('hidden', !five)
  document.querySelectorAll('#trend-type .five-only').forEach(o => o.hidden = !five)
  document.querySelectorAll('#trend-type option:not(.five-only)').forEach(o => o.hidden = five)
  state.trendType = five ? 'sumSize' : 'parity'; $('trend-type').value = state.trendType
  poll(); loadHistory()
}

// ---------- 事件绑定 ----------
function bind() {
  $('lucky-row').innerHTML = [...Array(10).keys()].map(i => `<button class="bet-btn lucky" data-t="lucky" data-s="${i}">${i}</button>`).join('')
  $('pos2-grid').innerHTML = POS.map((p, i) => `<div class="flex flex-col gap-1"><div class="text-center text-xs text-slate-400">${p}位</div>${['big', 'small', 'odd', 'even'].map(k => `<button class="bet-btn !py-1.5 !text-xs ${k === 'big' || k === 'odd' ? 'red' : 'blue'}" data-t="pos2" data-s="${i}-${k}">${LABEL[k]}</button>`).join('')}</div>`).join('')
  state.posSel = 0
  const renderPos = () => { $('pos-tabs').innerHTML = POS.map((p, i) => `<button class="chip ${i === state.posSel ? 'active' : ''}" data-p="${i}">${p}位</button>`).join(''); document.querySelectorAll('#pos-tabs .chip').forEach(b => b.onclick = () => { state.posSel = +b.dataset.p; renderPos() })
    $('pos-grid').innerHTML = [...Array(10).keys()].map(d => `<button class="bet-btn lucky" data-t="pos" data-s="${state.posSel}-${d}">${d}</button>`).join(''); document.querySelectorAll('#pos-grid .bet-btn').forEach(b => b.onclick = () => placeBet(b.dataset.t, b.dataset.s)); renderMyBets() }
  renderPos()
  document.querySelectorAll('.chip').forEach(b => b.onclick = () => { state.chip = +b.dataset.v; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b)) })
  document.querySelectorAll('.bet-btn').forEach(b => b.onclick = () => placeBet(b.dataset.t, b.dataset.s))
  document.querySelectorAll('.room-tab').forEach(b => b.onclick = () => switchRoom(b.dataset.room))
  $('trend-type').onchange = (e) => { state.trendType = e.target.value; renderTrend() }
  $('verify-last').onclick = () => state.last && openVerify(state.last.round_no)
  $('history-list').onclick = (e) => { const row = e.target.closest('.hist-row'); if (row) openVerify(+row.dataset.no) }
  $('verify-close').onclick = () => $('verify-modal').classList.add('hidden')
  $('me-close').onclick = () => $('me-modal').classList.add('hidden')
  $('menu-btn').onclick = openMe
  $('relief-btn').onclick = async () => { try { const r = await api.post('/me/relief'); toast(`已领取救济积分，余额 ${fmt(r.data.balance)}`); poll() } catch (e) { toast(e.response?.data?.error || '领取失败', false) } }
  $('reset-account').onclick = () => { if (confirm('重置后当前账户记录将不再可访问，确定？')) { localStorage.removeItem('hp_token'); location.reload() } }
  document.querySelectorAll('#verify-modal, #me-modal').forEach(m => m.onclick = (e) => { if (e.target === m) m.classList.add('hidden') })
}

// ---------- 启动 ----------
;(async () => {
  state.meta = (await api.get('/rooms')).data
  bind()
  await ensureUser()
  switchRoom('tron')
  setInterval(poll, 2500)
  setInterval(tickCountdown, 250)
  loadLeaderboard()
})()
