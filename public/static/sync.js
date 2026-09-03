// ============ SyncBar：与 api.qkltj.com 实时对齐的同步状态条 + 手动强制同步 ============
// 用法：SyncBar.mount('容器id', { getSource: () => 'qkltj:6001', onNewData: (status) => {...}, onForced: (report) => {...} })
//  - 按开奖节拍轮询：下一期理论发布时间（latest_open + interval + 15s）之前静默；到点后每 4s 追赶直到期号变化
//  - 每次轮询携带 tick=1，服务端顺带执行到点同步（无需 cron）
//  - 「立即同步」：POST /api/sync?force=1 → 拉 100 行逐字段核对并修正 → 清空分析缓存 → 展示报告
//  - 任何接口返回 cached:true 时，可调用 SyncBar.noteCache(resp) 显示「缓存」徽标（点击即强制同步）
window.SyncBar = (() => {
  const api = axios.create({ baseURL: '/api' })
  const PUBLISH_DELAY = 15000, CATCHUP = 4000
  const st = { el: null, opts: null, status: null, timer: null, cdTimer: null, lastExpect: null, busy: false, cache: null, report: null }
  const fmtT = ms => ms ? new Date(ms).toLocaleTimeString('zh-CN', { hour12: false }) : '—'
  const ago = ms => { if (!ms) return '—'; const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s 前` : `${Math.floor(s / 60)}m${s % 60}s 前` }

  function render() {
    const s = st.status; if (!st.el) return
    if (!s) { st.el.innerHTML = '<div class="sb-row"><i class="fas fa-satellite-dish mr-1"></i>正在连接 api.qkltj.com…</div>'; return }
    const nowMs = Date.now()
    const nextPub = s.expected_publish_ms ? s.expected_publish_ms + PUBLISH_DELAY : null
    const left = nextPub ? nextPub - nowMs : null
    const stale = !s.fresh
    const dot = s.last_error ? 'sb-dot-err' : stale ? 'sb-dot-warn' : 'sb-dot-ok'
    const state = s.last_error ? `接口异常：${s.last_error}` : stale ? `数据滞后 ${Math.round((s.lag_ms || 0) / 1000)}s（追赶中）` : '实时一致'
    const cd = left == null ? '' : left > 0 ? `下一期预计 <b class="font-mono">${Math.floor(left / 60000)}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}</b>` : `<span class="text-amber-300">等待官方入库…（每 ${CATCHUP / 1000}s 检查）</span>`
    const audit = s.audit?.last_ms ? `审计 ${ago(s.audit.last_ms)} · ${s.audit.rows} 行 · ${s.audit.diff === 0 ? '<span class="text-emerald-400">0 差异</span>' : `<span class="text-amber-300">修正 ${s.audit.fixed} 处</span>`}` : '尚未审计'
    const cache = st.cache ? `<button class="sb-cache" title="该视图来自服务端缓存，点击强制同步并刷新"><i class="fas fa-database mr-1"></i>缓存 ${Math.round(st.cache.age / 1000)}s · 点击刷新</button>` : ''
    const rep = st.report ? `<div class="sb-report ${st.report.consistent ? 'ok' : 'warn'}">${st.report.html}</div>` : ''
    st.el.innerHTML = `
      <div class="sb-row">
        <span class="sb-dot ${dot}"></span>
        <span class="text-slate-200 font-semibold">${s.name}</span>
        <span class="text-slate-400">最新 <b class="font-mono text-slate-100">${s.latest_expect || '—'}</b> <span class="text-slate-500">${fmtT(s.latest_open_ms)}</span></span>
        <span class="text-slate-400">${state}</span>
        <span class="text-slate-400">${cd}</span>
        <span class="text-slate-500 hidden md:inline">${audit}</span>
        <span class="text-slate-500 hidden lg:inline">上次拉取 ${ago(s.last_ok_ms)} · ${s.last_latency_ms || 0}ms · 库内 ${s.total} 期</span>
        ${cache}
        <button class="sb-btn ${st.busy ? 'busy' : ''}" ${st.busy ? 'disabled' : ''}><i class="fas fa-rotate ${st.busy ? 'fa-spin' : ''} mr-1"></i>${st.busy ? '核对中…' : '立即同步'}</button>
      </div>${rep}`
    st.el.querySelector('.sb-btn').onclick = force
    const cb = st.el.querySelector('.sb-cache'); if (cb) cb.onclick = force
  }

  async function poll(tick = true) {
    clearTimeout(st.timer)
    try {
      const src = st.opts.getSource()
      const r = await api.get('/sync/status', { params: { source: src, tick: tick ? 1 : 0 } })
      const s = r.data.status[src]; st.status = s
      if (s.latest_expect && st.lastExpect && s.latest_expect !== st.lastExpect) { st.cache = null; st.report = null; st.opts.onNewData?.(s) }
      st.lastExpect = s.latest_expect
      // 节拍调度
      const nextPub = (s.expected_publish_ms || Date.now()) + PUBLISH_DELAY
      const wait = nextPub > Date.now() ? Math.min(nextPub - Date.now(), 60000) : CATCHUP
      st.timer = setTimeout(poll, Math.max(1500, wait))
    } catch (e) {
      st.status = { ...(st.status || { name: '数据源' }), last_error: e.message }
      st.timer = setTimeout(poll, 8000)
    }
    render()
  }

  async function force() {
    if (st.busy) return
    st.busy = true; render()
    try {
      const src = st.opts.getSource()
      const r = await api.post('/sync', null, { params: { source: src, force: 1 } })
      const rep = r.data.result[src], s = r.data.status[src]
      st.status = s; st.cache = null; st.lastExpect = s.latest_expect
      if (rep.error) st.report = { consistent: false, html: `<i class="fas fa-triangle-exclamation mr-1"></i>同步失败：${rep.error}` }
      else {
        const diffs = (rep.diffs || []).slice(0, 8).map(d => `<span class="sb-diff">${d.expect.slice(-4)} ${d.field}: <s>${d.local ?? 'null'}</s> → ${d.remote}</span>`).join('')
        st.report = { consistent: rep.consistent && !rep.inserted, html: `<i class="fas ${rep.consistent ? 'fa-circle-check' : 'fa-wrench'} mr-1"></i>已与接口逐字段核对 <b>${rep.fetched}</b> 行（${rep.latency_ms}ms）：新增 <b>${rep.inserted}</b> · 修正 <b>${rep.updated}</b> · 一致 <b>${rep.unchanged}</b> · 最新期 <b class="font-mono">${rep.latest_expect}</b> · 分析缓存已清空 <span class="text-slate-500">${fmtT(Date.now())}</span>${diffs ? `<div class="mt-1 flex flex-wrap gap-1">${diffs}</div>` : ''}` }
      }
      st.opts.onForced?.(rep, s)
    } catch (e) { st.report = { consistent: false, html: `<i class="fas fa-triangle-exclamation mr-1"></i>同步失败：${e.response?.data?.error || e.message}` } }
    st.busy = false; render()
    clearTimeout(st.timer); st.timer = setTimeout(poll, 3000)
  }

  function mount(id, opts) {
    st.el = document.getElementById(id); st.opts = opts
    if (!st.el) return
    if (!document.getElementById('sb-style')) {
      const css = document.createElement('style'); css.id = 'sb-style'; css.textContent = `
        .sb-row{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem .9rem;font-size:12px;padding:.5rem .8rem;border:1px solid rgba(51,65,85,.7);border-radius:.6rem;background:rgba(15,23,42,.6)}
        .sb-dot{width:9px;height:9px;border-radius:50%;display:inline-block;box-shadow:0 0 0 0 currentColor}
        .sb-dot-ok{background:#34d399;color:#34d399;animation:sbpulse 2s infinite}.sb-dot-warn{background:#fbbf24;color:#fbbf24;animation:sbpulse 1s infinite}.sb-dot-err{background:#f87171;color:#f87171}
        @keyframes sbpulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}100%{box-shadow:0 0 0 7px rgba(255,255,255,0)}}
        .sb-btn{margin-left:auto;background:#0ea5e9;color:#000;font-weight:600;padding:.3rem .7rem;border-radius:.45rem;border:0;cursor:pointer}.sb-btn:hover{background:#38bdf8}.sb-btn.busy{opacity:.6;cursor:wait}
        .sb-cache{background:rgba(251,191,36,.15);color:#fcd34d;border:1px solid rgba(251,191,36,.4);padding:.2rem .55rem;border-radius:.45rem;cursor:pointer}.sb-cache:hover{background:rgba(251,191,36,.3)}
        .sb-report{margin-top:.35rem;font-size:11px;padding:.45rem .8rem;border-radius:.5rem;border:1px solid}.sb-report.ok{color:#a7f3d0;border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08)}.sb-report.warn{color:#fde68a;border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.08)}
        .sb-diff{font-family:ui-monospace,monospace;background:rgba(0,0,0,.35);padding:.1rem .4rem;border-radius:.3rem}`
      document.head.appendChild(css)
    }
    render(); poll(true)
    clearInterval(st.cdTimer); st.cdTimer = setInterval(() => { if (!st.busy) render() }, 1000)
  }
  /** 任一接口响应含 cached:true → 显示缓存徽标 */
  function noteCache(resp) { if (resp && resp.cached) { st.cache = { age: resp.cache_age_ms || 0, at: Date.now() }; render() } else if (resp && resp.cached === undefined) { /* 非缓存视图不改变 */ } }
  function refresh() { return poll(true) }
  return { mount, noteCache, refresh, force, get status() { return st.status } }
})()
