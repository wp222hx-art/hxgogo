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
    $('bg-text').innerHTML = alive ? '<span class="text-emerald-300">后台运行中</span>' + (d.keeper_alive ? (d.keeper_warming ? ' · 守护启动中' : ' · 守护 ✓') : ' · <span class="text-amber-400">守护未响应</span>') : '<span class="text-rose-400">后台心跳停止</span>'
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

  // ---------------------------------------------------------------- 5 组独立生成 · 组别对比
  var SB = { k: 60 }
  function renderSetsBoard(d) {
    var ids = d.ids || ['A', 'B', 'C', 'D', 'E'], meta = d.meta || {}
    $('sets-n').textContent = '样本 ' + (d.periods || 0) + ' 期 · 近期窗口 ' + d.recent_k + ' 期'
    $('sets-head').innerHTML = '<th class="l">注数</th>' + ids.map(function (id) { var m = meta[id] || {}; return '<th style="color:' + (m.color || '#94a3b8') + '">' + id + ' ' + esc(m.short || '') + '</th>' }).join('') + '<th class="l">结论</th>'
    if (!d.periods) { $('sets-body').innerHTML = '<tr><td colspan="' + (ids.length + 2) + '" class="py-4 text-slate-500">尚无组别结算样本（每期 AI 推理后自动生成并结算）</td></tr>'; return }
    $('sets-body').innerHTML = (d.tiers || []).map(function (t) {
      var cells = ids.map(function (id) {
        var s = t.sets.find(function (x) { return x.id === id }); if (!s) return '<td>—</td>'
        var a = s.all, r = s.recent, good = a.rate != null && a.rate >= a.breakeven
        var mark = (t.best === id ? ' <i class="fas fa-crown text-amber-300"></i>' : '') + (t.best_recent === id ? ' <i class="fas fa-fire text-orange-400"></i>' : '')
        return '<td class="' + (t.best === id ? 'bg-amber-400/10' : '') + '"><div class="mono font-bold ' + (good ? 'text-emerald-300' : 'text-slate-200') + '">' + pct(a.rate, 1) + mark + '</div><div class="text-[10.5px] text-slate-500 mono">' + a.hits + '/' + a.n + ' · z ' + (a.z == null ? '—' : (a.z > 0 ? '+' : '') + a.z) + '</div><div class="text-[10.5px] mono ' + (a.pnl >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80') + '">' + fmtInt(a.pnl) + '</div><div class="text-[10.5px] text-slate-600 mono">近' + r.n + ' ' + pct(r.rate, 0) + (r.current_miss >= 3 ? ' <span class="text-rose-400">挂' + r.current_miss + '</span>' : '') + '</div></td>'
      }).join('')
      var b = t.sets.find(function (x) { return x.id === t.best }), br = t.sets.find(function (x) { return x.id === t.best_recent })
      var concl = b ? ('历史看 <b style="color:' + b.color + '">' + b.id + ' ' + esc(b.short) + '</b>（z ' + (b.all.z > 0 ? '+' : '') + b.all.z + '）' + (br && br.id !== b.id ? '，近期 <b style="color:' + br.color + '">' + br.id + '</b> 更热' : '') + (b.all.z != null && b.all.z < 1 ? ' · <span class="text-slate-500">差异未显著</span>' : '')) : '<span class="text-slate-500">样本不足</span>'
      return '<tr><td class="l"><b class="text-slate-100">' + t.n + '</b><div class="text-[10.5px] text-slate-500">保本 ' + pct(t.n / 950, 1) + '</div></td>' + cells + '<td class="l text-[11px] text-slate-400" style="white-space:normal;min-width:150px">' + concl + '</td></tr>'
    }).join('')
  }
  function fetchSetsBoard() { axios.get('/api/ai/sets/board', { params: { source: S.source, k: SB.k } }).then(function (r) { renderSetsBoard(r.data) }).catch(function (e) { $('sets-body').innerHTML = '<tr><td colspan="7" class="py-3 text-rose-400">' + esc(e.message) + '</td></tr>' }) }
  $('sets-k').addEventListener('click', function (e) { var b = e.target.closest('.qk'); if (!b) return; SB.k = +b.getAttribute('data-k'); $('sets-k').querySelectorAll('.qk').forEach(function (x) { x.classList.toggle('on', x === b) }); fetchSetsBoard() })

  // ---------------------------------------------------------------- 档位分析（下一期概率 / 长龙 / 进坑 / 倍投）
  var TA = { conf: 0.6, round: 10 }
  var money = function (n) { n = Math.round(n || 0); return '<span class="' + (n >= 0 ? 'text-emerald-300' : 'text-rose-300') + '">' + (n > 0 ? '+' : '') + n.toLocaleString('zh-CN') + '</span>' }
  function verdictBadge(v, edge) {
    var m = { favorable: ['bg-emerald-500 text-black', '有利'], marginal: ['bg-amber-400 text-black', '边际'], unfavorable: ['bg-slate-700 text-slate-300', '不利'] }[v] || ['bg-slate-800 text-slate-500', '—']
    return '<span class="px-2 py-0.5 rounded text-[11px] font-bold ' + m[0] + '">' + m[1] + (edge != null ? ' ' + (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + '%' : '') + '</span>'
  }
  function bar(p, color) { var w = Math.max(0, Math.min(100, (p || 0) * 100)); return '<span class="inline-block h-1.5 rounded bg-slate-800 align-middle" style="width:70px"><span class="block h-1.5 rounded" style="width:' + w + '%;background:' + (color || '#22d3ee') + '"></span></span>' }
  function renderTA(d) {
    $('ta-round').textContent = d.tiers && d.tiers[0] ? d.tiers[0].pit.round : TA.round
    var nf = d.next_forecast
    $('ta-next').innerHTML = '<span class="text-slate-500">样本 ' + d.periods + ' 期（' + esc(d.first || '') + ' → ' + esc(d.last || '') + '）</span>' + (nf ? ' · 下一期 <span class="mono text-amber-300">' + esc(nf.expect) + '</span> AI 置信度 <b class="mono ' + (nf.double_ok ? 'text-emerald-300' : 'text-slate-300') + '">' + pct(nf.confidence, 0) + '</b> → ' + (nf.double_ok ? '<span class="text-emerald-300">达到倍投阈值</span>' : '<span class="text-slate-500">未达阈值，倍投策略本期平注</span>') : ' · 下一期 AI 尚未锁定')
    $('ta-cards').innerHTML = (d.tiers || []).map(function (t) {
      var nx = t.next, sk = t.streak, pit = t.pit, mg = t.martingale, s = mg.sims
      var condRows = ['0', '1', '2', '3', '4', '5', '6+'].map(function (k) { var c = sk.cond[k]; var cur = String(sk.current >= 6 ? '6+' : sk.current) === k; return '<span class="mono text-[10.5px] px-1.5 py-0.5 rounded ' + (cur ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50' : 'bg-slate-800 text-slate-400') + '" title="历史上已连挂 ' + k + ' 期时，下一期命中 ' + c.hits + '/' + c.n + '">挂' + k + '→' + (c.rate == null ? '—' : pct(c.rate, 0)) + '</span>' }).join(' ')
      var surv = sk.survive.map(function (x) { var cls = x.p_continue == null ? 'text-slate-600' : x.p_continue > x.theory + 0.03 ? 'text-rose-300' : x.p_continue < x.theory - 0.03 ? 'text-emerald-300' : 'text-slate-300'; return '<span class="mono text-[10.5px] ' + cls + '" title="已挂 ' + x.L + ' 期的 ' + x.reached + ' 段中，' + x.continued + ' 段继续挂">L' + x.L + ' ' + (x.p_continue == null ? '—' : pct(x.p_continue, 0)) + '</span>' }).join(' · ')
      var dist = ['1', '2', '3', '4', '5', '6+'].map(function (k) { return '<span class="mono text-[10.5px] px-1 rounded ' + ((k === '6+' ? 6 : +k) >= 4 && sk.dist[k] ? 'bg-rose-500/20 text-rose-200' : 'bg-slate-800 text-slate-400') + '">' + sk.dist[k] + '</span>' }).join('')
      var pits = pit.steps.map(function (x) { return '<div class="flex items-center justify-between text-[11px]"><span class="text-slate-500">再挂 ' + x.k + ' 期</span><span class="mono"><span class="text-slate-600">' + pct(x.theory, 1) + '</span> → <b class="text-slate-200">' + pct(x.est, 1) + '</b></span></div>' }).join('')
      var simRow = function (name, r, hi) { return '<tr class="' + (hi ? 'bg-amber-500/5' : '') + '"><td class="l text-slate-300 py-1">' + name + '</td><td class="mono">' + money(r.pnl) + '</td><td class="mono">' + (r.roi == null ? '—' : ((r.roi >= 0 ? '+' : '') + (r.roi * 100).toFixed(2) + '%')) + '</td><td class="mono text-rose-300">' + r.max_drawdown.toLocaleString() + '</td><td class="mono">' + r.rounds_win + '/' + r.rounds + '</td><td class="mono text-rose-300">' + r.worst_round.toLocaleString() + '</td></tr>' }
      return '<div class="rounded-xl border ' + (t.custom ? 'border-violet-500/40' : 'border-slate-800') + ' bg-[#0b1220] p-3 space-y-3">' +
        // 头
        '<div class="flex items-center justify-between"><div><b class="text-base ' + (t.custom ? 'text-violet-300' : 'text-slate-100') + '">前 ' + tierShort(t) + ' 注</b><span class="text-[11px] text-slate-500 ml-2">保本 ' + pct(t.breakeven, 1) + ' · ' + t.hits + '/' + t.periods + '</span></div>' + verdictBadge(nx.verdict, nx.edge_vs_breakeven) + '</div>' +
        // 下一期概率
        '<div><div class="text-[11px] text-slate-500 mb-1"><i class="fas fa-bullseye mr-1 text-amber-400"></i>下一期命中概率</div>' +
          '<div class="flex items-end gap-3"><div><div class="mono text-2xl font-black ' + (nx.estimate >= t.breakeven ? 'text-emerald-300' : 'text-slate-200') + '">' + pct(nx.estimate, 1) + '</div><div class="text-[10.5px] text-slate-500">综合估计</div></div>' +
          '<div class="text-[10.5px] text-slate-500 leading-5 mono">理论 ' + pct(nx.theory, 1) + ' · 全量 ' + pct(nx.all, 1) + (nx.ci_all ? ' <span class="text-slate-600">[' + pct(nx.ci_all.lo, 0) + '–' + pct(nx.ci_all.hi, 0) + ']</span>' : '') + '<br>近100 ' + pct(nx.last100, 1) + ' · 近30 ' + pct(nx.last30, 1) + '<br>当前连挂 <b class="' + (nx.current_streak >= 4 ? 'text-rose-300' : 'text-slate-300') + '">' + nx.current_streak + '</b> 期 → 条件命中 <b class="text-slate-200">' + (nx.cond_after_current_streak == null ? '样本不足' : pct(nx.cond_after_current_streak, 1)) + '</b></div></div></div>' +
        // 长龙
        '<div><div class="text-[11px] text-slate-500 mb-1"><i class="fas fa-dragon mr-1 text-rose-400"></i>长龙机制 <span class="text-slate-600">最长 ' + sk.longest + ' · 分布 1-6+</span> ' + dist + '</div>' +
          '<div class="flex flex-wrap gap-1 mb-1">' + condRows + '</div>' +
          '<div class="text-[10.5px] text-slate-500">存活率（挂 L 期后继续挂，理论 ' + pct(1 - nx.theory, 0) + '）：' + surv + '</div></div>' +
        // 进坑
        '<div class="grid grid-cols-2 gap-3"><div><div class="text-[11px] text-slate-500 mb-1"><i class="fas fa-arrow-trend-down mr-1 text-rose-400"></i>连续进坑（理论 → 估计）</div>' + pits + '</div>' +
          '<div><div class="text-[11px] text-slate-500 mb-1">一轮 ' + pit.round + ' 期内出现 ≥4 连挂</div><div class="mono text-xl font-black ' + (pit.at_least_one_4run_in_round.est > 0.5 ? 'text-rose-300' : 'text-slate-200') + '">' + pct(pit.at_least_one_4run_in_round.est, 1) + '</div><div class="text-[10.5px] text-slate-500">理论 ' + pct(pit.at_least_one_4run_in_round.theory, 1) + '</div>' + bar(pit.at_least_one_4run_in_round.est, '#f43f5e') + '</div></div>' +
        // 倍投
        '<div><div class="text-[11px] text-slate-500 mb-1"><i class="fas fa-layer-group mr-1 text-emerald-400"></i>每 ' + mg.round + ' 期倍投回测 <span class="text-slate-600">命中后下一期实测命中 ' + pct(mg.after_hit.rate, 1) + '（' + mg.after_hit.hits + '/' + mg.after_hit.n + '）' + (mg.conf_threshold ? ' · 置信≥' + Math.round(mg.conf_threshold * 100) + '% 时 ' + pct(mg.after_hit_conf.rate, 1) + '（' + mg.after_hit_conf.hits + '/' + mg.after_hit_conf.n + '）' : '') + '</span></div>' +
          '<div class="overflow-x-auto"><table class="w-full text-[11px]" style="min-width:380px"><thead><tr class="text-slate-600"><th class="l font-normal">策略</th><th class="font-normal">累计</th><th class="font-normal">ROI</th><th class="font-normal">最大回撤</th><th class="font-normal">赢轮</th><th class="font-normal">最差轮</th></tr></thead><tbody>' +
          simRow('平注', s.flat) + simRow('命中后翻倍', s.win_double, true) + simRow('挂后加码 1-2-4', s.loss_martin) + '</tbody></table></div>' +
          '<div class="text-[10.5px] text-slate-600 mt-1">翻倍下注 ' + s.win_double.doubled_bets + ' 次，其中命中 ' + s.win_double.doubled_hit + '（' + pct(s.win_double.doubled_hit_rate, 1) + '）</div></div>' +
        '</div>'
    }).join('')
  }
  function fetchTA() {
    axios.get('/api/ai/tier-analysis', { params: { source: S.source, conf: TA.conf, round: TA.round } }).then(function (r) { renderTA(r.data) })
      .catch(function (e) { $('ta-cards').innerHTML = '<div class="text-rose-400 text-sm">' + esc(e.message) + '</div>' })
  }
  $('ta-conf').addEventListener('click', function (e) { var b = e.target.closest('.qk'); if (!b) return; TA.conf = +b.getAttribute('data-c'); $('ta-conf').querySelectorAll('.qk').forEach(function (x) { x.classList.toggle('on', x === b) }); fetchTA() })
  $('ta-rnd').addEventListener('click', function (e) { var b = e.target.closest('.qk'); if (!b) return; TA.round = +b.getAttribute('data-r'); $('ta-rnd').querySelectorAll('.qk').forEach(function (x) { x.classList.toggle('on', x === b) }); fetchTA() })

  // ---------------------------------------------------------------- 连挂风险
  var SK = { k: 4, n: 0 }
  function cmpCls(actual, theory, lowerBetter) {
    if (actual == null || theory == null) return 'text-slate-300'
    var better = lowerBetter ? actual < theory : actual > theory
    if (Math.abs(actual - theory) < 1e-9) return 'text-slate-300'
    return better ? 'text-emerald-300' : 'text-rose-300'
  }
  function renderStreaks(d) {
    $('sk-k').textContent = d.k
    var rows = d.tiers || []
    if (!d.periods) { $('sk-body').innerHTML = '<tr><td colspan="10" class="py-4 text-slate-500">暂无已结算记录</td></tr>'; return }
    $('sk-body').innerHTML = rows.map(function (t) {
      var th = t.theory, ac = t.actual
      var dist = ['1', '2', '3', '4', '5', '6+'].map(function (k) { var v = ac.dist[k] || 0; var hot = (k === '6+' ? 6 : +k) >= d.k; return '<span class="mono px-1.5 py-0.5 rounded text-[11px] ' + (hot ? (v ? 'bg-rose-500/20 text-rose-200' : 'bg-slate-800 text-slate-600') : 'bg-slate-800 text-slate-300') + '" title="长度 ' + k + ' 的连挂段：' + v + ' 段">' + v + '</span>' }).join(' ')
      return '<tr>' +
        '<td class="l"><b class="' + (t.custom ? 'text-violet-300' : 'text-slate-200') + '">' + tierShort(t) + ' 注</b><div class="text-[10.5px] text-slate-500">' + t.periods + ' 期 · 命中 ' + pct(t.rate) + '</div></td>' +
        '<td class="text-slate-400">' + pct(th.miss_p) + '</td>' +
        '<td class="text-slate-300">' + pct(th.any_k_in_row, 2) + '</td>' +
        '<td class="text-slate-300">' + pct(th.run_reaches_k, 2) + '</td>' +
        '<td><b class="' + cmpCls(ac.run_reaches_k, th.run_reaches_k, true) + '">' + pct(ac.run_reaches_k, 2) + '</b><div class="text-[10.5px] text-slate-500">' + ac.runs_k + '/' + ac.runs + ' 段</div></td>' +
        '<td><b class="text-slate-200">' + pct(ac.periods_in_k_share, 2) + '</b><div class="text-[10.5px] text-slate-500">' + ac.periods_in_k + ' 期</div></td>' +
        '<td><span class="text-slate-500">' + th.expected_runs_k_per_100.toFixed(2) + '</span> → <b class="' + cmpCls(ac.runs_k_per_100, th.expected_runs_k_per_100, true) + '">' + (ac.runs_k_per_100 == null ? '—' : ac.runs_k_per_100.toFixed(2)) + '</b></td>' +
        '<td class="' + (ac.longest >= d.k ? 'text-rose-300 font-bold' : 'text-slate-300') + '">' + ac.longest + '</td>' +
        '<td class="' + (ac.current >= d.k ? 'text-rose-300 font-bold' : ac.current ? 'text-amber-300' : 'text-slate-500') + '">' + (ac.current || '·') + '</td>' +
        '<td class="l">' + dist + '</td></tr>'
    }).join('')
    $('sk-note').setAttribute('data-range', d.first + '→' + d.last)
  }
  function fetchStreaks() {
    axios.get('/api/ai/streaks', { params: { source: S.source, k: SK.k, n: SK.n || undefined } }).then(function (r) { renderStreaks(r.data) })
      .catch(function (e) { $('sk-body').innerHTML = '<tr><td colspan="10" class="py-3 text-rose-400">' + esc(e.message) + '</td></tr>' })
  }
  $('sk-kbtns').addEventListener('click', function (e) { var b = e.target.closest('.qk'); if (!b) return; SK.k = +b.getAttribute('data-k'); $('sk-kbtns').querySelectorAll('.qk').forEach(function (x) { x.classList.toggle('on', x === b) }); fetchStreaks() })
  $('sk-nbtns').addEventListener('click', function (e) { var b = e.target.closest('.qk'); if (!b) return; SK.n = +b.getAttribute('data-n'); $('sk-nbtns').querySelectorAll('.qk').forEach(function (x) { x.classList.toggle('on', x === b) }); fetchStreaks() })

  // ---------------------------------------------------------------- 启动
  axios.get('/api/sources').then(function (r) {
    var list = (r.data.sources || []).filter(function (s) { return s.key.indexOf('qkltj:') === 0 })
    var sel = $('source'); sel.innerHTML = list.map(function (s) { return '<option value="' + s.key + '">' + esc(s.name) + '</option>' }).join('')
    if (!list.some(function (s) { return s.key === S.source })) S.source = list[0] ? list[0].key : S.source
    sel.value = S.source
    sel.addEventListener('change', function () { S.source = sel.value; try { localStorage.setItem('ai:source', S.source) } catch (e) {} S.detail = {}; fetchBg(); fetchStreaks(); fetchTA(); fetchSetsBoard(); go() })
    // 从 URL 带入 ?expect= / ?date=
    var u = new URLSearchParams(location.search); if (u.get('expect')) $('q-expect').value = u.get('expect'); if (u.get('date')) $('q-date').value = u.get('date')
    fetchBg(); fetchStreaks(); fetchTA(); fetchSetsBoard(); go()
  })
  setInterval(fetchBg, 10000)
  setInterval(fetchStreaks, 60000)
  setInterval(fetchTA, 60000)
  setInterval(fetchSetsBoard, 60000)
  // 有新开奖时自动刷新“最近 N 期”视图
  setInterval(function () { if (S.last && S.last.n && !S.last.expect && !S.last.date) run(S.last, '最近 ' + S.last.n + ' 期') }, 30000)
})()
