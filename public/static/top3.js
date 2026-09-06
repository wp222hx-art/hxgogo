/* /top3 战绩榜优质策略推荐选号：滚动前三各 500 注 + 融合 500 注，一键复制，逐期战绩 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var PUBLISH_DELAY = 15000, POLL = 4000, BREAK_EVEN = 0.526
  var S = { source: null, data: null, status: null, tab: 'fused', fmt: 'space', hist: 12, loaded: false, ver: 0, timers: {} }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  var pct = function (x, d) { return x == null ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%' }
  var fmtInt = function (n) { return (n > 0 ? '+' : '') + Number(n || 0).toLocaleString('zh-CN') }
  var bj = function (ms, sec) { if (!ms) return ''; var d = new Date(ms + 8 * 3600000); var s = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); return sec ? s + ':' + ('0' + d.getUTCSeconds()).slice(-2) : s }
  var joinNums = function (arr, fmt) { return fmt === 'comma' ? arr.join(',') : fmt === 'line' ? arr.join('\n') : arr.join(' ') }
  var medal = ['#fbbf24', '#cbd5e1', '#d97706']

  function step(p, t) { $('ld-pct').textContent = p + '%'; $('ld-bar').firstElementChild.style.width = p + '%'; if (t) $('ld-text').innerHTML = '<i class="fas fa-trophy text-amber-400 mr-2"></i>' + t }
  function reveal() { if (S.loaded) return; S.loaded = true; step(100, '完成'); setTimeout(function () { $('loader').classList.add('hidden'); ['cur', 'stats', 'lb-sec', 'hist-sec'].forEach(function (id) { $(id).classList.remove('hidden'); $(id).classList.add('fade-in') }) }, 250) }

  // ---------------------------------------------------------------- 本期
  function activeList() {
    var c = S.data && S.data.current; if (!c) return []
    if (S.tab === 'fused') return c.fused
    var m = c.members.find(function (x) { return x.key === S.tab }); return m ? m.numbers : []
  }
  function renderCur() {
    var c = S.data.current
    if (!c) { $('cur-expect').textContent = '—'; $('cur-sub').textContent = '暂无待开期（数据不足或未同步）'; $('members').innerHTML = ''; $('tabs').innerHTML = ''; return }
    $('cur-expect').textContent = c.expect
    $('cur-sub').textContent = '基于 ' + c.based_on + ' 及之前全部历史 · 前三名按本期之前滚动 40 期战绩排定'
    $('cur-state').textContent = c.status === 'ready' ? '已锁定' : '生成中…'
    // 成员卡
    $('members').innerHTML = c.members.map(function (m, i) {
      var ov = (c.overlap.find(function (o) { return o.key === m.key }) || {}).in_fused || 0
      return '<div class="member p-3"><div class="flex items-center gap-2"><span class="rank" style="background:' + medal[i] + '">' + (i + 1) + '</span><div class="min-w-0"><div class="font-bold text-sm truncate" style="color:' + m.color + '">' + esc(m.name) + '</div><div class="text-[11px] text-slate-500 truncate">' + esc(m.desc) + '</div></div></div>' +
        '<div class="grid grid-cols-3 gap-1 mt-2 text-[11px]"><div><div class="text-slate-500">滚动 z</div><div class="mono font-bold ' + (m.z > 0 ? 'text-emerald-300' : 'text-slate-300') + '">' + (m.z > 0 ? '+' : '') + m.z + '</div></div><div><div class="text-slate-500">近 ' + m.n + ' 期命中</div><div class="mono font-bold">' + pct(m.rate) + '</div></div><div><div class="text-slate-500">融合权重</div><div class="mono font-bold text-amber-300">' + pct(m.w, 0) + '</div></div></div>' +
        '<div class="bar mt-2" style="background:linear-gradient(90deg,' + m.color + ' ' + Math.round(m.w * 100) + '%, #1e293b ' + Math.round(m.w * 100) + '%)"></div>' +
        '<div class="text-[10.5px] text-slate-500 mt-1">其 500 注中 <b class="text-slate-300">' + ov + '</b> 注进入融合</div></div>'
    }).join('')
    // tabs
    var tabs = [{ k: 'fused', label: '<i class="fas fa-layer-group mr-1"></i>融合 500 注（待验证）' }].concat(c.members.map(function (m, i) { return { k: m.key, label: '<span class="rank inline-grid mr-1" style="background:' + medal[i] + ';width:18px;height:18px;font-size:11px">' + (i + 1) + '</span>' + esc(m.short) + ' 500 注' } }))
    $('tabs').innerHTML = tabs.map(function (t) { return '<button class="tab' + (S.tab === t.k ? ' on' : '') + '" data-k="' + t.k + '">' + t.label + '</button>' }).join('')
    document.querySelectorAll('#tabs .tab').forEach(function (b) { b.addEventListener('click', function () { S.tab = b.getAttribute('data-k'); renderCur() }) })
    // list
    var nums = activeList()
    $('copy-btn').disabled = !nums.length
    $('cur-text').value = joinNums(nums, S.fmt)
    var cnt = {}; c.members.forEach(function (m) { m.numbers.forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1 }) })
    $('cur-grid').innerHTML = nums.map(function (n) { var k = cnt[n] || 0; return '<span class="' + (k === 3 ? 'c3' : k === 2 ? 'c2' : '') + '">' + n + '</span>' }).join('')
    var lbl = S.tab === 'fused' ? '融合 500 注' : (c.members.find(function (m) { return m.key === S.tab }) || {}).short + ' 500 注'
    $('cur-meta').textContent = lbl + ' · ' + nums.length + ' 注' + (c.created_ms ? ' · 北京时间 ' + bj(c.created_ms, true) + ' 锁定' : '')
    $('legend').innerHTML = '<span class="inline-block w-3 h-3 rounded align-middle mr-1" style="background:#fbbf24"></span>三策略共识 ' + c.consensus_all + ' 注　<span class="inline-block w-3 h-3 rounded align-middle mr-1" style="background:#fbbf2455"></span>两策略共识　<span class="inline-block w-3 h-3 rounded align-middle mr-1" style="background:rgba(148,163,184,.25)"></span>单策略'
  }
  // ---------------------------------------------------------------- 战绩 / 排行 / 历史
  function renderStats() {
    var r = S.data.record; if (!r) { $('stats').innerHTML = '<div class="stat col-span-4 text-xs text-slate-500">融合策略尚无已结算期，开奖后自动累计</div>'; return }
    var streak = (r.streak || []).slice().reverse().map(function (h) { return '<i class="' + (h ? 'h' : '') + '"></i>' }).join('')
    $('stats').innerHTML =
      '<div class="stat"><div class="text-xs text-slate-400">已验证真实预测</div><div class="v">' + r.n + '<span class="text-xs text-slate-500 font-normal ml-1">期</span></div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">命中率 <span class="text-slate-600">保本 52.6%</span></div><div class="v ' + (r.rate >= BREAK_EVEN ? 'text-emerald-400' : '') + '">' + pct(r.rate) + '<span class="text-xs text-slate-500 font-normal ml-1">' + r.hits + ' 中</span></div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">累计盈亏 <span class="text-slate-600">950× · 每注 1</span></div><div class="v ' + (r.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400') + '">' + fmtInt(r.pnl) + '</div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">近 20 期（右=最新）</div><div class="streak mt-2">' + streak + '</div></div>'
  }
  function renderLb() {
    var lb = S.data.leaderboard || []; var max = Math.max.apply(null, lb.map(function (x) { return Math.abs(x.z) }).concat([1]))
    var members = (S.data.current && S.data.current.members || []).map(function (m) { return m.key })
    var rl = S.data.rules || {}
    $('lb').innerHTML = '<div class="text-[11px] text-slate-500 mb-2">实验筛选规则（不代表显著优势）：样本 ≥ ' + (rl.min_n || 10) + ' 期 且 滚动 z > ' + (rl.min_z == null ? 0 : rl.min_z) + '；取前三，合格者不足三个则只融合合格者，全无则退回组合最优；AI 入选但未到达时最多等 ' + Math.round((rl.ai_wait_ms || 15000) / 1000) + 's</div><div class="lb text-slate-500"><span>#</span><span>策略</span><span class="text-right">滚动 z</span><span class="text-right">近 40 期</span><span class="text-right">累计</span></div>' + lb.map(function (x, i) {
      var top = members.indexOf(x.key) >= 0
      return '<div class="lb' + (top ? ' top' : '') + '"><span class="mono text-slate-500">' + (i + 1) + '</span><span class="truncate"><i class="inline-block w-2 h-2 rounded-full mr-1" style="background:' + x.color + '"></i>' + esc(x.short) + (top ? ' <span class="chip" style="background:#fbbf24;color:#000">入选</span>' : x.eligible === false ? ' <span class="chip" style="color:#64748b">未达实验筛选条件</span>' : '') + '</span>' +
        '<span class="mono text-right ' + (x.z > 0 ? 'text-emerald-300' : 'text-slate-400') + '">' + (x.z > 0 ? '+' : '') + x.z + '</span><span class="mono text-right">' + pct(x.rate) + '<span class="text-slate-600 text-[10px]"> /' + x.n + '</span></span><span class="mono text-right ' + (x.total && x.total.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + (x.total ? fmtInt(x.total.pnl) : '—') + '</span></div>'
    }).join('')
  }
  function renderHist() {
    var rows = S.data.history || []
    if (!rows.length) { $('hist').innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">融合策略尚无已开奖记录（每期开奖后自动结算）</div>'; return }
    $('hist').innerHTML = rows.map(function (h, i) {
      var chips = h.members.map(function (m) { return '<span class="chip"><i style="background:' + m.color + '"></i>' + esc(m.short) + (m.hit === true ? ' <b class="text-emerald-400">中</b>' : m.hit === false ? ' <span class="text-slate-500">未</span>' : '') + '</span>' }).join(' ')
      return '<details class="hrow ' + (h.hit ? 'hit' : '') + '" data-i="' + i + '"><summary><span class="mono text-amber-300">' + h.expect + '</span><span class="mono font-black ' + (h.hit ? 'text-emerald-400' : 'text-slate-300') + '">' + (h.actual || '—') + '</span>' +
        '<span class="truncate"><span class="mono text-slate-500 mr-2">' + bj(h.open_ms, true) + '</span>' + chips + '</span><span>' + (h.hit ? '<span class="badge h">命中 #' + h.rank + '</span>' : '<span class="badge m">未中</span>') + '</span><span class="mono text-right ' + (h.pnl > 0 ? 'text-emerald-400' : 'text-rose-400') + '">' + fmtInt(h.pnl) + '</span></summary><div class="p-3 hist-body"></div></details>'
    }).join('')
  }
  $('hist').addEventListener('toggle', function (e) {
    var d = e.target; if (!d.open || d.getAttribute('data-r')) return
    var h = S.data.history[+d.getAttribute('data-i')]; if (!h) return; d.setAttribute('data-r', '1')
    var nums = String(h.numbers || '').trim().split(/\s+/)
    var mem = h.members.map(function (m) { return '<span class="chip"><i style="background:' + m.color + '"></i>' + esc(m.short) + ' z ' + (m.z > 0 ? '+' : '') + m.z + ' · 权重 ' + pct(m.w, 0) + (m.hit === true ? ' · <b class="text-emerald-400">命中 #' + m.rank + '</b>' : m.hit === false ? ' · <span class="text-slate-500">未中</span>' : '') + '</span>' }).join(' ')
    d.querySelector('.hist-body').innerHTML = '<div class="text-xs text-slate-500 mb-2">北京时间 ' + bj(h.open_ms, true) + ' 开出 <b class="text-slate-200 mono">' + esc(h.actual) + '</b> · 融合 ' + h.count + ' 注' + (h.hit ? ' · 命中位次 #' + h.rank : '') + ' <button class="ml-2 text-amber-300 hover:text-amber-200 h-copy"><i class="fas fa-copy mr-1"></i>复制该期 500 注</button></div>' +
      '<div class="mb-2 flex flex-wrap gap-1">当期成员：' + mem + '</div>' +
      '<div class="grid500">' + nums.map(function (n) { return '<span class="' + (n === h.actual ? 'hit' : '') + '">' + n + '</span>' }).join('') + '</div>'
    d.querySelector('.h-copy').addEventListener('click', function (ev) { ev.preventDefault(); copyText(joinNums(nums, S.fmt), ev.currentTarget) })
  }, true)

  // ---------------------------------------------------------------- 复制
  function copyText(text, btn) {
    var done = function () { var c = $('copied'); c.classList.remove('hidden'); clearTimeout(S.timers.copied); S.timers.copied = setTimeout(function () { c.classList.add('hidden') }, 2200); if (btn) { var old = btn.innerHTML; btn.innerHTML = '<i class="fas fa-check mr-1"></i>已复制'; setTimeout(function () { btn.innerHTML = old }, 1600) } }
    var fb = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch (e) {} document.body.removeChild(ta) }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fb(); done() }); else { fb(); done() }
  }
  $('copy-btn').addEventListener('click', function () { var n = activeList(); if (n.length) copyText(joinNums(n, S.fmt), $('copy-btn')) })
  $('fmt').addEventListener('change', function () { S.fmt = $('fmt').value; try { localStorage.setItem('top3:fmt', S.fmt) } catch (e) {} $('cur-text').value = joinNums(activeList(), S.fmt) })
  $('cur-text').addEventListener('click', function () { this.select() })
  $('hist-n').addEventListener('change', function () { S.hist = +$('hist-n').value; fetchData(true) })

  // ---------------------------------------------------------------- 数据 / 节拍
  function fetchData(force) {
    var ver = ++S.ver
    return axios.get('/api/top3/pick', { params: { source: S.source, history: S.hist, _: force ? Date.now() : undefined } }).then(function (r) {
      if (ver !== S.ver) return
      S.data = r.data; if (!S.loaded) step(75, '锁定前三 · 融合 500 注…')
      renderCur(); renderStats(); renderLb(); renderHist(); reveal()
      clearTimeout(S.timers.pend); if (S.data.current && S.data.current.status !== 'ready') S.timers.pend = setTimeout(function () { fetchData(true) }, POLL)
    }).catch(function (e) { if (!S.loaded) { $('ld-text').innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400 mr-2"></i>加载失败：' + esc(e.message) + '，5 秒后重试…'; setTimeout(function () { fetchData(true) }, 5000) } })
  }
  function fetchStatus(tick) {
    return axios.get('/api/sync/status', { params: { source: S.source, tick: tick ? 1 : undefined } }).then(function (r) {
      var st = r.data && r.data.status && r.data.status[S.source]; if (!st) return null
      var prev = S.status; S.status = st
      var sb = $('stale-bar'); if (sb) { if (st.stale || st.fail_streak >= 3) { sb.classList.remove('hidden'); sb.innerHTML = '<i class="fas fa-triangle-exclamation mr-2"></i>数据源异常：' + (st.stale ? '距最新开奖已 ' + Math.round(st.lag_ms / 1000) + 's 无新期' : '') + (st.fail_streak >= 3 ? ' · 连续 ' + st.fail_streak + ' 次拉取失败' : '') + ' · 自动重试中' } else sb.classList.add('hidden') }
      if (prev && prev.latest_expect !== st.latest_expect) fetchData(true)
      return st
    }).catch(function () { return null })
  }
  function tickCountdown() {
    var st = S.status, el = $('cur-cd'); if (!st) return
    var target = (st.expected_publish_ms || st.next_due_ms || 0) + PUBLISH_DELAY, left = target - Date.now()
    var ob = $('cur-open-bj'); if (ob) ob.textContent = '· 预计北京时间 ' + bj(st.expected_publish_ms || st.next_due_ms, true) + ' 开奖'
    if (left > 0) { var s = Math.ceil(left / 1000); el.textContent = (s >= 60 ? Math.floor(s / 60) + ':' : '') + ('0' + (s % 60)).slice(-2) + (s >= 60 ? '' : 's'); el.className = 'text-2xl font-black mono ' + (s <= 10 ? 'text-amber-300' : 'text-slate-100') }
    else { el.textContent = '开奖中'; el.className = 'text-2xl font-black mono text-emerald-400 animate-pulse'; if (!S.timers.busy) { S.timers.busy = true; fetchStatus(true).then(function () { setTimeout(function () { S.timers.busy = false }, POLL) }) } }
  }
  function boot() {
    S.loaded = false; S.data = null; S.status = null; step(25, '连接数据源…')
    fetchStatus(true).then(function () { if (!S.loaded) step(50, '同步最新开奖…'); return fetchData(false) })
  }
  function init() {
    try { S.fmt = localStorage.getItem('top3:fmt') || 'space'; $('fmt').value = S.fmt } catch (e) {}
    axios.get('/api/sources').then(function (r) {
      var list = r.data.sources || []; var sel = $('source-sel')
      sel.innerHTML = list.map(function (s) { return '<option value="' + s.key + '">' + esc(s.name) + '</option>' }).join('')
      var saved = null; try { saved = localStorage.getItem('ai:source') } catch (e) {}
      S.source = list.some(function (s) { return s.key === saved }) ? saved : (list[0] && list[0].key); sel.value = S.source
      sel.addEventListener('change', function () { S.source = sel.value; try { localStorage.setItem('ai:source', S.source) } catch (e) {} $('loader').classList.remove('hidden'); ['cur', 'stats', 'lb-sec', 'hist-sec'].forEach(function (id) { $(id).classList.add('hidden') }); boot() })
      boot(); setInterval(tickCountdown, 500)
      setInterval(function () { if (document.visibilityState === 'visible') fetchStatus(false) }, 20000)
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') fetchStatus(true).then(function () { fetchData(true) }) })
    }).catch(function (e) { $('ld-text').innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400 mr-2"></i>无法连接数据源：' + esc(e.message) })
  }
  init()
})()
