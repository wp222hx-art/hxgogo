/* /query：逐期命中查询（期号 / 当日序号 / 日期 / 最近 N 期 / 只看命中）+ 后台运行状态指示 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  var pct = function (x, d) { return x == null ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%' }
  var fmtInt = function (n) { n = Math.round(n || 0); return (n > 0 ? '+' : '') + n.toLocaleString('zh-CN') }
  var BJ = 8 * 3600e3
  var bj = function (ms, withDate) { if (!ms) return ''; var d = new Date(ms + BJ); var t = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0'); return withDate ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + t : t }
  var S = { source: 'qkltj:6001', tiers: [], rows: [], last: null, hitOnly: false, detail: {} }
  try { S.source = localStorage.getItem('ai:source') || S.source } catch (e) {}
  var tierShort = function (t) { return t.key === 'ai' ? '500' : String(t.n_pick) + (t.custom ? '★' : '') }

  // ---------------------------------------------------------------- 后台状态
  function renderBg(d) {
    var alive = d.heartbeat_alive
    $('bg-dot').className = 'dot ' + (alive ? 'ok' : 'bad')
    $('bg-text').innerHTML = alive ? '<span class="text-emerald-300">后台运行中</span>' + (d.keeper_alive ? ' · 守护 ✓' : ' · <span class="text-amber-400">守护未响应</span>') : '<span class="text-rose-400">后台心跳停止</span>'
    $('k-hb').innerHTML = alive ? '<span class="text-emerald-300">在跑</span> · 剩余 ' + d.heartbeat_left_s + 's 自动续命 · 累计 ' + (d.ticks || 0).toLocaleString() + ' 跳' : '<span class="text-rose-400">停止</span>'
    $('k-keeper').innerHTML = d.keeper_alive ? '<span class="text-emerald-300">在线</span> · ' + Math.round((d.now - d.keeper_last_ms) / 1000) + 's 前续命' : (d.keeper_last_ms ? '<span class="text-amber-400">' + Math.round((d.now - d.keeper_last_ms) / 1000) + 's 未响应</span>' : '<span class="text-slate-500">未启动</span>')
    var lf = d.last_forecast
    $('k-last').innerHTML = lf ? '<span class="text-amber-300">' + esc(lf.expect) + '</span> · ' + bj(lf.created_ms, true) + ' · ' + (lf.ok ? '<span class="text-emerald-300">成功</span>' : '<span class="text-rose-400">兜底</span>') + ' · ' + esc(lf.trigger || '') : '—'
    $('k-24h').innerHTML = d.forecasts_24h.n + ' 次 · 成功 ' + d.forecasts_24h.ok
    $('k-scored').innerHTML = d.scored.n + ' 期 · 命中 ' + d.scored.hits + '（' + pct(d.scored.n ? d.scored.hits / d.scored.n : null) + '）'
  }
  function fetchBg() { axios.get('/api/keeper/status', { params: { source: S.source } }).then(function (r) { renderBg(r.data) }).catch(function () { $('bg-dot').className = 'dot bad'; $('bg-text').textContent = '无法连接服务' }) }

  // ---------------------------------------------------------------- 列表
  function renderHead() {
    $('thead').innerHTML = '<th class="l">期号</th><th class="tm">开奖时间（北京）</th><th>开奖</th>' + S.tiers.map(function (t) { return '<th' + (t.custom ? ' class="c"' : '') + ' title="前 ' + t.n_pick + ' 注">' + tierShort(t) + '</th>' }).join('') + '<th>位次</th><th class="r">盈亏</th>'
  }
  function renderSum(summary, n) {
    $('sum').innerHTML = '<span class="t"><span class="text-slate-500">' + n + ' 期</span></span>' + (summary || []).map(function (t) {
      var good = t.rate != null && t.rate >= t.breakeven
      return '<span class="t' + (good ? ' good' : '') + (t.custom ? ' c' : '') + '" title="保本 ' + pct(t.breakeven) + '">' + tierShort(t) + ' <b class="r">' + pct(t.rate) + '</b><span class="text-slate-600">' + t.hits + '/' + t.n + '</span><b class="' + (t.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(t.pnl) + '</b></span>'
    }).join('')
  }
  function renderRows(rows, hl) {
    if (!rows.length) { $('tbody').innerHTML = '<tr><td class="py-6 text-slate-500" colspan="' + (S.tiers.length + 5) + '">没有匹配的记录</td></tr>'; $('foot').textContent = ''; return }
    var hits = 0, pnl = 0
    $('tbody').innerHTML = rows.map(function (h) {
      if (h.hit) hits++; pnl += h.pnl || 0
      return '<tr class="' + (h.hit ? 'hit' : '') + (hl === h.expect ? ' hl' : '') + '" data-e="' + h.expect + '">' +
        '<td class="ex l">' + h.expect.slice(0, 8) + '<b>' + h.expect.slice(8) + '</b></td>' +
        '<td class="tm text-slate-500">' + bj(h.open_ms, true) + '</td>' +
        '<td class="ac">' + (h.actual || '—') + '</td>' +
        S.tiers.map(function (t) { return '<td><span class="cell' + (h.sub && h.sub[t.key] ? ' h' : '') + (t.custom ? ' c' : '') + '"></span></td>' }).join('') +
        '<td class="rk">' + (h.hit ? '#' + h.rank : '·') + '</td>' +
        '<td class="r ' + (h.pnl > 0 ? 'p' : 'm') + '">' + fmtInt(h.pnl) + '</td></tr>'
    }).join('')
    $('foot').innerHTML = '500 注：命中 ' + hits + '/' + rows.length + '（' + pct(hits / rows.length) + '，保本 52.6%）· 累计 <b class="mono ' + (pnl >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + fmtInt(pnl) + '</b> · 点击任一行查看该期详情'
  }

  // ---------------------------------------------------------------- 单期卡
  function showOne(h) {
    $('one').classList.remove('hidden')
    $('o-expect').textContent = h.expect; $('o-time').textContent = '北京时间 ' + bj(h.open_ms, true) + ' 开奖'
    $('o-actual').textContent = h.actual || '—'; $('o-actual').className = 'big ' + (h.hit ? 'text-emerald-400' : 'text-slate-200')
    $('o-res').innerHTML = h.hit ? '<span class="text-emerald-400"><i class="fas fa-check-circle mr-1"></i>命中 · 位次 #' + h.rank + '</span><div class="text-xs text-emerald-300/70 font-normal">盈亏 ' + fmtInt(h.pnl) + '</div>' : '<span class="text-slate-400"><i class="fas fa-circle-xmark mr-1"></i>未命中</span><div class="text-xs text-slate-500 font-normal">盈亏 ' + fmtInt(h.pnl) + '</div>'
    $('o-tiers').innerHTML = S.tiers.map(function (t) { var ok = h.sub && h.sub[t.key]; return '<span class="px-2.5 py-1 rounded-lg text-xs font-bold mono ' + (ok ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-500') + (t.custom ? ' ring-1 ring-violet-500/60' : '') + '">前 ' + tierShort(t) + (ok ? ' ✓' : ' ✗') + '</span>' }).join('')
    $('o-regime').innerHTML = h.fallback ? '<span class="text-slate-600 italic">该期 AI 未成功，使用兜底策略</span>' : '<b class="text-slate-300">AI 判断</b>：' + esc(h.regime || '') + (h.confidence ? ' <span class="text-slate-600">置信 ' + pct(h.confidence, 0) + '</span>' : '')
    var g = $('o-grid'); g.style.display = 'none'; g.innerHTML = ''; $('o-copy-wrap').innerHTML = ''
    $('o-show').onclick = function () {
      if (g.style.display !== 'none') { g.style.display = 'none'; return }
      g.style.display = 'block'; g.innerHTML = '<span class="text-xs text-slate-500"><i class="fas fa-circle-notch fa-spin mr-1"></i>加载 500 注…</span>'
      var fill = function (d) {
        var nums = String(d.numbers || '').trim().split(/\s+/), bs = {}; (d.boost || []).forEach(function (n) { bs[n] = 1 })
        g.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:3px">' + nums.map(function (n) { var c = n === d.actual ? 'background:#22c55e;color:#000;font-weight:800' : bs[n] ? 'background:#f472b6;color:#000;font-weight:700' : 'background:rgba(148,163,184,.10);color:#e2e8f0'; return '<span class="mono" style="font-size:12px;text-align:center;padding:3px 0;border-radius:4px;' + c + '">' + n + '</span>' }).join('') + '</div>' + (d.reasoning ? '<div class="text-xs text-slate-400 mt-3 leading-relaxed"><b class="text-slate-300">推理</b>：' + esc(d.reasoning) + '</div>' : '')
        $('o-copy-wrap').innerHTML = '<button class="qk" id="o-copy"><i class="fas fa-copy mr-1"></i>复制 500 注</button>'
        $('o-copy').onclick = function () { var t = nums.join(' '); var done = function () { $('o-copy').innerHTML = '<i class="fas fa-check mr-1"></i>已复制' }; if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, done); else done() }
      }
      if (S.detail[h.expect]) return fill(S.detail[h.expect])
      axios.get('/api/ai/history/' + h.expect, { params: { source: S.source } }).then(function (r) { S.detail[h.expect] = r.data; fill(r.data) }).catch(function (e) { g.innerHTML = '<span class="text-xs text-rose-400">' + esc(e.message) + '</span>' })
    }
    $('one').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // ---------------------------------------------------------------- 查询
  function run(params, label) {
    params.source = S.source; if (S.hitOnly) params.hit = 1
    $('q-msg').innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>查询中…'
    document.querySelectorAll('.qk[data-n]').forEach(function (b) { b.classList.toggle('on', !!params.n && +b.getAttribute('data-n') === +params.n && !params.expect && !params.date) })
    return axios.get('/api/ai/query', { params: params }).then(function (r) {
      var d = r.data; if (!d.ok) throw new Error(d.error || 'query failed')
      S.tiers = d.tiers || []; S.rows = d.history || []; S.last = params
      renderHead(); renderSum(d.summary, S.rows.length); renderRows(S.rows, d.mode === 'expect' && S.rows[0] ? S.rows[0].expect : null)
      $('q-msg').textContent = label + ' · ' + S.rows.length + ' 条'
      if (d.mode === 'expect') { if (S.rows[0]) showOne(S.rows[0]); else { $('one').classList.add('hidden'); $('q-msg').innerHTML = '<span class="text-amber-400">未找到该期 AI 记录（可能尚未开奖或早于 AI 上线）</span>' } }
      else $('one').classList.add('hidden')
    }).catch(function (e) { $('q-msg').innerHTML = '<span class="text-rose-400">' + esc(e.message) + '</span>' })
  }
  function go() {
    var ex = $('q-expect').value.replace(/\D/g, ''), dt = $('q-date').value
    if (ex) return run({ expect: ex, date: dt }, '期号 ' + ex)
    if (dt) return run({ date: dt }, dt)
    return run({ n: 100 }, '最近 100 期')
  }
  $('q-go').addEventListener('click', go)
  $('q-expect').addEventListener('keydown', function (e) { if (e.key === 'Enter') go() })
  $('q-date').addEventListener('change', function () { if (!$('q-expect').value) go() })
  document.querySelectorAll('.qk[data-n]').forEach(function (b) { b.addEventListener('click', function () { $('q-expect').value = ''; $('q-date').value = ''; run({ n: +b.getAttribute('data-n') }, '最近 ' + b.getAttribute('data-n') + ' 期') }) })
  document.querySelector('.qk[data-hit]').addEventListener('click', function () { S.hitOnly = !S.hitOnly; this.classList.toggle('on', S.hitOnly); if (S.last) run(Object.assign({}, S.last, { hit: undefined }), $('q-msg').textContent.split(' · ')[0] || '') })
  $('tbody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-e]'); if (!tr) return; var h = S.rows.find(function (x) { return x.expect === tr.getAttribute('data-e') }); if (h) { $('tbody').querySelectorAll('tr.hl').forEach(function (r) { r.classList.remove('hl') }); tr.classList.add('hl'); showOne(h) } })

  // ---------------------------------------------------------------- 启动
  axios.get('/api/sources').then(function (r) {
    var list = (r.data.sources || []).filter(function (s) { return s.key.indexOf('qkltj:') === 0 })
    var sel = $('source'); sel.innerHTML = list.map(function (s) { return '<option value="' + s.key + '">' + esc(s.name) + '</option>' }).join('')
    if (!list.some(function (s) { return s.key === S.source })) S.source = list[0] ? list[0].key : S.source
    sel.value = S.source
    sel.addEventListener('change', function () { S.source = sel.value; try { localStorage.setItem('ai:source', S.source) } catch (e) {} S.detail = {}; fetchBg(); go() })
    // 从 URL 带入 ?expect= / ?date=
    var u = new URLSearchParams(location.search); if (u.get('expect')) $('q-expect').value = u.get('expect'); if (u.get('date')) $('q-date').value = u.get('date')
    fetchBg(); go()
  })
  setInterval(fetchBg, 10000)
  // 有新开奖时自动刷新“最近 N 期”视图
  setInterval(function () { if (S.last && S.last.n && !S.last.expect && !S.last.date) run(S.last, '最近 ' + S.last.n + ' 期') }, 30000)
})()
