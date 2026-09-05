/* /settings：AI 供应商 key / 模型 / 报单窗口 配置 + 真实校验 */
(function () {
  'use strict'
  var $ = function (id) { return document.getElementById(id) }
  var KEYS = ['AI_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL', 'AI_EFFORT', 'AI_LEAD_MS', 'AI_TIMEOUT_MS', 'AI_REPORT_EVERY']
  var SECRET = { DEEPSEEK_API_KEY: 1, OPENAI_API_KEY: 1 }
  var S = { cfg: null, provider: '', source: 'qkltj:6001' }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  var srcName = { db: '页面配置', env: '环境变量', none: '未设置' }

  // ---------------------------------------------------------------- 渲染
  function render(cfg) {
    S.cfg = cfg
    var it = cfg.items || {}
    KEYS.forEach(function (k) {
      var x = it[k] || { value: '', source: 'none' }
      var sb = $('src-' + k); if (sb) { sb.className = 'src ' + x.source; sb.textContent = srcName[x.source] }
      var inp = $('in-' + k); if (!inp) return
      if (SECRET[k]) { inp.value = ''; var cur = $('cur-' + k); if (cur) cur.innerHTML = x.set ? '当前：<span class="mono text-slate-300">' + esc(x.value) + '</span>' + (x.updated_ms ? ' · ' + new Date(x.updated_ms).toLocaleString('zh-CN') : '') : '<span class="text-amber-400">尚未配置</span>' }
      else if (x.source === 'db') inp.value = x.value
      else { inp.value = ''; if (x.value && inp.tagName === 'INPUT') inp.placeholder = x.value + '（来自环境变量）' }
    })
    S.provider = (it.AI_PROVIDER && it.AI_PROVIDER.source === 'db') ? it.AI_PROVIDER.value : ''
    pickProv(S.provider, true)
    var e = cfg.effective
    $('eff-line').innerHTML = e ? '<span class="' + (e.provider === 'deepseek' ? 'text-sky-400' : 'text-slate-200') + '">' + esc(e.provider) + '</span> · <span class="mono">' + esc(e.model) + '</span>' : '<span class="text-amber-400">未配置任何供应商</span>'
    $('eff-sub').textContent = e ? e.base : '请在下方填写 DeepSeek 或 OpenAI 的 key'
    ;['card-ds', 'card-oa'].forEach(function (id) { $(id).classList.remove('active') })
    if (e) $(e.provider === 'deepseek' ? 'card-ds' : 'card-oa').classList.add('active')
    calcWindow()
  }
  function pickProv(v, silent) {
    S.provider = v
    document.querySelectorAll('#prov-pick .prov').forEach(function (el) { el.classList.toggle('sel', el.getAttribute('data-v') === v) })
    if (!silent) markDirty()
  }
  document.querySelectorAll('#prov-pick .prov').forEach(function (el) { el.addEventListener('click', function () { pickProv(el.getAttribute('data-v')) }) })
  document.querySelectorAll('.eye').forEach(function (b) { b.addEventListener('click', function () { var i = $(b.getAttribute('data-for')); i.type = i.type === 'password' ? 'text' : 'password' }) })
  function calcWindow() {
    var it = (S.cfg && S.cfg.items) || {}
    var lead = Number($('in-AI_LEAD_MS').value || (it.AI_LEAD_MS && it.AI_LEAD_MS.value) || 20000)
    var to = Number($('in-AI_TIMEOUT_MS').value || (it.AI_TIMEOUT_MS && it.AI_TIMEOUT_MS.value) || 25000)
    var budget = 60000 - lead
    $('window-calc').innerHTML = '<i class="fas fa-calculator mr-1 text-amber-400"></i>以 1 分钟厅为例：上期开奖 → AI 最晚须在 <b class="mono text-slate-200">' + (budget / 1000).toFixed(0) + 's</b> 内锁定（含同步延迟约 2–5s，实际给模型约 <b class="mono text-slate-200">' + Math.max(0, (budget - 5000) / 1000).toFixed(0) + 's</b>）· 单次上限 ' + (to / 1000).toFixed(0) + 's → 你将获得 <b class="mono text-emerald-300">' + (lead / 1000).toFixed(0) + 's</b> 报单时间。' + (budget - 5000 < 8000 ? ' <span class="text-amber-400">留给模型的时间偏紧，DeepSeek V3 通常需 2–6s。</span>' : '')
  }
  ;['in-AI_LEAD_MS', 'in-AI_TIMEOUT_MS'].forEach(function (id) { $(id).addEventListener('input', calcWindow) })
  document.querySelectorAll('input.f, select.f').forEach(function (el) { el.addEventListener('input', markDirty); el.addEventListener('change', markDirty) })
  function markDirty() { $('save-msg').innerHTML = '<span class="text-amber-300"><i class="fas fa-circle text-[6px] mr-1"></i>有未保存的修改</span>' }

  // ---------------------------------------------------------------- 收集
  function collect(onlySet) {
    var body = { AI_PROVIDER: S.provider }
    KEYS.forEach(function (k) {
      if (k === 'AI_PROVIDER') return
      var inp = $('in-' + k); if (!inp) return
      var v = inp.value.trim()
      if (SECRET[k]) { if (v) body[k] = v }                   // 留空 = 不修改密钥
      else if (!onlySet || v) body[k] = v                       // 非密钥：空字符串 = 删除页面配置
    })
    return body
  }

  // ---------------------------------------------------------------- 校验结果渲染
  function renderResult(el, r) {
    el.classList.remove('hidden'); el.classList.add('fade-in')
    if (!r.ok) {
      el.innerHTML = '<div class="res bad"><div class="font-bold text-rose-300"><i class="fas fa-circle-xmark mr-1"></i>校验失败' + (r.stage ? '（阶段：' + (r.stage === 'auth' ? '鉴权' : '推理') + '）' : '') + '</div><div class="kv mt-1">' +
        (r.provider ? '<b>供应商</b><span>' + esc(r.provider) + ' · <span class="mono">' + esc(r.model) + '</span></span>' : '') +
        (r.base ? '<b>Base</b><span class="mono">' + esc(r.base) + '</span>' : '') +
        '<b>错误</b><span class="text-rose-200">' + esc(r.error) + '</span>' +
        (r.models && r.models.length ? '<b>可用模型</b><span class="mono text-slate-400">' + esc(r.models.slice(0, 8).join(', ')) + '</span>' : '') +
        '</div><div class="text-[11px] text-slate-500 mt-2">' + hint(r) + '</div></div>'
      return
    }
    var lat = r.chat_latency_ms || []
    var speed = r.chat_avg_ms < 6000 ? 'text-emerald-300' : r.chat_avg_ms < 12000 ? 'text-amber-300' : 'text-rose-300'
    var bal = r.balance && r.balance.infos && r.balance.infos.length ? r.balance.infos.map(function (b) { return b.total + ' ' + b.currency }).join(' / ') + (r.balance.available === false ? ' <span class="text-rose-300">（余额不可用）</span>' : '') : null
    el.innerHTML = '<div class="res ok"><div class="font-bold text-emerald-300"><i class="fas fa-circle-check mr-1"></i>校验通过 · 已真实完成一次 JSON 推理</div><div class="kv mt-1">' +
      '<b>供应商</b><span>' + esc(r.provider) + ' · <span class="mono">' + esc(r.model) + '</span>' + (r.model_listed === false ? ' <span class="text-amber-300">（不在模型列表）</span>' : r.model_listed ? ' <span class="text-emerald-400">✓ 模型有效</span>' : '') + '</span>' +
      '<b>推理耗时</b><span class="' + speed + ' mono">' + lat.map(function (x) { return (x / 1000).toFixed(1) + 's' }).join(' · ') + (lat.length > 1 ? '　均值 ' + (r.chat_avg_ms / 1000).toFixed(1) + 's' : '') + '</span>' +
      '<b>tokens</b><span class="mono text-slate-400">' + (r.usage ? (r.usage.prompt_tokens || 0) + ' in / ' + (r.usage.completion_tokens || 0) + ' out' : '—') + '</span>' +
      (bal ? '<b>账户余额</b><span class="mono">' + bal + '</span>' : '') +
      '<b>返回样例</b><span class="text-slate-400">' + (r.sample ? esc(r.sample.note || '') + (r.sample.pw_ok ? ' · 3×10 权重结构 ✓' : ' · <span class="text-amber-300">权重结构异常</span>') : '—') + '</span>' +
      (r.models && r.models.length ? '<b>可用模型</b><span class="mono text-slate-500 text-[11px]">' + esc(r.models.slice(0, 10).join(', ')) + (r.models.length > 10 ? ' …' : '') + '</span>' : '') +
      '</div>' + (r.warn ? '<div class="text-[11px] text-amber-300 mt-2"><i class="fas fa-triangle-exclamation mr-1"></i>' + esc(r.warn) + '</div>' : '') +
      '<div class="text-[11px] text-slate-500 mt-2">' + fitHint(r.chat_avg_ms) + '</div></div>'
  }
  function hint(r) {
    var e = String(r.error || '')
    if (/401|auth|invalid.*key|api key/i.test(e)) return '密钥无效或已过期：请到供应商控制台重新生成，注意不要带空格。'
    if (/402|insufficient|balance/i.test(e)) return '账户余额不足：请先充值。'
    if (/404|model/i.test(e) && /not|exist|found/i.test(e)) return '模型名不存在：DeepSeek 请用 deepseek-chat / deepseek-reasoner。'
    if (/timeout/i.test(e)) return '超时：检查 Base URL 是否可达（Cloudflare Worker 出网到该地址），或适当调大 AI_TIMEOUT_MS 校验。'
    if (/429|rate/i.test(e)) return '触发限流：稍后再试或升级供应商配额。'
    if (/fetch|network|ENOTFOUND|ECONN/i.test(e)) return 'Base URL 无法连接：请核对地址（不要带尾部 /chat/completions）。'
    return '请核对 Base URL、模型名与密钥。'
  }
  function fitHint(avg) {
    var lead = Number($('in-AI_LEAD_MS').value || (S.cfg.items.AI_LEAD_MS && S.cfg.items.AI_LEAD_MS.value) || 20000)
    var budget = 60000 - lead - 5000
    if (avg == null) return ''
    if (avg * 2.5 < budget) return '1 分钟厅可用：正式推理上下文更大，预计 ' + (avg * 1.5 / 1000).toFixed(0) + '–' + (avg * 2.5 / 1000).toFixed(0) + 's，仍在 ' + (budget / 1000).toFixed(0) + 's 预算内，' + (lead / 1000) + 's 报单窗口有保障。'
    return '<span class="text-amber-300">偏慢：正式推理预计 ' + (avg * 1.5 / 1000).toFixed(0) + '–' + (avg * 2.5 / 1000).toFixed(0) + 's，可能撞到 ' + (budget / 1000).toFixed(0) + 's 预算。建议改用 deepseek-chat、或把 AI_LEAD_MS 调小、或用三分/五分厅。</span>'
  }

  // ---------------------------------------------------------------- 动作
  function busy(btn, on, txt) { btn.disabled = on; if (on) { btn.setAttribute('data-h', btn.innerHTML); btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>' + (txt || '校验中…') } else btn.innerHTML = btn.getAttribute('data-h') }
  function validate(draft, btn, resEl, rounds) {
    busy(btn, true); resEl.classList.add('hidden')
    return axios.post('/api/config/validate', Object.assign({ rounds: rounds || 1 }, draft), { timeout: 70000 }).then(function (r) { renderResult(resEl, r.data.result || { ok: false, error: 'no result' }); return r.data.result })
      .catch(function (e) { renderResult(resEl, { ok: false, error: (e.response && e.response.data && e.response.data.error) || e.message }) })
      .finally(function () { busy(btn, false) })
  }
  $('btn-test-ds').addEventListener('click', function () {
    var d = { AI_PROVIDER: 'deepseek' }
    ;['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL'].forEach(function (k) { var v = $('in-' + k).value.trim(); if (v) d[k] = v })
    if (!d.DEEPSEEK_API_KEY && !(S.cfg.items.DEEPSEEK_API_KEY && S.cfg.items.DEEPSEEK_API_KEY.set)) { renderResult($('res-ds'), { ok: false, error: '请先填写 DEEPSEEK_API_KEY' }); return }
    validate(d, $('btn-test-ds'), $('res-ds'), 2)
  })
  $('btn-test-oa').addEventListener('click', function () {
    var d = { AI_PROVIDER: 'openai' }
    ;['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AI_MODEL', 'AI_EFFORT'].forEach(function (k) { var v = $('in-' + k).value.trim(); if (v) d[k] = v })
    if (!d.OPENAI_API_KEY && !(S.cfg.items.OPENAI_API_KEY && S.cfg.items.OPENAI_API_KEY.set)) { renderResult($('res-oa'), { ok: false, error: '请先填写 OPENAI_API_KEY' }); return }
    validate(d, $('btn-test-oa'), $('res-oa'), 1)
  })
  $('btn-test-live').addEventListener('click', function () { validate({}, $('btn-test-live'), $('live-res'), 2) })

  function save() {
    var body = collect(false)
    $('save-msg').innerHTML = '<span class="text-slate-400"><i class="fas fa-circle-notch fa-spin mr-1"></i>保存中…</span>'
    return axios.put('/api/config', body).then(function (r) {
      render(r.data); $('save-msg').innerHTML = '<span class="text-emerald-400"><i class="fas fa-check mr-1"></i>已保存，15 秒内全站生效</span>'
      return true
    }).catch(function (e) { $('save-msg').innerHTML = '<span class="text-rose-400"><i class="fas fa-xmark mr-1"></i>' + esc((e.response && e.response.data && e.response.data.error) || e.message) + '</span>'; return false })
  }
  $('btn-save').addEventListener('click', save)
  $('btn-save-test').addEventListener('click', function () { save().then(function (ok) { if (ok) validate({}, $('btn-test-live'), $('live-res'), 2) }) })
  $('btn-clear').addEventListener('click', function () {
    if (!confirm('清除所有页面配置（包括已保存的密钥），回到环境变量？')) return
    var body = {}; KEYS.forEach(function (k) { body[k] = null })
    axios.put('/api/config', body).then(function (r) { render(r.data); $('save-msg').innerHTML = '<span class="text-slate-300">已清除页面配置</span>' })
  })

  // ---------------------------------------------------------------- 本期 AI 状态（证明后台链路在跑）
  function livePick() {
    axios.get('/api/arena/pick', { params: { source: S.source, history: 1 } }).then(function (r) {
      var d = r.data, p = d.pick, el = $('live-pill')
      if (!d.ok) { el.innerHTML = '<i class="fas fa-triangle-exclamation text-amber-400"></i>' + esc(d.error || 'AI 未配置'); return }
      if (!p) { el.innerHTML = '<i class="fas fa-circle text-slate-500 text-[8px]"></i>暂无待开期'; return }
      var st = p.status === 'ready' ? '<i class="fas fa-circle text-emerald-400 text-[8px]"></i>本期 ' + p.expect + ' 已锁定 · ' + esc(p.model || '') + ' · ' + (p.latency_ms / 1000).toFixed(1) + 's'
        : p.status === 'thinking' ? '<i class="fas fa-circle-notch fa-spin text-pink-400"></i>本期 ' + p.expect + ' AI 推理中…'
        : '<i class="fas fa-triangle-exclamation text-amber-400"></i>本期 ' + p.expect + ' 兜底 · ' + esc(p.error || '')
      el.innerHTML = st
    }).catch(function () {})
  }

  axios.get('/api/config').then(function (r) { render(r.data) }).catch(function (e) { $('eff-line').innerHTML = '<span class="text-rose-400">读取配置失败：' + esc(e.message) + '</span>' })
  livePick(); setInterval(livePick, 5000)
})()
