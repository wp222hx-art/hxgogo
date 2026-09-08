const evidenceLabel = m => ({live:'真实预测',replay:'历史回放',legacy:'旧记录（时间未验证）',late:'过期记录',mixed:'混合档案'})[m] || '时间未验证'
// ================= HashArena 策略竞技场（自动战绩榜） =================
const $ = (id) => document.getElementById(id)
const api = axios.create({ baseURL: '/api' })
const S = { source: new URLSearchParams(location.search).get('source') || 'qkltj:6001', mode: 'live', sources: [], data: null, strat: 'meta', fmt: 'space', ec: {}, histN: 30, defs: [] }
const pct = (x, d = 1) => x === null || x === undefined ? '—' : (x * 100).toFixed(d) + '%'
const sgn = (x, d = 0) => x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + Number(x).toFixed(d)
const fmtT = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false })
const defOf = (k) => S.defs.find(s => s.key === k) || { name: k, short: k, color: '#94a3b8' }
function ec(id) { if (!S.ec[id]) { S.ec[id] = window.HashPlayTheme.echarts(echarts.init($(id), null, { renderer: 'canvas' })); window.addEventListener('resize', () => S.ec[id].resize()) } return S.ec[id] }
const AX = { axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#94a3b8', fontSize: 10 }, splitLine: { lineStyle: { color: '#1e293b' } } }

async function init() {
  const [meta, defs] = await Promise.all([api.get('/sources'), api.get('/arena/strategies')])
  S.sources = meta.data.sources; S.defs = defs.data.strategies
  if (!S.sources.some(s => s.key === S.source)) S.source = 'qkltj:6001'
  $('source-sel').innerHTML = S.sources.filter(s => s.key.startsWith('qkltj') || s.count > 0 || s.key === S.source).map(s => `<option value="${s.key}">${s.name}（${s.count} 期）</option>`).join('')
  $('source-sel').value = S.source
  $('source-sel').onchange = e => { S.source = e.target.value; load() }
  $('sync-btn').onclick = () => SyncBar.force()
  document.querySelectorAll('#mode-tabs .tab').forEach(t => t.onclick = () => { S.mode = t.dataset.m; document.querySelectorAll('#mode-tabs .tab').forEach(x => x.classList.toggle('active', x === t)); load() })
  $('replay-btn').onclick = replay
  $('cur-strat').innerHTML = S.defs.map(s => `<option value="${s.key}">${s.name}</option>`).join('')
  $('cur-strat').value = S.strat; $('cur-strat').onchange = e => { S.strat = e.target.value; renderCurrent() }
  $('cur-fmt').onchange = e => { S.fmt = e.target.value; renderCurrent() }
  $('cur-copy').onclick = copyCurrent
  $('cur-text').onclick = function () { this.select() }
  $('hist-n').onchange = e => { S.histN = Number(e.target.value); renderHist() }
  loadReport()
  $('modal-close').onclick = () => $('modal').classList.add('hidden'); $('modal').onclick = e => { if (e.target === $('modal')) $('modal').classList.add('hidden') }
  $('rules').innerHTML = `${S.defs.length} 个策略并行，每期开奖前各自锁定 <b class="text-slate-200">${defs.data.count} 注三位号</b>（万/千/百），INSERT OR IGNORE 首次为准、不可改写；开奖后自动结算命中/名次/盈亏（每注 1 单位，赔率 ${defs.data.odds}×）。
    「组合最优」只用目标期之前已结算的滚动战绩给基础策略加权（z 分数 → 指数权重 → 样本收缩），融合排序分后取 Top ${defs.data.count}——这就是「以向前数据为依托、每期自动优化」。「随机对照组」用期号做种子随机取号，理论命中率 50%，所有策略都要和它比。
    <b class="text-slate-200">回放</b>：对历史期按当前保存的早期数据补算，仅用于研究，不能充当当时真实预测；<b class="text-slate-200">实盘</b>：真实开奖前生成的记录。`
  SyncBar.mount('sync-bar', { getSource: () => S.source, onNewData: () => load(), onForced: () => load() })
  load()
}

async function load() {
  $('board-meta').textContent = '计算中…'
  const [meta, r] = await Promise.all([api.get('/sources'), api.get('/arena/board', { params: { source: S.source, mode: S.mode, limit: 300 } }), loadRetired()])
  S.sources = meta.data.sources; S.data = r.data
  renderKpis(); renderBoard(); renderCharts(); renderWeights(); renderPlans(); renderAiPlans(); renderAi(); renderCurrent(); renderHist()
  $('disclaimer').innerHTML = '<i class="fas fa-triangle-exclamation mr-1"></i>' + r.data.disclaimer
  $('odds-1').textContent = r.data.odds; $('meta-k').textContent = r.data.meta_k
  $('board-meta').textContent = `已结算 ${r.data.n_periods} 期 · 待开 ${r.data.pending} 期 · 计算 ${r.data.compute_ms}ms`
}

function renderKpis() {
  const d = S.data, s = S.sources.find(x => x.key === S.source)
  const meta = d.strategies.find(x => x.key === 'meta'), best = d.strategies.find(x => x.key === d.best), ctrl = d.strategies.find(x => x.control)
  const k = (l, v, sub = '', cls = 'text-emerald-300') => `<div class="kpi"><div class="text-xs text-slate-500">${l}</div><div class="v ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-500">${sub}</div>` : ''}</div>`
  $('kpis').innerHTML =
    k('数据源', s.name, `${s.count} 期 · ${s.interval_ms ? s.interval_ms / 60000 : s.intervalMs / 60000} 分钟/期`) +
    k('已结算期数', d.n_periods, `待开 ${d.pending} 期 · 每期 ${d.strategies.length} 策略 × ${d.per_strategy_count} 注`) +
    k('组合最优命中率', pct(meta.rate), `基线 ${pct(meta.baseline, 0)} · z=${meta.z} · ${meta.n} 期`, meta.z > 1.96 ? 'text-emerald-400' : meta.z < -1.96 ? 'text-red-400' : 'text-slate-200') +
    k('组合最优盈亏', sgn(meta.pnl), `ROI ${pct(meta.roi, 2)} · 最大回撤 ${meta.max_dd}`, meta.pnl > 0 ? 'text-emerald-400' : 'text-red-400') +
    k('当前最强', best ? best.short : '—', best ? `滚动 ${best.rolling.k} 期 ${pct(best.rolling.rate)} · z=${best.rolling.z}` : '', 'text-amber-300') +
    k('随机对照组', pct(ctrl.rate), `盈亏 ${sgn(ctrl.pnl)} · z=${ctrl.z}`, 'text-slate-300')
}

function renderBoard() {
  const d = S.data
  const rows = [...d.strategies].sort((a, b) => (b.rolling.z - a.rolling.z) || (b.z - a.z))
  const zc = (z) => z > 1.96 ? 'text-emerald-400 font-bold' : z < -1.96 ? 'text-red-400 font-bold' : z > 1 ? 'text-emerald-300' : z < -1 ? 'text-red-300' : 'text-slate-400'
  $('board').querySelector('tbody').innerHTML = rows.map((s, i) => `<tr class="${s.key === d.best ? 'best' : ''} ${s.control ? 'ctrl' : ''}">
    <td class="mono text-slate-500">${i + 1}</td>
    <td><span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style="background:${s.color}"></span><b>${s.name}</b>${s.meta ? ' <i class="fas fa-crown text-amber-400 text-[10px]"></i>' : ''}${s.control ? ' <span class="text-[10px] text-slate-500">对照</span>' : ''}<div class="text-[10px] text-slate-500 font-normal truncate max-w-[260px]">${s.desc}</div></td>
    <td class="mono">${s.n}</td><td class="mono">${s.hits}</td>
    <td class="mono font-bold ${s.rate > s.baseline ? 'text-emerald-300' : 'text-slate-300'}">${pct(s.rate)}</td>
    <td class="mono text-slate-500">${pct(s.baseline, 0)}</td>
    <td class="mono ${s.lift > 1 ? 'text-emerald-300' : 'text-slate-400'}">${s.lift === null ? '—' : s.lift.toFixed(3) + '×'}</td>
    <td class="mono ${zc(s.z)}">${s.z}</td>
    <td class="mono">${pct(s.rolling.rate)} <span class="text-slate-500 text-[10px]">(${s.rolling.k})</span></td>
    <td class="mono ${zc(s.rolling.z)}">${s.rolling.z}</td>
    <td class="mono font-bold ${s.pnl > 0 ? 'text-emerald-400' : s.pnl < 0 ? 'text-red-400' : ''}">${sgn(s.pnl)}</td>
    <td class="mono ${s.roi > 0 ? 'text-emerald-400' : 'text-red-400'}">${pct(s.roi, 2)}</td>
    <td class="mono text-slate-400">${s.max_dd}</td><td class="mono text-slate-400">${s.streak_miss}</td>
    <td>${s.meta || s.control ? '<span class="text-slate-600">—</span>' : `<div class="flex items-center gap-2"><div class="wbar w-16"><div style="width:${(d.weights[s.key]?.w || 0) * 100 * 2}%;background:${s.color}"></div></div><span class="mono text-[11px]">${pct(d.weights[s.key]?.w, 1)}</span></div>`}</td>
    <td class="text-[11px] ${s.verdict.includes('优于') ? 'text-emerald-400' : s.verdict.includes('劣于') ? 'text-red-400' : 'text-slate-400'}">${s.verdict}</td>
  </tr>`).join('')
}

function renderCharts() {
  const d = S.data
  const x = d.periods.map(p => p.expect.slice(-4))
  const mk = (id, key, yFmt, base) => {
    const series = d.strategies.map(s => ({ name: s.short, type: 'line', showSymbol: false, smooth: false, data: s[key], lineStyle: { width: s.meta ? 3 : s.control ? 1.5 : 1.2, type: s.control ? 'dashed' : 'solid' }, itemStyle: { color: s.color }, emphasis: { focus: 'series' }, z: s.meta ? 10 : 1 }))
    if (base !== undefined) series.push({ name: '基线', type: 'line', showSymbol: false, data: x.map(() => base), lineStyle: { color: '#fbbf24', type: 'dotted', width: 1 }, itemStyle: { color: '#fbbf24' } })
    const opt = {
      backgroundColor: 'transparent', animation: false,
      tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 }, valueFormatter: yFmt },
      legend: { textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0, type: 'scroll' },
      grid: { left: 48, right: 12, top: 32, bottom: 24 },
      xAxis: { type: 'category', data: x, ...AX, axisLabel: { ...AX.axisLabel, interval: Math.max(0, Math.floor(x.length / 10)) } },
      yAxis: { type: 'value', ...AX, axisLabel: { ...AX.axisLabel, formatter: yFmt } },
      series,
    }
    if (!x.length) opt.graphic = { type: 'text', left: 'center', top: 'middle', style: { text: '暂无已结算数据 · 点「回放补齐历史」或等待下一期开奖', fill: '#64748b', fontSize: 12 } }
    ec(id).setOption(opt, true)
  }
  mk('ch-pnl', 'cum_pnl', v => (v > 0 ? '+' : '') + Math.round(v))
  mk('ch-rate', 'cum_rate', v => (v * 100).toFixed(1) + '%', 0.5)
}

function renderWeights() {
  const d = S.data
  const ks = Object.keys(d.weights).sort((a, b) => d.weights[b].w - d.weights[a].w)
  const max = Math.max(...ks.map(k => d.weights[k].w), 0.01)
  $('weights').innerHTML = ks.map(k => { const w = d.weights[k], s = defOf(k); return `<div>
    <div class="flex justify-between text-[11px]"><span><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${s.color}"></span>${s.name}</span><span class="mono">${pct(w.w)} <span class="text-slate-500">· 近${w.n}期 ${w.hits}/${w.exp} z=${w.z}</span></span></div>
    <div class="wbar mt-1"><div style="width:${w.w / max * 100}%;background:${s.color}"></div></div></div>` }).join('') +
    `<div class="text-[10px] text-slate-500 pt-1">权重 = 信任度·exp(0.6·clamp(z,−2,2)) + (1−信任度)，信任度 = n/(n+20)；样本不足时自动趋向等权。</div>`
  $('advice').innerHTML = d.advice.map(a => `<li>${a}</li>`).join('')
}

function renderPlans() {
  const d = S.data; if (!d.plans) return
  const rows = [...d.plans].sort((a, b) => b.pnl - a.pnl)
  $('plans').querySelector('tbody').innerHTML = rows.map((p, i) => `<tr class="${p.key === d.plan_best ? 'best' : ''} ${p.control ? 'ctrl' : ''} ${p.ai ? 'aiplan' : ''}">
    <td class="mono text-slate-500">${i + 1}</td>
    <td><b>${p.name}</b>${p.control ? ' <span class="text-[10px] text-slate-500">对照</span>' : ''}${p.ai ? ` <span class="text-[10px] text-pink-300"><i class="fas fa-brain"></i> AI 建议 · ${p.report_expect.slice(-4)} 期后为样本外</span>` : ''}<div class="text-[10px] text-slate-500 font-normal max-w-[360px] whitespace-normal">${p.desc}</div></td>
    <td class="mono">${p.bets}</td><td class="mono text-slate-400">${p.skips}</td><td class="mono">${p.hits}</td>
    <td class="mono font-bold ${p.rate > 0.5 ? 'text-emerald-300' : 'text-slate-300'}">${pct(p.rate)}</td>
    <td class="mono ${p.z > 1.96 ? 'text-emerald-400 font-bold' : p.z < -1.96 ? 'text-red-400 font-bold' : 'text-slate-400'}">${p.z}</td>
    <td class="mono font-bold ${p.pnl > 0 ? 'text-emerald-400' : p.pnl < 0 ? 'text-red-400' : ''}">${sgn(p.pnl)}</td>
    <td class="mono ${p.roi > 0 ? 'text-emerald-400' : 'text-red-400'}">${pct(p.roi, 2)}</td>
    <td class="mono text-slate-400">${p.max_dd}</td>
    <td class="mono text-[11px]">${p.ai ? (p.forward && p.forward.bets ? `<span class="${p.forward.pnl > 0 ? 'text-emerald-400' : p.forward.pnl < 0 ? 'text-red-400' : 'text-slate-300'} font-bold">${sgn(p.forward.pnl)}</span><span class="text-slate-500"> / ${p.forward.bets}投 ${pct(p.forward.rate, 0)} z${p.forward.z}</span>` : '<span class="text-slate-500">尚无</span>') : '<span class="text-slate-600">—</span>'}</td>
    <td class="text-[10px] text-slate-400">${Object.entries(p.picks).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `<span style="color:${defOf(k).color}">${defOf(k).short}</span>×${n}`).join(' ')}</td>
  </tr>`).join('')
  const x = d.periods.map(p => p.expect.slice(-4))
  const PC = ['#22c55e', '#ec4899', '#06b6d4', '#f97316', '#eab308', '#64748b']
  ec('ch-plans').setOption({
    backgroundColor: 'transparent', animation: false,
    tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 }, valueFormatter: v => (v > 0 ? '+' : '') + Math.round(v) },
    legend: { textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0, type: 'scroll' },
    grid: { left: 48, right: 12, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: x, ...AX, axisLabel: { ...AX.axisLabel, interval: Math.max(0, Math.floor(x.length / 10)) } },
    yAxis: { type: 'value', ...AX },
    series: d.plans.map((p, i) => ({ name: p.name, type: 'line', showSymbol: false, data: p.curve, lineStyle: { width: p.key === d.plan_best ? 3 : 1.2, type: p.control ? 'dashed' : p.ai ? 'dotted' : 'solid' }, itemStyle: { color: p.ai ? ['#f472b6', '#e879f9', '#c084fc', '#fb7185'][i % 4] : PC[i % PC.length] }, emphasis: { focus: 'series' },
      markLine: p.ai && p.since_index !== undefined ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#f472b6', type: 'dashed', width: 1 }, data: [{ xAxis: p.since_index }] } : undefined })),
    graphic: x.length ? undefined : { type: 'text', left: 'center', top: 'middle', style: { text: '暂无数据', fill: '#64748b', fontSize: 12 } },
  }, true)
}

function renderAiPlans() {
  const d = S.data, plans = (d.plans || []).filter(p => p.ai), ai = d.ai || {}
  $('ai-plans-meta').textContent = plans.length ? `活跃 ${plans.length} 套 · 样本外合计 ${sgn(plans.reduce((a, p) => a + (p.forward ? p.forward.pnl : 0), 0))}` : (ai.enabled ? '尚无 AI 方案 —— 生成一份 AI 分析报告即会自动落成' : 'AI 未配置')
  $('ai-plans-cadence').textContent = ai.enabled && ai.report_every ? `自动节奏：实盘每 ${ai.report_every} 期结算后自动生成报告并落成新规则` : ''
  const stat = (f) => f && f.bets ? `<div class="kv mt-2"><div><span class="text-slate-500">下注/观望</span><b class="mono">${f.bets}/${f.skips}</b></div><div><span class="text-slate-500">命中率</span><b class="mono ${f.rate > 0.5 ? 'text-emerald-300' : ''}">${pct(f.rate)}</b></div><div><span class="text-slate-500">z</span><b class="mono ${f.z > 1.96 ? 'text-emerald-400' : f.z < -1.96 ? 'text-red-400' : ''}">${f.z}</b></div><div><span class="text-slate-500">盈亏 / 回撤</span><b class="mono ${f.pnl > 0 ? 'text-emerald-400' : f.pnl < 0 ? 'text-red-400' : ''}">${sgn(f.pnl)} <span class="text-slate-500 font-normal text-[10px]">/ ${f.max_dd}</span></b></div></div>` : '<div class="text-[11px] text-slate-500 mt-2">尚无样本外下注（等待条件触发）</div>'
  $('ai-plans').innerHTML = plans.map(p => `<div class="plan-card">
    <div class="flex items-start justify-between gap-2"><div><div class="font-bold text-sm text-pink-200"><i class="fas fa-brain mr-1 text-pink-400"></i>${p.name}</div><div class="text-[10px] text-slate-500 mt-0.5">提出于第 ${p.report_expect} 期结算后 · ${fmtT(p.created_ms)}</div></div>
      <button class="text-[10px] text-slate-500 hover:text-red-300" onclick="retirePlan(${p.plan_id})" title="手动退役"><i class="fas fa-ban"></i></button></div>
    <div class="text-xs text-slate-300 mt-2 leading-relaxed"><span class="text-slate-500">规则</span> ${p.desc}</div>
    ${p.rationale ? `<div class="text-[11px] text-slate-400 mt-1 leading-relaxed"><span class="text-slate-500">AI 依据</span> ${p.rationale}</div>` : ''}
    <div class="mt-2 text-[10px] text-slate-500 uppercase tracking-wide">样本内 + 样本外（全序列）</div>${stat(p)}
    <div class="mt-2 text-[10px] text-pink-300 uppercase tracking-wide">样本外（提出后实盘，真正的检验）</div>${stat(p.forward)}
  </div>`).join('') || ''
  const ret = S.retired || []
  $('ai-plans-retired-n').textContent = ret.length ? `(${ret.length})` : ''
  $('ai-plans-retired').innerHTML = ret.length ? ret.map(r => `<div class="bg-slate-900/60 rounded-lg px-3 py-2"><b class="text-slate-300">${r.name}</b> <span class="text-slate-500">· 提出于 ${r.report_expect.slice(-6)} · 退役 ${fmtT(r.retired_ms)}</span><div class="text-slate-400 mt-0.5">${r.retire_reason || ''}</div></div>`).join('') : '<div class="text-slate-600">无</div>'
}
async function loadRetired() { try { S.retired = (await api.get('/arena/plans', { params: { source: S.source } })).data.retired } catch { S.retired = [] } }
async function retirePlan(id) { if (!confirm('手动退役该 AI 方案？（不再参与后续模拟，可在已退役列表查看）')) return; await api.post(`/arena/plans/${id}/retire`); await loadRetired(); load() }

// ---------- AI 预测官 ----------
function md(t) {  // 极简 Markdown → HTML（标题/列表/加粗/段落）
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const lines = esc(t).split('\n'); let out = '', inUl = false
  for (const l of lines) {
    const b = l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    if (/^##+\s/.test(l)) { if (inUl) { out += '</ul>'; inUl = false } out += `<h2>${b.replace(/^##+\s/, '')}</h2>` }
    else if (/^\s*[-*]\s/.test(l)) { if (!inUl) { out += '<ul>'; inUl = true } out += `<li>${b.replace(/^\s*[-*]\s/, '')}</li>` }
    else if (l.trim()) { if (inUl) { out += '</ul>'; inUl = false } out += `<p>${b}</p>` }
  }
  return out + (inUl ? '</ul>' : '')
}
function renderAi() {
  const d = S.data, ai = d.ai || { enabled: false, history: [] }
  const st = d.strategies.find(s => s.key === 'ai')
  $('ai-status').innerHTML = ai.enabled ? `<i class="fas fa-circle text-emerald-400 mr-1 text-[8px]"></i>已启用 · ${ai.model} · ${ai.effort || 'low'} 推理` : `<i class="fas fa-circle text-slate-500 mr-1 text-[8px]"></i>未配置 API Key`
  $('ai-meta').textContent = st && st.n ? `已实盘 ${st.n} 期 · 命中 ${st.hits} · ${pct(st.rate)} · z=${st.z} · 盈亏 ${sgn(st.pnl)}` : '等待首期实盘结算'
  const h = ai.history || []
  $('ai-timeline').innerHTML = h.length ? h.map(x => `<div class="ai-row ${x.hit ? 'hit' : ''} ${x.error ? 'err' : ''}">
    <div class="mono text-slate-400">${x.expect.slice(-6)}</div>
    <div>${x.error ? `<span class="text-red-400">调用失败 · ${x.error}</span>` : `<b class="text-slate-200">${x.regime || '—'}</b> <span class="text-slate-500">AI 自评 ${pct(x.confidence, 0)}（非命中率）</span><div class="text-slate-400 mt-0.5 line-clamp-3">${x.reasoning || ''}</div>${x.pick_plan ? `<div class="text-pink-200/80 text-[10px] mt-0.5 line-clamp-2">选号：${x.pick_plan}</div>` : ''}${x.next_focus ? `<div class="text-pink-300/80 text-[10px] mt-0.5">验证：${x.next_focus}</div>` : ''}`}</div>
    <div class="text-right">${x.actual ? `<div class="mono text-amber-300">${x.actual}</div>${x.hit ? `<div class="text-emerald-400 font-bold">命中 #${x.rank}</div>` : `<div class="text-slate-500">未中 ${x.pnl}</div>`}` : '<div class="text-slate-500">待开奖</div>'}</div>
  </div>`).join('') : '<div class="text-xs text-slate-500">暂无记录</div>'
}

// 本期 AI 推荐 500 注已独立到 /ai 页面（public/static/ai.js）
async function loadReport() {
  try { const r = (await api.get('/arena/report', { params: { source: S.source } })).data; if (r.report) showReport(r.report) } catch {}
}
function showReport(r) {
  $('ai-report').classList.remove('hidden')
  $('ai-report-meta').textContent = `· 截至第 ${r.expect} 期 · ${r.model} · ${fmtT(r.created_ms)}`
  $('ai-report-body').innerHTML = md(r.report)
}
/** 手动生成分析报告（已不在页面上暴露按钮；可在控制台调用 aiReport()） */
async function aiReport() {
  try { const r = (await api.post('/arena/report', null, { params: { source: S.source } })).data; showReport(r); if (r.plans_added) { await load() } $('ai-report').scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  catch (e) { alert('报告生成失败：' + (e.response?.data?.error || e.message)) }
}

function curNums() { const c = S.data.current; if (!c) return null; const s = c.strategies.find(x => x.strategy === S.strat); return s ? s.numbers.split(' ') : null }
function renderCurrent() {
  const d = S.data, c = d.current
  if (!c) { $('cur-expect').textContent = '—'; $('cur-meta').textContent = '尚未生成（数据源需 ≥120 期历史）'; $('strat-cards').innerHTML = ''; $('cur-text').value = ''; $('cur-grid').innerHTML = ''; return }
  $('cur-expect').textContent = c.expect
  $('cur-meta').textContent = `基于 ${c.based_on} 期及之前数据 · 生成于 ${fmtT(c.created_ms)} · 开奖后自动结算`
  $('strat-cards').innerHTML = [...c.strategies].sort((a, b) => S.defs.findIndex(x => x.key === a.strategy) - S.defs.findIndex(x => x.key === b.strategy)).map(s => { const def = defOf(s.strategy); return `<div class="strat-card ${s.strategy === S.strat ? 'active' : ''}" data-k="${s.strategy}">
    <div class="text-[11px] truncate" style="color:${def.color}">${def.short}</div>
    <div class="mono text-sm font-bold">${s.count} 注</div>
    <div class="text-[10px] text-slate-500">排序分合计 ${pct(s.coverage)}${def.meta ? '' : ` · 权重 ${pct(s.weight)}`}</div></div>` }).join('')
    + (d.ai && d.ai.enabled && !c.strategies.some(s => s.strategy === 'ai') ? `<div class="strat-card opacity-70" title="大模型正在推理本期预测，完成后自动出现"><div class="text-[11px] truncate" style="color:#f472b6">AI 预测</div><div class="text-sm font-bold"><i class="fas fa-spinner fa-spin mr-1"></i>推理中</div><div class="text-[10px] text-slate-500">约 10-30 秒</div></div>` : '')
  document.querySelectorAll('.strat-card').forEach(el => el.onclick = () => { S.strat = el.dataset.k; $('cur-strat').value = S.strat; renderCurrent() })
  const nums = curNums() || []
  $('cur-text').value = S.fmt === 'line' ? nums.join('\n') : S.fmt === 'comma' ? nums.join(',') : nums.join(' ')
  $('cur-grid').innerHTML = nums.map((n, i) => `<span title="#${i + 1}">${n}</span>`).join('')
}
async function copyCurrent() {
  const t = $('cur-text').value; if (!t) return
  let ok = false
  try { await navigator.clipboard.writeText(t); ok = true } catch (e) {}
  if (!ok) { const ta = $('cur-text'); ta.removeAttribute('readonly'); ta.focus(); ta.select(); ok = document.execCommand('copy'); ta.setAttribute('readonly', '') }
  const el = $('cur-copied'); el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 2200)
  $('cur-text').focus(); $('cur-text').select()
}

function renderHist() {
  const d = S.data
  const ps = [...d.periods].reverse().slice(0, S.histN)
  const cols = d.strategies
  const head = `<div class="head">期号</div><div class="head">开奖</div>` + cols.map(s => `<div class="head" style="color:${s.color}">${s.short}</div>`).join('')
  $('hist').style.gridTemplateColumns = `84px 60px repeat(${cols.length}, 1fr)`
  $('hist').innerHTML = head + ps.map(p => `<div class="cursor-pointer hover:text-emerald-300 ${p.mode === 'replay' ? 'replay' : ''}" data-e="${p.expect}" title="${evidenceLabel(p.mode)}">${p.expect.slice(-6)}${p.mode !== 'live' ? '<sup>档</sup>' : ''}</div><div class="text-amber-300 font-bold">${p.actual}</div>` +
    cols.map(s => { const h = p.hit[s.key]; return h === undefined ? '<div class="m">·</div>' : h ? `<div class="h">中 <small>(${p.rank[s.key]})</small></div>` : `<div class="m">${p.pnl[s.key]}</div>` }).join('')).join('')
  $('hist').querySelectorAll('[data-e]').forEach(el => el.onclick = () => openRound(el.dataset.e))
}

async function openRound(expect) {
  const p = S.data.periods.find(x => x.expect === expect)
  $('modal-title').innerHTML = `期号 ${expect} · 开奖前三位 <span class="text-amber-300 mono">${p.actual}</span> <span class="text-xs text-slate-500">(${evidenceLabel(p.mode)})</span>`
  $('modal-body').innerHTML = '<div class="text-xs text-slate-500">加载中…</div>'; $('modal').classList.remove('hidden')
  const rs = await Promise.all(S.data.strategies.map(s => api.get('/arena/round', { params: { source: S.source, expect, strategy: s.key } }).then(r => r.data).catch(() => null)))
  $('modal-body').innerHTML = `<div class="space-y-3">` + rs.filter(Boolean).map(r => { const def = defOf(r.strategy); return `<details ${r.hit ? 'open' : ''}><summary class="cursor-pointer text-sm"><span class="inline-block w-2 h-2 rounded-full mr-1" style="background:${def.color}"></span><b>${def.name}</b> · ${r.count} 注 · ${evidenceLabel(r.prediction_status)} · ${r.hit ? `<span class="text-emerald-400 font-bold">命中 · 名次 #${r.rank}</span>` : '<span class="text-slate-500">未中</span>'} · 盈亏 <span class="mono ${r.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}">${sgn(r.pnl)}</span> · 排序分合计 ${pct(r.coverage)}</summary>
    <div class="num-grid mt-2">${r.numbers.map((n, i) => `<span class="${n === r.actual ? 'hit' : ''}" title="#${i + 1}">${n}</span>`).join('')}</div></details>` }).join('') + `</div>`
}

async function replay() {
  const btn = $('replay-btn'); btn.disabled = true
  let total = 0
  try {
    for (let i = 0; i < 12; i++) {   // 每轮最多 30 期，最多 12 轮（≈360 期）
      btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i>回放中… 已补 ${total} 期`
      const r = (await api.post('/arena/replay', null, { params: { source: S.source, n: 30, lookback: 300 } })).data
      total += r.replayed; $('replay-left').textContent = r.remaining ? `（剩 ${r.remaining}）` : ''
      if (!r.replayed || !r.remaining) break
    }
  } catch (e) { alert('回放失败：' + (e.response?.data?.error || e.message)) }
  btn.disabled = false; btn.innerHTML = `<i class="fas fa-backward mr-1"></i>回放补齐历史 <span id="replay-left" class="text-slate-500"></span>`
  load()
}

init()
