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
  var S = { source: null, sources: [], pick: null, record: null, history: [], status: null, hist: 12, fmt: 'space', timers: {}, waitStart: 0, loaded: false, ver: 0, sub: 'all' }
  try { S.sub = localStorage.getItem('ai:sub') || 'all' } catch (e) {}

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
      ;['cur', 'stats', 'hist-sec'].forEach(function (id) { var el = $(id); el.classList.remove('hidden'); el.classList.add('fade-in') }); renderSync(S.sync); fetchStake(); fetchSets()
    }, 250)
  }

  // ---------------------------------------------------------------- 工具
  var fmtInt = function (n) { return (n > 0 ? '+' : '') + Number(n || 0).toLocaleString('zh-CN') }
  var pct = function (x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%' }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  // 统一用北京时间（UTC+8，即上游 openTime 的时区）显示，避免浏览器时区导致「时间对不上」
  var bj = function (ms, withSec) { if (!ms) return ''; var d = new Date(ms + 8 * 3600000); var s = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); return withSec ? s + ':' + ('0' + d.getUTCSeconds()).slice(-2) : s }
  var hhmm = function (ms) { return bj(ms, true) }
  function joinNums(arr, fmt) { return fmt === 'comma' ? arr.join(',') : fmt === 'line' ? arr.join('\n') : arr.join(' ') }
  function lsKey() { return 'ai:pick:' + S.source }
  function saveLocal(data) { try { localStorage.setItem(lsKey(), JSON.stringify({ t: Date.now(), data: data })) } catch (e) {} }
  function loadLocal() { try { var v = JSON.parse(localStorage.getItem(lsKey()) || 'null'); return v && v.data ? v : null } catch (e) { return null } }

  // ---------------------------------------------------------------- 精选档位（同一份排序的前 N 注）
  function subObj() { if (S.sub === 'all' || !S.pick) return null; return (S.pick.subsets || []).find(function (q) { return q.key === S.sub }) || null }
  function subN() { var x = subObj(); return x ? x.n_pick : null }
  function activeNums() { var x = subObj(); if (!x) return S.pick ? S.pick.numbers : []; return (x.numbers && x.numbers.length) ? x.numbers : (S.pick ? S.pick.numbers.slice(0, x.n_pick) : []) }
  function renderSubTabs() {
    var p = S.pick, el = $('sub-tabs'); if (!el) return
    var subs = ((p && p.subsets) || []).slice().sort(function (a, b) { return a.n_pick - b.n_pick })
    var tabs = [{ key: 'all', label: '主推 500 注', sub: '保本 52.6%' }].concat(subs.map(function (q) { return { key: q.key, label: (q.sharp ? '<i class="fas fa-bolt text-yellow-300 text-[9px] mr-1" title="二级精准"></i>精准 ' : '') + q.n_pick + ' 注' + (q.custom ? ' <i class="fas fa-star text-violet-400 text-[9px]" title="自定义档位"></i>' : ''), sub: '保本 ' + pct(q.breakeven, 1) + (q.record ? ' · 实盘 ' + pct(q.record.rate, 1) : '') + (q.independent === false ? ' · 前缀' : '') } }))
    el.innerHTML = tabs.map(function (t) { return '<button class="tab' + (S.sub === t.key ? ' on' : '') + '" data-k="' + t.key + '">' + t.label + '<small>' + t.sub + '</small></button>' }).join('')
    el.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { S.sub = b.getAttribute('data-k'); try { localStorage.setItem('ai:sub', S.sub) } catch (e) {} renderSubTabs(); renderList(); renderSubStats() }) })
  }
  function renderList() {
    var p = S.pick; if (!p || p.status === 'thinking') return
    var nums = activeNums(), k = subN(), bset = {}; ((p.forecast && p.forecast.boost) || []).forEach(function (n) { bset[n] = 1 })
    $('cur-text').value = joinNums(nums, S.fmt)
    $('copy-btn').innerHTML = '<i class="fas fa-copy mr-2"></i>一键复制 ' + nums.length + ' 注'
    $('copy-btn').disabled = !nums.length
    // 各档位是独立生成：网格显示该档自己的号码；与 500 主推重叠的号码加边框标识
    var x = subObj(), mainSet = {}; (p.numbers || []).forEach(function (n) { mainSet[n] = 1 })
    if (x && x.independent) {
      $('cur-grid').innerHTML = nums.map(function (n) { var cls = bset[n] ? 'boost' : ''; if (!mainSet[n]) cls += ' novel'; return '<span class="' + cls.trim() + '" title="' + (mainSet[n] ? '也在 500 主推中' : '主推 500 注之外的独立选择') + '">' + n + '</span>' }).join('')
      var novel = nums.filter(function (n) { return !mainSet[n] }).length
      $('cur-meta').innerHTML = (x.sharp ? '<i class="fas fa-bolt text-yellow-300 mr-1"></i>二级精准 ' : '独立生成 ') + nums.length + ' 注 · 与 500 主推重叠 ' + (nums.length - novel) + ' · <span class="text-cyan-300">主推之外 ' + novel + '</span>' + (p.created_ms ? ' · 北京时间 ' + hhmm(p.created_ms) + ' 锁定' : '')
    } else {
      $('cur-grid').innerHTML = p.numbers.map(function (n, i) { var cls = bset[n] ? 'boost' : ''; if (k && i >= k) cls += ' dim'; return '<span class="' + cls.trim() + '">' + n + '</span>' }).join('')
      $('cur-meta').textContent = (k ? '前缀 ' + k + ' 注（该期无独立生成行）' : p.count + ' 注') + ' · 覆盖 ' + pct(k ? (p.coverage || 0.5) * (k / 500) : (p.coverage || p.count / 1000), 1) + (p.created_ms ? ' · 北京时间 ' + hhmm(p.created_ms) + ' 锁定' : '')
    }
  }
  function renderSubStats() {
    var p = S.pick, el = $('sub-cards'), sec = $('sub-stats'); if (!el) return
    var subs = ((p && p.subsets) || []).slice().sort(function (a, b) { return a.n_pick - b.n_pick }); if (!subs.length) { sec.classList.add('hidden'); return }
    sec.classList.remove('hidden')
    var all = S.record ? { key: 'all', n_pick: 500, short: 'AI·500', color: '#f472b6', breakeven: 0.526, main: true, record: Object.assign({ z: null, roi: S.record.n ? S.record.pnl / (S.record.n * 500) : null }, S.record) } : null
    el.innerHTML = ([all].filter(Boolean).concat(subs)).map(function (q) {
      var r = q.record
      var streak = r && r.streak ? r.streak.slice().reverse().map(function (h) { return '<i class="' + (h ? 'h' : '') + '"></i>' }).join('') : ''
      var good = r && r.rate >= q.breakeven
      return '<div class="sc' + (S.sub === q.key ? ' on' : '') + '"><div class="flex items-center justify-between"><b style="color:' + q.color + '">' + (q.sharp ? '<i class="fas fa-bolt text-yellow-300 mr-1"></i>精准 ' : q.main ? '主推 ' : '') + q.n_pick + ' 注' + (q.custom ? ' <span class="text-[9px] px-1 rounded bg-violet-500/20 text-violet-300 font-normal">自定义</span>' : '') + (q.sharp ? ' <span class="text-[9px] px-1 rounded bg-yellow-500/20 text-yellow-200 font-normal">二级</span>' : (!q.main ? ' <span class="text-[9px] px-1 rounded bg-slate-700/60 text-slate-300 font-normal">独立</span>' : '')) + '</b><span class="text-[10px] text-slate-500">保本 ' + pct(q.breakeven, 1) + '</span></div>' +
        (r ? '<div class="mt-1 flex items-baseline gap-2"><span class="mono text-xl font-black ' + (good ? 'text-emerald-300' : 'text-slate-200') + '">' + pct(r.rate, 1) + '</span><span class="text-[11px] text-slate-500">' + r.hits + '/' + r.n + ' 期</span>' + (r.z != null ? '<span class="text-[11px] mono ' + (r.z > 0 ? 'text-emerald-400' : 'text-slate-500') + '">z ' + (r.z > 0 ? '+' : '') + r.z + '</span>' : '') + '</div>' +
          '<div class="text-[11px] mt-1">累计 <b class="mono ' + (r.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(r.pnl) + '</b> · ROI <b class="mono ' + (r.roi >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + (r.roi > 0 ? '+' : '') + pct(r.roi, 2) + '</b></div><div class="streak mt-2">' + streak + '</div>' : '<div class="text-[11px] text-slate-500 mt-1">尚无结算</div>') + '</div>'
    }).join('')
  }
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
    var gtxt = p.guard && p.guard.z != null ? '<div class="text-slate-500 mb-1"><b>守门</b>：AI 近 ' + p.guard.n + ' 期滚动 z = ' + (p.guard.z > 0 ? '+' : '') + p.guard.z + (p.guard.active ? ' <span class="text-amber-300">低于 ' + p.guard.min_z + '，本期推荐已切换为组合最优（AI 号码仍在榜上结算）</span>' : ' <span class="text-emerald-400">≥ ' + p.guard.min_z + '，AI 推荐生效</span>') + '</div>' : ''
    if (!f && !b) return gtxt + '<div class="text-slate-500">' + (p.fallback ? '本期 AI 调用未成功（' + esc(p.error || '超时') + '），已用「组合最优 meta」策略兜底，保证每期形成选择。' : '推理内容暂无。') + '</div>'
    var h = [gtxt]
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
    renderSubTabs()
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
      $('cur-state').textContent = p.guard && p.guard.active ? '守门生效 · 改用组合最优' : p.status === 'fallback' ? '兜底（AI 调用失败）' : 'AI 已锁定'
      renderList()
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
  // ---------------------------------------------------------------- 对账：与上游 API 实时比对
  function selfCheck() {
    var btn = $('chk-btn'), out = $('chk-out'); if (!btn) return
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>拉取上游 API 比对中…'; out.classList.remove('hidden'); out.innerHTML = ''
    axios.get('/api/ai/self-check', { params: { source: S.source, n: 10 } }).then(function (r) {
      var d = r.data, sm = d.summary
      var head = '<div class="flex flex-wrap gap-x-4 gap-y-1 mb-2">' +
        '<span><i class="fas ' + (sm.in_sync ? 'fa-circle-check text-emerald-400' : 'fa-triangle-exclamation text-amber-400') + ' mr-1"></i>上游最新 <b class="mono">' + sm.upstream_latest + '</b> · 本库 <b class="mono">' + sm.local_latest + '</b> ' + (sm.in_sync ? '一致' : '<span class="text-amber-300">不一致</span>') + '</span>' +
        '<span><i class="fas ' + (sm.all_match ? 'fa-circle-check text-emerald-400' : 'fa-triangle-exclamation text-rose-400') + ' mr-1"></i>近 ' + sm.compared + ' 期 号码/时间/区块/hash ' + (sm.all_match ? '全部一致' : '<span class="text-rose-300">' + sm.mismatches + ' 期不一致</span>') + '</span>' +
        '<span><i class="fas ' + (sm.pending_ok ? 'fa-circle-check text-emerald-400' : 'fa-triangle-exclamation text-amber-400') + ' mr-1"></i>AI 待开期 <b class="mono">' + sm.pending_expect + '</b>（应为 ' + sm.expected_next + '）' + (sm.pending_ok ? ' ✓' : '') + '</span>' +
        '<span class="text-slate-500">上游耗时 ' + sm.upstream_ms + 'ms · 服务器北京时间 ' + sm.server_now_bj.slice(11) + '</span></div>'
      var rows = d.rows.map(function (x) {
        return '<tr class="' + (x.ok ? '' : 'text-rose-300') + '"><td class="mono">' + x.expect + '</td><td class="mono">' + x.upstream.openTime.slice(11) + '</td><td class="mono">' + x.upstream.opennumber + '</td><td class="mono">' + (x.local ? x.local.opennumber : '—') + '</td>' +
          '<td class="mono">' + (x.ai ? x.ai.actual + (x.ai.hit ? ' <span class="text-emerald-400">中#' + x.ai.rank + '</span>' : ' <span class="text-slate-500">未中</span>') : '—') + '</td><td class="mono text-slate-500">' + (x.ai ? x.ai.locked_bj : '—') + '</td><td>' + (x.ok ? '<i class="fas fa-check text-emerald-400"></i>' : esc(x.diffs.join('；'))) + '</td></tr>'
      }).join('')
      out.innerHTML = head + '<div class="overflow-auto"><table class="w-full text-[11px]"><thead class="text-slate-500"><tr><th class="text-left">期号</th><th class="text-left">上游开奖(北京)</th><th class="text-left">上游号码</th><th class="text-left">本库号码</th><th class="text-left">AI 结算</th><th class="text-left">AI 锁定(北京)</th><th class="text-left">比对</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    }).catch(function (e) { out.innerHTML = '<span class="text-rose-300">对账失败：' + esc(e.message) + '</span>' })
      .finally(function () { btn.disabled = false; btn.innerHTML = '<i class="fas fa-scale-balanced mr-1"></i>与上游 API 对账' })
  }
  var chk = $('chk-btn'); if (chk) chk.addEventListener('click', selfCheck)
  // ---------------------------------------------------------------- 注数回测
  function fetchStake() {
    axios.get('/api/arena/stake-curve', { params: { source: S.source, strategies: 'ai' } }).then(function (r) {
      var s = (r.data.strategies || [])[0]; var el = $('stake'), sec = $('stake-sec'); if (!s || !el) return
      sec.classList.remove('hidden')
      var rows = s.curve.map(function (c) {
        var pos = c.edge > 0
        return '<tr class="' + (c.N === s.best_N ? 'bg-amber-400/10' : '') + '"><td class="mono font-bold">' + c.N + (c.N === s.best_N ? ' <span class="text-amber-300">★</span>' : '') + '</td><td class="mono">' + pct(c.rate) + '</td><td class="mono text-slate-500">' + pct(c.breakeven) + '</td><td class="mono ' + (pos ? 'text-emerald-300' : 'text-rose-300') + '">' + (c.edge > 0 ? '+' : '') + pct(c.edge, 2) + '</td><td class="mono ' + (c.z >= 1.5 ? 'text-emerald-300' : c.z > 0 ? 'text-slate-200' : 'text-rose-300') + '">' + (c.z > 0 ? '+' : '') + c.z + '</td><td class="mono ' + (c.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(c.pnl) + '</td><td class="mono font-bold ' + (c.roi >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + (c.roi > 0 ? '+' : '') + pct(c.roi, 2) + '</td></tr>'
      }).join('')
      el.innerHTML = '<table class="w-full text-[12px]"><thead class="text-slate-500 text-[11px]"><tr><th class="text-left py-1">前 N 注</th><th class="text-left">命中率</th><th class="text-left">保本</th><th class="text-left">edge</th><th class="text-left">z</th><th class="text-left">累计盈亏</th><th class="text-left">ROI</th></tr></thead><tbody>' + rows + '</tbody></table>'
      $('stake-best').innerHTML = s.best_N ? '样本 ' + s.periods + ' 期 · ROI 最优：<b class="text-amber-300 mono">前 ' + s.best_N + ' 注</b>（' + (s.best_roi > 0 ? '+' : '') + pct(s.best_roi, 2) + '）' : ''
    }).catch(function () {})
  }
  // ---------------------------------------------------------------- 多组独立生成（每档 5 组 A–E）
  var SETS = { n: 500, data: null, board: null }
  try { SETS.n = +(localStorage.getItem('ai:setsn') || 500) || 500 } catch (e) {}
  function setsBest(n) { var b = SETS.board && (SETS.board.tiers || []).find(function (t) { return t.n === n }); return b || null }
  function renderSets() {
    var d = SETS.data, sec = $('sets-sec'); if (!sec) return
    if (!d || !d.expect || !d.ns || !d.ns.length) { sec.classList.add('hidden'); return }
    sec.classList.remove('hidden')
    if (d.ns.indexOf(SETS.n) < 0) SETS.n = d.ns.indexOf(500) >= 0 ? 500 : d.ns[d.ns.length - 1]
    $('sets-expect').textContent = '期号 ' + d.expect
    $('sets-ntabs').innerHTML = d.ns.map(function (n) { return '<button class="hn' + (n === SETS.n ? ' on' : '') + '" data-n="' + n + '">' + n + '</button>' }).join('') + '<span class="text-[11px] text-slate-500 ml-1">注</span>'
    $('sets-ntabs').querySelectorAll('.hn').forEach(function (b) { b.addEventListener('click', function () { SETS.n = +b.getAttribute('data-n'); try { localStorage.setItem('ai:setsn', SETS.n) } catch (e) {} renderSets() }) })
    var arr = (d.sets || {})[SETS.n] || [], best = setsBest(SETS.n)
    if (!arr.length) { $('sets-cards').innerHTML = '<div class="text-xs text-slate-500 col-span-5">本期该档位的 5 组尚未生成（AI 推理完成后自动出现）</div>'; return }
    $('sets-cards').innerHTML = arr.map(function (g) {
      var st = best && best.sets.find(function (s) { return s.id === g.id }), a = st && st.all, rc = st && st.recent
      var crown = best && best.best === g.id ? ' <i class="fas fa-crown text-amber-300" title="该注数下历史 z 最高"></i>' : '', fire = best && best.best_recent === g.id ? ' <i class="fas fa-fire text-orange-400" title="近 60 期 z 最高"></i>' : ''
      var good = a && a.rate != null && a.rate >= a.breakeven
      return '<div class="rounded-xl border p-3 flex flex-col gap-2" style="border-color:' + g.color + '55;background:#0b1220">' +
        '<div class="flex items-center justify-between"><b style="color:' + g.color + '">' + g.id + ' · ' + esc(g.name) + '</b><span>' + crown + fire + '</span></div>' +
        '<div class="text-[10.5px] text-slate-500 leading-snug">' + esc(g.desc) + (g.overlap_a != null && g.id !== 'A' ? ' · 与 A 重叠 ' + g.overlap_a : '') + '</div>' +
        (a && a.n ? '<div class="text-[11px]"><span class="mono font-bold ' + (good ? 'text-emerald-300' : 'text-slate-200') + '">' + pct(a.rate, 1) + '</span><span class="text-slate-500"> ' + a.hits + '/' + a.n + ' · z ' + (a.z > 0 ? '+' : '') + a.z + ' · ' + fmtInt(a.pnl) + '</span>' + (rc && rc.n ? '<div class="text-slate-500">近 ' + rc.n + ' 期 ' + pct(rc.rate, 1) + (rc.current_miss ? ' · 连挂 ' + rc.current_miss : '') + '</div>' : '') + '<div class="streak mt-1">' + (a.streak || []).slice().reverse().map(function (h) { return '<i class="' + (h ? 'h' : '') + '"></i>' }).join('') + '</div></div>' : '<div class="text-[11px] text-slate-600">尚无结算样本</div>') +
        (g.hit != null ? '<div class="text-[11px] ' + (g.hit ? 'text-emerald-300' : 'text-slate-500') + '">本期 ' + (g.hit ? '命中 #' + g.rank : '未中') + '</div>' : '') +
        '<button class="mt-auto text-xs px-2 py-1.5 rounded-lg font-semibold text-black s-copy" style="background:' + g.color + '" data-k="' + g.key + '"><i class="fas fa-copy mr-1"></i>复制 ' + g.count + ' 注</button></div>'
    }).join('')
    $('sets-cards').querySelectorAll('.s-copy').forEach(function (b) { b.addEventListener('click', function () { var g = arr.find(function (x) { return x.key === b.getAttribute('data-k') }); if (g) copyText(joinNums(g.numbers, S.fmt), b) }) })
    // 组别榜（当前 N）
    if (best) {
      $('sets-board').innerHTML = '<div class="text-[11px] text-slate-500 mb-1">前 ' + SETS.n + ' 注 · 5 组历史对比（样本 ' + (SETS.board.periods || 0) + ' 期，保本 ' + pct(SETS.n / 950, 1) + '）</div><div class="overflow-x-auto"><table class="w-full text-[11px]"><thead><tr class="text-slate-600"><th class="text-left font-normal py-1">组</th><th class="font-normal">命中率</th><th class="font-normal">z</th><th class="font-normal">ROI</th><th class="font-normal">累计</th><th class="font-normal">近 60 期</th><th class="font-normal">当前连挂</th></tr></thead><tbody>' +
        best.sets.map(function (s) { var a = s.all, r = s.recent; return '<tr class="' + (best.best === s.id ? 'bg-amber-400/10' : '') + '"><td class="py-1"><b style="color:' + s.color + '">' + s.id + ' ' + esc(s.short) + '</b>' + (best.best === s.id ? ' <i class="fas fa-crown text-amber-300"></i>' : '') + (best.best_recent === s.id ? ' <i class="fas fa-fire text-orange-400"></i>' : '') + '</td><td class="text-center mono ' + (a.rate != null && a.rate >= a.breakeven ? 'text-emerald-300' : '') + '">' + pct(a.rate, 1) + ' <span class="text-slate-600">' + a.hits + '/' + a.n + '</span></td><td class="text-center mono ' + (a.z > 0 ? 'text-emerald-300' : 'text-slate-400') + '">' + (a.z == null ? '—' : (a.z > 0 ? '+' : '') + a.z) + '</td><td class="text-center mono">' + (a.roi == null ? '—' : ((a.roi >= 0 ? '+' : '') + (a.roi * 100).toFixed(2) + '%')) + '</td><td class="text-center mono ' + (a.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(a.pnl) + '</td><td class="text-center mono">' + pct(r.rate, 1) + '</td><td class="text-center mono ' + (r.current_miss >= 4 ? 'text-rose-300' : 'text-slate-400') + '">' + (r.current_miss || '·') + '</td></tr>' }).join('') + '</tbody></table></div>'
    } else $('sets-board').innerHTML = ''
  }
  function fetchSets() {
    if (!S.source) return
    Promise.all([axios.get('/api/ai/sets', { params: { source: S.source } }), axios.get('/api/ai/sets/board', { params: { source: S.source } })]).then(function (rs) { SETS.data = rs[0].data; SETS.board = rs[1].data; renderSets() }).catch(function () {})
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
  // 档位 key → 显示标签：ai-150 → 150；ai-custom-200 → 200★（★ 标记自定义档）
  function tierN(k) { var m = /(\d+)$/.exec(k); return m ? +m[1] : 0 }
  function tierLabel(k) { return (k.indexOf('sharp') >= 0 ? '⚡' : '') + tierN(k) + (k.indexOf('custom') >= 0 ? '★' : '') }
  function tierKeys(sub) { return Object.keys(sub || {}).sort(function (a, b) { return tierN(a) - tierN(b) }) }
  // ---------------------------------------------------------------- 逐期记录（紧凑表格：50/100/200/500/1000 期，独立接口，展开懒加载详情）
  var H = { n: 50, rows: [], tiers: [], summary: [], loading: false, ver: 0, cache: {} }
  try { H.n = +(localStorage.getItem('ai:histn') || 50) || 50 } catch (e) {}
  function tierShort(t) { return t.key === 'ai' ? '500' : (t.sharp ? '⚡' : '') + String(t.n_pick) + (t.custom ? '★' : '') }
  function renderHistHead() {
    var th = '<th class="l">期号</th><th>开奖</th>' +
      H.tiers.map(function (t) { return '<th' + (t.custom ? ' class="c"' : t.sharp ? ' class="s"' : '') + ' title="' + (t.sharp ? '二级精准 ' : t.key === 'ai' ? '主推 ' : '独立生成 ') + t.n_pick + ' 注' + (t.custom ? '（自定义）' : '') + '">' + tierShort(t) + '</th>' }).join('') +
      '<th>位次</th><th class="r">盈亏</th><th class="rg l">AI 判断</th>'
    $('hist-head').innerHTML = th
  }
  function renderHistSum() {
    var el = $('hist-sum'); if (!el) return
    el.innerHTML = '<span class="t"><span class="text-slate-500">近 ' + H.rows.length + ' 期</span></span>' + H.summary.map(function (t) {
      var good = t.rate != null && t.rate >= t.breakeven
      return '<span class="t' + (good ? ' good' : '') + (t.custom ? ' c' : '') + '" title="保本 ' + pct(t.breakeven, 1) + ' · z ' + (t.z == null ? '—' : t.z) + '">' + tierShort(t) + ' <b>' + (t.rate == null ? '—' : pct(t.rate, 1)) + '</b><span class="text-slate-600">' + t.hits + '/' + t.n + '</span><b class="' + (t.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(t.pnl) + '</b></span>'
    }).join('')
  }
  function renderHist() {
    var rows = H.rows || []
    renderHistHead(); renderHistSum()
    if (!rows.length) { $('hist').innerHTML = '<tr><td colspan="' + (H.tiers.length + 5) + '" class="py-4 text-slate-500">还没有已开奖的 AI 推荐记录</td></tr>'; $('hist-foot').textContent = ''; return }
    var out = [], hits = 0, pnl = 0
    for (var i = 0; i < rows.length; i++) {
      var h = rows[i]; if (h.hit) hits++; pnl += h.pnl || 0
      var cells = H.tiers.map(function (t) { var v = h.sub ? h.sub[t.key] : null; return '<td><span class="cell' + (v ? ' h' : v === null ? ' na' : '') + (t.custom ? ' c' : '') + (t.sharp ? ' s' : '') + '" title="' + (v === null ? '该期无独立生成记录' : '') + '"></span></td>' }).join('')
      out.push('<tr class="hr' + (h.hit ? ' hit' : '') + '" data-e="' + h.expect + '">' +
        '<td class="ex l">' + h.expect.slice(8) + '<small>' + h.expect.slice(4, 6) + '/' + h.expect.slice(6, 8) + ' ' + hhmmShort(h.open_ms) + '</small></td>' +
        '<td class="ac">' + (h.actual || '—') + '</td>' + cells +
        '<td class="rk">' + (h.hit ? '#' + h.rank : '·') + '</td>' +
        '<td class="pn r ' + (h.pnl > 0 ? 'p' : 'm') + '">' + fmtInt(h.pnl) + '</td>' +
        '<td class="rg' + (h.fallback ? ' fb' : '') + '" title="' + esc(h.regime || '') + '">' + (h.fallback ? '兜底' : esc(h.regime || '')) + (h.confidence ? ' <span class="text-slate-600">' + pct(h.confidence, 0) + '</span>' : '') + '</td></tr>')
    }
    $('hist').innerHTML = out.join('')
    $('hist-foot').innerHTML = '本窗口 500 注：命中 ' + hits + '/' + rows.length + '（' + pct(hits / rows.length, 1) + '，保本 52.6%）· 累计 <b class="mono ' + (pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(pnl) + '</b> · 期号列显示当日序号，小字为 月/日 开奖时刻（北京）'
  }
  function hhmmShort(ms) { if (!ms) return ''; var d = new Date(ms + 8 * 3600e3); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') }
  function fetchHist(force) {
    if (!S.source) return
    var ver = ++H.ver; H.loading = true
    $('hist-n').querySelectorAll('.hn').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-n') === H.n) })
    return axios.get('/api/ai/history', { params: { source: S.source, n: H.n, _: force ? Date.now() : undefined } }).then(function (r) {
      if (ver !== H.ver) return
      var d = r.data; if (!d.ok) throw new Error(d.error || 'history failed')
      H.rows = d.history || []; H.tiers = d.tiers || []; H.summary = d.summary || []; H.loading = false
      renderHist()
    }).catch(function (e) { H.loading = false; $('hist').innerHTML = '<tr><td colspan="9" class="py-3 text-rose-400">' + esc(e.message) + '</td></tr>' })
  }
  $('hist-n').addEventListener('click', function (e) {
    var b = e.target.closest('.hn'); if (!b) return
    H.n = +b.getAttribute('data-n'); try { localStorage.setItem('ai:histn', H.n) } catch (err) {}
    fetchHist(true)
  })
  // 展开：懒加载该期 500 注 + 推理；再次点击收起
  $('hist').addEventListener('click', function (e) {
    var tr = e.target.closest('tr.hr'); if (!tr) return
    var expect = tr.getAttribute('data-e'), next = tr.nextElementSibling
    if (next && next.classList.contains('det')) { next.remove(); tr.classList.remove('open'); return }
    var det = document.createElement('tr'); det.className = 'det'
    det.innerHTML = '<td colspan="' + (H.tiers.length + 5) + '"><span class="text-xs text-slate-500"><i class="fas fa-circle-notch fa-spin mr-1"></i>加载该期 500 注…</span></td>'
    tr.after(det); tr.classList.add('open')
    var fill = function (h) {
      var nums = String(h.numbers || '').trim().split(/\s+/)
      var td = det.firstElementChild
      td.innerHTML = '<div class="text-xs text-slate-500 mb-2">北京时间 ' + hhmm(h.open_ms) + ' 开出 <b class="text-slate-200 mono">' + esc(h.actual) + '</b> · ' + h.count + ' 注' + (h.hit ? ' · 命中位次 #' + h.rank : ' · 未命中') + (h.model ? ' · ' + esc(h.model) + (h.latency_ms ? ' ' + (h.latency_ms / 1000).toFixed(1) + 's' : '') : '') +
        ' <button class="ml-2 text-pink-300 hover:text-pink-200 h-copy" data-n="500"><i class="fas fa-copy mr-1"></i>复制 500</button>' +
        H.tiers.filter(function (t) { return t.key !== 'ai' && t.n_pick <= nums.length }).map(function (t) { return ' <button class="ml-1 ' + (t.custom ? 'text-violet-300 hover:text-violet-200' : 'text-pink-300 hover:text-pink-200') + ' h-copy" data-n="' + t.n_pick + '">前 ' + tierShort(t) + '</button>' }).join('') + '</div>' +
        '<div class="grid500">' + gridHtml(nums, h.boost, h.actual) + '</div>' +
        (h.reasoning || h.pick_plan ? '<div class="reason mt-3">' + (h.reasoning ? '<div><b>推理</b>：' + esc(h.reasoning) + '</div>' : '') + (h.pick_plan ? '<div class="mt-1"><b>方案</b>：' + esc(h.pick_plan) + '</div>' : '') + '</div>' : '')
      td.querySelectorAll('.h-copy').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); var k = +b.getAttribute('data-n'); copyText(joinNums(nums.slice(0, k), S.fmt), b) }) })
    }
    if (H.cache[expect]) { fill(H.cache[expect]); return }
    axios.get('/api/ai/history/' + expect, { params: { source: S.source } }).then(function (r) { if (!r.data.ok) throw new Error(r.data.error); H.cache[expect] = r.data; if (det.isConnected) fill(r.data) })
      .catch(function (err) { det.firstElementChild.innerHTML = '<span class="text-xs text-rose-400">' + esc(err.message) + '</span>' })
  })

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
  $('copy-btn').addEventListener('click', function () { var n = activeNums(); if (n.length) copyText(joinNums(n, S.fmt), $('copy-btn')) })
  $('fmt').addEventListener('change', function () { S.fmt = $('fmt').value; try { localStorage.setItem('ai:fmt', S.fmt) } catch (e) {} if (S.pick) $('cur-text').value = joinNums(activeNums(), S.fmt) })
  $('cur-text').addEventListener('click', function () { this.select() })

  // ---------------------------------------------------------------- 数据
  function applyPick(d) {
    S.pick = d.pick; S.record = d.record; S.history = d.history || []; S.lead = d.lead_ms || 20000; S.provider = d.provider; S.model = d.model; S.sync = d.sync
    renderSync(d.sync)
    var hm = $('hd-model'); if (hm) hm.textContent = (d.provider ? d.provider + ' · ' : '') + (d.model || '') + ' · 开奖前 ' + Math.round(S.lead / 1000) + 's 锁定'
    renderCur(); renderStats(); renderSubStats()
    var lastExp = (d.history && d.history[0] && d.history[0].expect) || null
    if (lastExp && lastExp !== H.lastExp) { H.lastExp = lastExp; fetchHist(false) }
    var pe = d.pick && d.pick.expect; if (pe && pe !== SETS.lastExp) { SETS.lastExp = pe; if (S.loaded) fetchSets() }
    if (d.pick && d.pick.status === 'ready' && SETS.data && SETS.data.expect === pe && !((SETS.data.sets || {})[SETS.n] || []).length && S.loaded) fetchSets()
  }
  function fetchPick(force) {
    var ver = ++S.ver
    return axios.get('/api/arena/pick', { params: { source: S.source, history: 1, _: force ? Date.now() : undefined } }).then(function (r) {
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
      var sb = $('stale-bar'); if (sb) { if (st.stale || st.fail_streak >= 3) { sb.classList.remove('hidden'); sb.innerHTML = '<i class="fas fa-triangle-exclamation mr-2"></i>数据源异常：' + (st.stale ? '距最新开奖已 ' + Math.round(st.lag_ms / 1000) + 's 无新期' : '') + (st.fail_streak >= 3 ? ' · 连续 ' + st.fail_streak + ' 次拉取失败（' + esc(st.last_error || '') + '）' : '') + ' · 系统每 4s 自动重试，当前显示为最后一期有效数据' } else sb.classList.add('hidden') }
      if (prev && prev.latest_expect !== st.latest_expect) { S.waitStart = 0; fetchPick(true); setTimeout(fetchStake, 3000) }
      return st
    }).catch(function () { return null })
  }
  // 倒计时：按预计开奖时刻 + 发布延迟；归零后每 4s 轮询 status 直到新期号
  function tickCountdown() {
    var st = S.status, el = $('cur-cd')
    if (!st) { el.textContent = '—'; return }
    var target = (st.expected_publish_ms || st.next_due_ms || 0) + PUBLISH_DELAY
    var ob = $('cur-open-bj'); if (ob) ob.textContent = '· 预计北京时间 ' + bj(st.expected_publish_ms || st.next_due_ms, true) + ' 开奖'
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
      sel.addEventListener('change', function () { S.source = sel.value; try { localStorage.setItem('ai:source', S.source) } catch (e) {} $('loader').classList.remove('hidden'); H.lastExp = null; H.cache = {}; ['cur', 'stats', 'hist-sec'].forEach(function (id) { $(id).classList.add('hidden') }); boot() })
      boot()
      setInterval(tickCountdown, 500)
      setInterval(function () { if (document.visibilityState === 'visible') fetchStatus(false) }, 20000)
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') fetchStatus(true).then(function () { fetchPick(true) }) })
    }).catch(function (e) { $('ld-text').innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400 mr-2"></i>无法连接数据源：' + esc(e.message) })
  }
  init()
})()
