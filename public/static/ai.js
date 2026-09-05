/* /ai 页面：极简 AI 推荐 · 每期 500 注 · 一键复制
 * 加载体系：
 *   1) 进度条四阶段（连接数据源 → 同步开奖 → AI 推理 → 锁定 500 注）
 *   2) localStorage 陈旧优先（stale-while-revalidate）：有缓存立刻出内容，再后台刷新
 *   3) 服务端缓存（X-Cache HIT/MISS）+ 后台 AI 推理，接口本身 <100ms
 *   4) AI 仍在推理时显示不定长进度条 + 已等待秒数，每 4s 轮询直到 ready
 *   5) 开奖倒计时归零后轮询 sync/status，期号变化即刷新
 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var PUBLISH_DELAY = 15000, POLL_THINK = 4000, POLL_NEXT = 4000, BREAK_EVEN = 0.526
  var S = { source: null, sources: [], pick: null, record: null, history: [], status: null, hist: 12, fmt: 'space', timers: {}, waitStart: 0, loaded: false, ver: 0 }

  // ---------------------------------------------------------------- 进度条
  var STEPS = { 1: ['连接数据源…', 25], 2: ['同步最新开奖…', 50], 3: ['AI 正在推理本期…', 75], 4: ['锁定 500 注', 100] }
  function step(n, text) {
    var s = STEPS[n]; if (!s) return
    $('ld-text').innerHTML = '<i class="fas fa-brain text-pink-400 mr-2"></i>' + (text || s[0])
    $('ld-pct').textContent = s[1] + '%'
    $('ld-bar').firstElementChild.style.width = s[1] + '%'
    var items = $('ld-steps').children
    for (var i = 0; i < items.length; i++) {
      var k = +items[i].getAttribute('data-s')
      items[i].classList.toggle('done', k < n || n === 4)
      items[i].classList.toggle('on', k === n && n !== 4)
      items[i].firstElementChild.className = (k < n || n === 4) ? 'fas fa-check text-[9px]' : (k === n ? 'fas fa-circle-notch fa-spin text-[9px]' : 'fas fa-circle text-[6px]')
    }
  }
  function reveal() {
    if (S.loaded) return
    S.loaded = true
    step(4)
    setTimeout(function () {
      $('loader').classList.add('hidden')
      ;['cur', 'stats', 'hist-sec'].forEach(function (id) { var el = $(id); el.classList.remove('hidden'); el.classList.add('fade-in') }); renderSync(S.sync)
    }, 250)
  }

  // ---------------------------------------------------------------- 工具
  var fmtInt = function (n) { return (n > 0 ? '+' : '') + Number(n || 0).toLocaleString('zh-CN') }
  var pct = function (x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%' }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  var hhmm = function (ms) { if (!ms) return ''; var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) }
  function joinNums(arr, fmt) { return fmt === 'comma' ? arr.join(',') : fmt === 'line' ? arr.join('\n') : arr.join(' ') }
  function lsKey() { return 'ai:pick:' + S.source }
  function saveLocal(data) { try { localStorage.setItem(lsKey(), JSON.stringify({ t: Date.now(), data: data })) } catch (e) {} }
  function loadLocal() { try { var v = JSON.parse(localStorage.getItem(lsKey()) || 'null'); return v && v.data ? v : null } catch (e) { return null } }

  // ---------------------------------------------------------------- 本期渲染
  function gridHtml(numbers, boost, actual) {
    var bs = {}; (boost || []).forEach(function (n) { bs[n] = 1 })
    var out = []
    for (var i = 0; i < numbers.length; i++) {
      var n = numbers[i], cls = n === actual ? 'hit' : (bs[n] ? 'boost' : '')
      out.push('<span' + (cls ? ' class="' + cls + '"' : '') + '>' + n + '</span>')
    }
    return out.join('')
  }
  function posBars(pw) {
    if (!pw || pw.length !== 3) return ''
    var names = ['万', '千', '百']
    return pw.map(function (row, p) {
      var max = Math.max.apply(null, row.concat([1]))
      var bars = row.map(function (v, d) { return '<div title="' + d + ': ' + v + '" class="flex flex-col items-center justify-end h-full"><div class="b w-full" style="height:' + Math.max(4, Math.round(v / max * 100)) + '%"></div><span class="text-slate-500">' + d + '</span></div>' }).join('')
      return '<div class="pw mt-1"><span class="text-slate-400 self-center">' + names[p] + '</span>' + bars + '</div>'
    }).join('')
  }
  function reasonHtml(p) {
    var f = p.forecast, b = p.breakdown
    if (!f && !b) return '<div class="text-slate-500">' + (p.fallback ? '本期 AI 调用未成功（' + esc(p.error || '超时') + '），已用「组合最优 meta」策略兜底，保证每期形成选择。' : '推理内容暂无。') + '</div>'
    var h = []
    if (f) {
      h.push('<div><b>盘面判断</b>：' + esc(f.regime) + ' <span class="text-slate-500">· 自评把握 ' + pct(f.confidence, 0) + '</span></div>')
      if (f.reasoning) h.push('<div class="mt-1"><b>推理</b>：' + esc(f.reasoning) + '</div>')
      if (f.pick_plan) h.push('<div class="mt-1"><b>500 注构成方案</b>：' + esc(f.pick_plan) + '</div>')
    }
    if (b) {
      var focus = (b.pos_focus || []).map(function (row, i) { return ['万', '千', '百'][i] + '位重点 ' + row.map(function (x) { return x.d + '<span class="text-slate-500">(' + x.c + ')</span>' }).join(' ') }).join('　')
      h.push('<div class="mt-1"><b>落地结构</b>：' + focus + '</div>')
      h.push('<div class="text-slate-400">形态 豹' + b.shape['豹'] + ' / 顺' + b.shape['顺'] + ' / 对' + b.shape['对'] + ' / 杂' + b.shape['杂'] + '　万位 大' + b.wan['大'] + ' 小' + b.wan['小'] + ' 单' + b.wan['单'] + ' 双' + b.wan['双'] + '　和值 大' + b.sum_big + ' 小' + b.sum_small + '</div>')
      if (b.blend && b.blend.length) h.push('<div class="text-slate-400">策略融合：' + b.blend.slice(0, 5).map(function (x) { return x.strategy + ' ' + pct(x.share, 0) }).join(' · ') + '</div>')
      if (b.boost_in && b.boost_in.length) h.push('<div class="text-slate-400">额外看好（粉色）：' + b.boost_in.join(' ') + (b.boost_out.length ? ' <span class="text-slate-600">未入选 ' + b.boost_out.join(' ') + '</span>' : '') + '</div>')
      if (b.avoid_out && b.avoid_out.length) h.push('<div class="text-slate-400">明确回避：' + b.avoid_out.join(' ') + '</div>')
    }
    if (f && f.pos_weights) h.push('<div class="mt-2 text-slate-500">各位数字权重（AI 输出）</div>' + posBars(f.pos_weights))
    if (f && f.next_focus) h.push('<div class="mt-2 text-slate-500"><b>下期验证</b>：' + esc(f.next_focus) + '</div>')
    if (p.model) h.push('<div class="mt-2 text-slate-600">' + esc(p.model) + ' · ' + (p.latency_ms ? (p.latency_ms / 1000).toFixed(1) + 's' : '') + (p.tokens ? ' · ' + p.tokens + ' tokens' : '') + '</div>')
    return h.join('')
  }
  function renderCur() {
    var p = S.pick
    if (!p) { $('cur-expect').textContent = '—'; $('cur-sub').textContent = '暂无待开期（数据不足或未同步）'; return }
    $('cur-expect').textContent = p.expect
    $('cur-sub').textContent = '基于 ' + p.based_on + ' 及之前全部历史' + (p.status === 'fallback' ? ' · 兜底 meta' : '')
    var wait = $('cur-wait'), btn = $('copy-btn')
    if (p.status === 'thinking') {
      wait.classList.remove('hidden'); btn.disabled = true
      if (!S.waitStart) S.waitStart = Date.now()
      $('cur-state').textContent = 'AI 推理中'
      $('cur-meta').textContent = ''
      $('cur-text').value = ''; $('cur-text').placeholder = 'AI 推理完成后 500 注将自动出现（通常 5–15 秒）'
      $('cur-grid').innerHTML = ''
      $('cur-reason').innerHTML = '<div class="text-slate-500">推理中…</div>'
    } else {
      wait.classList.add('hidden'); btn.disabled = !p.numbers.length; S.waitStart = 0
      $('cur-state').textContent = p.status === 'fallback' ? '兜底（AI 调用失败）' : 'AI 已锁定'
      $('cur-meta').textContent = p.count + ' 注 · 覆盖 ' + pct(p.coverage || p.count / 1000, 1) + (p.created_ms ? ' · ' + hhmm(p.created_ms) + ' 生成' : '')
      $('cur-text').value = joinNums(p.numbers, S.fmt)
      $('cur-grid').innerHTML = gridHtml(p.numbers, p.forecast && p.forecast.boost)
      $('cur-reason').innerHTML = reasonHtml(p)
    }
  }

  // ---------------------------------------------------------------- 报单同步状态
  function renderSync(sy) {
    var el = $('sync-line'); if (!el) return
    if (!sy || !sy.n) { el.classList.add('hidden'); return }
    var rate = sy.in_time / sy.n, good = rate >= 0.9
    el.innerHTML = '<span><i class="fas fa-heart-pulse mr-1 ' + (sy.heartbeat_alive ? 'text-emerald-400' : 'text-amber-400') + '"></i>服务端心跳 ' + (sy.heartbeat_alive ? '运行中' : '待唤醒') + '</span>' +
      '<span><i class="fas fa-lock mr-1 ' + (good ? 'text-emerald-400' : 'text-amber-400') + '"></i>近 ' + sy.n + ' 期 <b class="' + (good ? 'text-emerald-300' : 'text-amber-300') + '">' + sy.in_time + '/' + sy.n + '</b> 在报单截止前锁定</span>' +
      (sy.avg_lock_s != null ? '<span><i class="fas fa-stopwatch mr-1 text-sky-400"></i>上期开奖后平均 <b class="mono text-slate-200">' + sy.avg_lock_s + 's</b> 锁定（最慢 ' + sy.max_lock_s + 's）</span>' : '') +
      '<span class="text-slate-600">开奖前 ' + Math.round((S.lead || 20000) / 1000) + 's 为截止</span>'
    el.classList.remove('hidden')
  }
  // ---------------------------------------------------------------- 战绩 + 历史
  function renderStats() {
    var r = S.record; if (!r) return
    var streak = (r.streak || []).slice().reverse().map(function (h) { return '<i class="' + (h ? 'h' : '') + '"></i>' }).join('')
    var rateCls = r.rate >= BREAK_EVEN ? 'text-emerald-400' : 'text-slate-200'
    $('stats').innerHTML =
      '<div class="stat"><div class="text-xs text-slate-400">已实盘检验</div><div class="v">' + r.n + '<span class="text-xs text-slate-500 font-normal ml-1">期</span></div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">命中率 <span class="text-slate-600">保本 52.6%</span></div><div class="v ' + rateCls + '">' + pct(r.rate) + '<span class="text-xs text-slate-500 font-normal ml-1">' + r.hits + ' 中</span></div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">累计盈亏 <span class="text-slate-600">950× · 每注 1</span></div><div class="v ' + (r.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400') + '">' + fmtInt(r.pnl) + '</div></div>' +
      '<div class="stat"><div class="text-xs text-slate-400">近 20 期（右=最新）</div><div class="streak mt-2">' + streak + '</div></div>'
  }
  function renderHist() {
    var rows = S.history || []
    if (!rows.length) { $('hist').innerHTML = '<div class="text-xs text-slate-500 py-4 text-center">还没有已开奖的 AI 推荐记录</div>'; return }
    $('hist').innerHTML = rows.map(function (h, i) {
      var reg = h.regime ? esc(h.regime) : '<span class="text-slate-600">（AI 未成功，兜底）</span>'
      return '<details class="hrow ' + (h.hit ? 'hit' : '') + '" data-i="' + i + '">' +
        '<summary><span class="mono text-amber-300">' + h.expect + '</span>' +
        '<span class="mono font-black ' + (h.hit ? 'text-emerald-400' : 'text-slate-300') + '">' + (h.actual || '—') + '</span>' +
        '<span class="truncate text-slate-400">' + reg + (h.confidence ? ' <span class="text-slate-600">' + pct(h.confidence, 0) + '</span>' : '') + '</span>' +
        '<span>' + (h.hit ? '<span class="badge h">命中 #' + h.rank + '</span>' : '<span class="badge m">未中</span>') + '</span>' +
        '<span class="mono text-right ' + (h.pnl > 0 ? 'text-emerald-400' : 'text-rose-400') + '">' + fmtInt(h.pnl) + '</span></summary>' +
        '<div class="p-3 hist-body"></div></details>'
    }).join('')
  }
  $('hist').addEventListener('toggle', function (e) {
    var d = e.target; if (!d.open || d.getAttribute('data-r')) return
    var h = S.history[+d.getAttribute('data-i')]; if (!h) return
    d.setAttribute('data-r', '1')
    var nums = String(h.numbers || '').trim().split(/\s+/)
    var body = d.querySelector('.hist-body')
    body.innerHTML = '<div class="text-xs text-slate-500 mb-2">' + hhmm(h.open_ms) + ' 开出 <b class="text-slate-200 mono">' + esc(h.actual) + '</b> · ' + h.count + ' 注' + (h.hit ? ' · 命中位次 #' + h.rank : '') +
      ' <button class="ml-2 text-pink-300 hover:text-pink-200 h-copy"><i class="fas fa-copy mr-1"></i>复制该期 500 注</button></div>' +
      '<div class="grid500">' + gridHtml(nums, h.boost, h.actual) + '</div>' +
      (h.reasoning || h.pick_plan ? '<div class="reason mt-3">' + (h.reasoning ? '<div><b>推理</b>：' + esc(h.reasoning) + '</div>' : '') + (h.pick_plan ? '<div class="mt-1"><b>方案</b>：' + esc(h.pick_plan) + '</div>' : '') + '</div>' : '')
    body.querySelector('.h-copy').addEventListener('click', function (ev) { ev.preventDefault(); copyText(joinNums(nums, S.fmt), ev.currentTarget) })
  }, true)

  // ---------------------------------------------------------------- 复制
  function copyText(text, btn) {
    var done = function () {
      var c = $('copied'); c.classList.remove('hidden'); clearTimeout(S.timers.copied); S.timers.copied = setTimeout(function () { c.classList.add('hidden') }, 2200)
      if (btn) { var old = btn.innerHTML; btn.innerHTML = '<i class="fas fa-check mr-1"></i>已复制'; setTimeout(function () { btn.innerHTML = old }, 1600) }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done() })
    else { fallbackCopy(text); done() }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch (e) {} document.body.removeChild(ta)
  }
  $('copy-btn').addEventListener('click', function () { if (S.pick && S.pick.numbers.length) copyText(joinNums(S.pick.numbers, S.fmt), $('copy-btn')) })
  $('fmt').addEventListener('change', function () { S.fmt = $('fmt').value; try { localStorage.setItem('ai:fmt', S.fmt) } catch (e) {} if (S.pick) $('cur-text').value = joinNums(S.pick.numbers, S.fmt) })
  $('cur-text').addEventListener('click', function () { this.select() })
  $('hist-n').addEventListener('change', function () { S.hist = +$('hist-n').value; fetchPick(true) })

  // ---------------------------------------------------------------- 数据
  function applyPick(d) {
    S.pick = d.pick; S.record = d.record; S.history = d.history || []; S.lead = d.lead_ms || 20000; S.provider = d.provider; S.model = d.model; S.sync = d.sync
    renderSync(d.sync)
    var hm = $('hd-model'); if (hm) hm.textContent = (d.provider ? d.provider + ' · ' : '') + (d.model || '') + ' · 开奖前 ' + Math.round(S.lead / 1000) + 's 锁定'
    renderCur(); renderStats(); renderHist()
  }
  function fetchPick(force) {
    var ver = ++S.ver
    return axios.get('/api/arena/pick', { params: { source: S.source, history: S.hist, _: force ? Date.now() : undefined } }).then(function (r) {
      if (ver !== S.ver) return
      var d = r.data; if (!d.ok) throw new Error(d.error || 'pick failed')
      applyPick(d)
      if (d.pick && d.pick.status !== 'thinking') saveLocal(d)
      if (!S.loaded) { if (d.pick && d.pick.status === 'thinking') step(3); reveal() }
      scheduleThink()
      return d
    }).catch(function (e) {
      if (!S.loaded) { $('ld-text').innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400 mr-2"></i>加载失败：' + esc(e.message) + '，5 秒后重试…'; setTimeout(function () { fetchPick(true) }, 5000) }
    })
  }
  function scheduleThink() {
    clearInterval(S.timers.think); clearTimeout(S.timers.thinkPoll)
    if (!S.pick || S.pick.status !== 'thinking') return
    S.timers.think = setInterval(function () { $('wait-sec').textContent = Math.round((Date.now() - S.waitStart) / 1000) + 's' }, 500)
    S.timers.thinkPoll = setTimeout(function () { fetchPick(true) }, POLL_THINK)
  }
  function fetchStatus(tick) {
    return axios.get('/api/sync/status', { params: { source: S.source, tick: tick ? 1 : undefined } }).then(function (r) {
      var st = r.data && r.data.status && r.data.status[S.source]; if (!st) return null
      var prev = S.status; S.status = st
      if (prev && prev.latest_expect !== st.latest_expect) { S.waitStart = 0; fetchPick(true) }
      return st
    }).catch(function () { return null })
  }
  // 倒计时：按预计开奖时刻 + 发布延迟；归零后每 4s 轮询 status 直到新期号
  function tickCountdown() {
    var st = S.status, el = $('cur-cd')
    if (!st) { el.textContent = '—'; return }
    var target = (st.expected_publish_ms || st.next_due_ms || 0) + PUBLISH_DELAY
    var left = target - Date.now()
    if (left > 0) {
      var s = Math.ceil(left / 1000); el.textContent = (s >= 60 ? Math.floor(s / 60) + ':' : '') + ('0' + (s % 60)).slice(-2) + (s >= 60 ? '' : 's')
      el.className = 'text-2xl font-black mono ' + (s <= 10 ? 'text-amber-300' : 'text-slate-100')
      // 报单窗口：开奖前 lead 秒必须已有号码；显示距截止还有多久
      var lockLeft = (st.expected_publish_ms || st.next_due_ms || 0) - (S.lead || 20000) - Date.now(), lk = $('cur-lock')
      if (lk) {
        if (S.pick && S.pick.status !== 'thinking') lk.innerHTML = lockLeft > 0 ? '<i class="fas fa-lock-open mr-1 text-emerald-400"></i>报单窗口 剩 <b class="mono">' + Math.ceil(lockLeft / 1000) + 's</b>' : '<i class="fas fa-lock mr-1 text-slate-500"></i>报单窗口已过 · 等下期'
        else lk.innerHTML = lockLeft > 0 ? '<i class="fas fa-hourglass-half mr-1 text-pink-300"></i>AI 须在 <b class="mono">' + Math.ceil(lockLeft / 1000) + 's</b> 内锁定' : '<i class="fas fa-triangle-exclamation mr-1 text-amber-400"></i>超出截止 · 将用兜底策略'
      }
    } else {
      el.textContent = '开奖中'; el.className = 'text-2xl font-black mono text-emerald-400 animate-pulse'
      if (!S.timers.nextBusy) { S.timers.nextBusy = true; fetchStatus(true).then(function () { setTimeout(function () { S.timers.nextBusy = false }, POLL_NEXT) }) }
    }
  }

  // ---------------------------------------------------------------- 初始化
  function boot() {
    S.loaded = false; S.pick = null; S.status = null; S.waitStart = 0
    clearInterval(S.timers.think); clearTimeout(S.timers.thinkPoll)
    step(1)
    // 陈旧优先：有本地缓存立即显示（不等待网络）
    var local = loadLocal()
    if (local && local.data && local.data.pick) { applyPick(local.data); reveal(); $('cur-state').textContent = '本地缓存 · 刷新中…' }
    fetchStatus(true).then(function () { if (!S.loaded) step(2) }).then(function () { if (!S.loaded) step(3, '读取 AI 本期推荐…'); return fetchPick(false) })
  }
  function init() {
    try { S.fmt = localStorage.getItem('ai:fmt') || 'space'; $('fmt').value = S.fmt } catch (e) {}
    step(1)
    axios.get('/api/sources').then(function (r) {
      S.sources = r.data.sources || []
      var sel = $('source-sel'); sel.innerHTML = S.sources.map(function (s) { return '<option value="' + s.key + '">' + esc(s.name) + '</option>' }).join('')
      var saved = null; try { saved = localStorage.getItem('ai:source') } catch (e) {}
      S.source = (S.sources.some(function (s) { return s.key === saved }) ? saved : (S.sources[0] && S.sources[0].key))
      sel.value = S.source
      sel.addEventListener('change', function () { S.source = sel.value; try { localStorage.setItem('ai:source', S.source) } catch (e) {} $('loader').classList.remove('hidden'); ['cur', 'stats', 'hist-sec'].forEach(function (id) { $(id).classList.add('hidden') }); boot() })
      boot()
      setInterval(tickCountdown, 500)
      setInterval(function () { if (document.visibilityState === 'visible') fetchStatus(false) }, 20000)
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') fetchStatus(true).then(function () { fetchPick(true) }) })
    }).catch(function (e) { $('ld-text').innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400 mr-2"></i>无法连接数据源：' + esc(e.message) })
  }
  init()
})()
