// ================= HashQuant 分析中心 =================
const $ = (id) => document.getElementById(id)
const api = axios.create({ baseURL: '/api' })
const S = { source: new URLSearchParams(location.search).get('source') || 'qkltj:6001', market: 'sum-size', markets: [], charts: {}, sources: [], digit: 7, pos: 'any', play: 'pos', ec: {} }
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#64748b']
Chart.defaults.color = '#94a3b8'; Chart.defaults.borderColor = '#1e293b'; Chart.defaults.font.size = 11

const BASELINE_PLUGIN = { id: 'baseline', afterDraw(c) { if (c.canvas.id !== 'ch-mech' || S.baseline === undefined) return; const x = c.scales.x.getPixelForValue(S.baseline); const ctx = c.ctx; ctx.save(); ctx.strokeStyle = '#fbbf24'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, c.chartArea.top); ctx.lineTo(x, c.chartArea.bottom); ctx.stroke(); ctx.restore() } }
function chart(id, cfg) { if (S.charts[id]) S.charts[id].destroy(); S.charts[id] = new Chart($(id), cfg); return S.charts[id] }
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%'
const fmtT = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false })

// ---------- 初始化 ----------
async function init() {
  const [meta, mk] = await Promise.all([api.get('/sources'), api.get('/analysis/markets')])
  S.sources = meta.data.sources; S.markets = mk.data.markets; S.mechs = mk.data.mechanisms
  if (!S.sources.some(s => s.key === S.source)) S.source = 'qkltj:6001'
  $('source-sel').innerHTML = S.sources.filter(s => s.key.startsWith('qkltj') || s.count > 0 || s.key === S.source).map(s => `<option value="${s.key}">${s.name}（${s.count} 期）</option>`).join('')
  $('market-sel').innerHTML = S.markets.map(m => `<option value="${m.key}">${m.name}</option>`).join('')
  $('source-sel').value = S.source; $('market-sel').value = S.market
  $('source-sel').onchange = e => { S.source = e.target.value; loadAll() }
  $('market-sel').onchange = e => { S.market = e.target.value; loadPredict() }
  $('steps-sel').onchange = loadPredict; $('limit-sel').onchange = loadPredict
  $('sync-btn').onclick = async () => { $('sync-btn').innerHTML = '<i class="fas fa-rotate fa-spin mr-1"></i>同步中'; await api.post('/sync?force=1&source=' + S.source); $('sync-btn').innerHTML = '<i class="fas fa-rotate mr-1"></i>同步'; loadAll() }
  loadAll()
}
async function loadAll() { renderKpis(); await Promise.all([loadRecommend(), loadKline(), loadOverview(), loadPredict(), loadStats()]) }

async function renderKpis() {
  const meta = (await api.get('/sources')).data.sources; S.sources = meta
  const s = meta.find(x => x.key === S.source)
  const k = (l, v, sub = '') => `<div class="kpi"><div class="text-xs text-slate-500">${l}</div><div class="v text-cyan-300">${v}</div>${sub ? `<div class="text-[10px] text-slate-500">${sub}</div>` : ''}</div>`
  $('kpis').innerHTML = k('数据源', s.name, s.chain.toUpperCase() + ' · ' + (s.intervalMs / 60000) + ' 分钟/期') + k('已采集期数', s.count.toLocaleString()) + k('最新一期', s.latest ? new Date(s.latest).toLocaleTimeString('zh-CN', { hour12: false }) : '—', s.latest ? fmtT(s.latest) : '') + k('上次同步', s.meta ? new Date(s.meta.last_sync_ms).toLocaleTimeString('zh-CN', { hour12: false }) : '—', s.meta?.last_error ? '<span class="text-red-400">' + s.meta.last_error + '</span>' : '正常') + k('分析市场', S.markets.length) + k('分析机制', S.mechs.length)
}

// ---------- 总览 ----------
async function loadOverview() {
  $('overview').innerHTML = '<div class="text-slate-500 text-xs col-span-full">计算中（14 市场 × 20 机制 × 60 期回测）…</div>'
  const d = (await api.get('/analysis/overview', { params: { source: S.source } })).data
  $('ov-meta').textContent = `样本 ${d.sample} 期 · 最新期 ${d.latest_expect}`
  $('overview').innerHTML = d.markets.map(m => {
    const c = m.top === 0 ? 'text-red-400' : m.top === 1 ? 'text-blue-400' : 'text-emerald-400'
    const edge = m.avg_acc - m.baseline
    return `<div class="mkt-card ${m.key === S.market ? 'active' : ''}" data-k="${m.key}">
      <div class="text-[11px] text-slate-400 truncate">${m.name}</div>
      <div class="flex items-end justify-between mt-1"><span class="text-2xl font-black ${c}">${m.top_label}</span><span class="font-mono text-xs text-amber-400">${pct(m.p[m.top], 1)}</span></div>
      <div class="bar mt-2"><div style="width:${m.tilt}%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444)"></div></div>
      <div class="flex justify-between text-[10px] text-slate-500 mt-1"><span>倾向 ${m.tilt}</span><span>共识 ${m.consensus}%</span></div>
      <div class="text-[10px] mt-1 ${edge > 0.02 ? 'text-emerald-400' : edge < -0.02 ? 'text-red-400' : 'text-slate-500'}">回测均值 ${pct(m.avg_acc)} (基线 ${pct(m.baseline, 0)})</div>
      ${m.streak.len >= 3 ? `<div class="text-[10px] text-orange-400 mt-0.5"><i class="fas fa-fire"></i> ${m.labels[m.streak.v]} 连开 ${m.streak.len}</div>` : ''}
    </div>`
  }).join('')
  document.querySelectorAll('.mkt-card').forEach(el => el.onclick = () => { S.market = el.dataset.k; $('market-sel').value = S.market; document.querySelectorAll('.mkt-card').forEach(x => x.classList.toggle('active', x === el)); loadPredict(); $('mk-name').scrollIntoView({ behavior: 'smooth', block: 'center' }) })
}

// ---------- 深度预测 ----------
async function loadPredict() {
  const d = (await api.get('/analysis/predict', { params: { source: S.source, market: S.market, steps: $('steps-sel').value, limit: $('limit-sel').value } })).data
  const m = d.market, en = d.ensemble, bt = d.backtest
  $('mk-name').textContent = `${m.name}（样本 ${d.sample} 期）`
  $('en-top').textContent = en.top_label; $('en-top').className = 'text-3xl font-black mt-1 ' + (en.top === 0 ? 'text-red-400' : en.top === 1 ? 'text-blue-400' : 'text-emerald-400')
  $('en-tilt').textContent = en.tilt; $('en-cons').textContent = en.consensus
  $('needle').style.transform = `rotate(${-90 + en.tilt * 1.8}deg)`
  chart('ch-ensemble', { type: 'bar', data: { labels: m.labels, datasets: [{ label: '集成概率', data: en.p, backgroundColor: m.labels.map((_, i) => COLORS[i % 10]) }, { label: '理论基线', data: m.labels.map(() => bt.baseline), type: 'line', borderColor: '#94a3b8', borderDash: [4, 4], pointRadius: 0 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, ticks: { callback: v => pct(v, 0) } } } } })
  $('votes').innerHTML = en.votes.map((v, i) => `<span class="px-2 py-0.5 rounded text-xs" style="background:${COLORS[i % 10]}22;color:${COLORS[i % 10]}">${m.labels[i]} × ${v}</span>`).join('')
  $('snapshot').innerHTML = `<div>当前连开：<b class="text-amber-400">${m.labels[en.streak.v] ?? '—'} × ${en.streak.len}</b></div><div>各类当前遗漏：${en.gaps.map((g, i) => `<span class="mr-2">${m.labels[i]}<b class="font-mono text-slate-200">${g}</b></span>`).join('')}</div><div class="text-slate-500 mt-1">最新期 ${d.latest_expect}</div>`
  // 机制图
  const sorted = [...bt.mechanisms].sort((a, b) => b.acc - a.acc)
  $('bt-steps').textContent = bt.steps; $('bt-base').textContent = pct(bt.baseline, 0)
  S.baseline = bt.baseline
  chart('ch-mech', { type: 'bar', data: { labels: sorted.map(x => x.name), datasets: [{ label: '命中率', data: sorted.map(x => x.acc), backgroundColor: sorted.map(x => x.acc > bt.baseline + 0.03 ? '#22c55e' : x.acc < bt.baseline - 0.03 ? '#ef4444' : '#3b82f6') }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: Math.min(1, Math.max(...sorted.map(x => x.acc)) + 0.1), ticks: { callback: v => pct(v, 0) } }, y: { ticks: { font: { size: 9 } } } } }, plugins: [BASELINE_PLUGIN] })
  $('mech-list').innerHTML = sorted.map((x, i) => `<div class="mech-row" title="${x.desc}">
    <span class="text-slate-500">${i + 1}</span><span><b>${x.name}</b> <span class="text-slate-500 text-[10px] ml-1">${x.group}</span></span>
    <span class="font-mono">${pct(x.acc)}</span><span class="font-mono ${x.edge > 0.02 ? 'text-emerald-400' : x.edge < -0.02 ? 'text-red-400' : 'text-slate-400'}">${x.edge >= 0 ? '+' : ''}${pct(x.edge)}</span>
    <span><div class="bar"><div style="width:${Math.min(100, x.weight * 100 * 4)}%;background:#06b6d4"></div></div><span class="text-[10px] text-slate-500">${pct(x.weight)}</span></span>
    <span>${x.recent.map(h => `<span class="dot" style="background:${h ? '#22c55e' : '#334155'}"></span>`).join('')}</span></div>`).join('')
  $('recent-seq').innerHTML = d.recent.map((v, i) => `<span class="w-7 h-7 grid place-items-center rounded text-xs font-bold" style="background:${COLORS[v % 10]}" title="${d.recent_expects[i]}">${m.labels[v]}</span>`).join('')
}

// ---------- 多维统计 ----------
async function loadStats() {
  const d = (await api.get('/analysis/stats', { params: { source: S.source } })).data
  const POS = ['万', '千', '百', '十', '个']; const exp = d.n / 10
  const heatCell = (v, max, base) => { const r = Math.min(1, v / (max || 1)); return `<div style="background:rgba(6,182,212,${(0.15 + r * 0.85).toFixed(2)});color:${r > 0.5 ? '#000' : '#cbd5e1'}" title="期望 ${base.toFixed(0)}">${v}</div>` }
  const maxF = Math.max(...d.digitFreq.flat())
  $('heat').innerHTML = `<div></div>${[...Array(10).keys()].map(i => `<div class="text-slate-500">${i}</div>`).join('')}` + d.digitFreq.map((row, p) => `<div class="text-slate-400">${POS[p]}</div>` + row.map(v => heatCell(v, maxF, exp)).join('')).join('')
  const maxG = Math.max(...d.gapsNow.flat(), 1)
  $('gaps').innerHTML = `<div></div>${[...Array(10).keys()].map(i => `<div class="text-slate-500">${i}</div>`).join('')}` + d.gapsNow.map((row, p) => `<div class="text-slate-400">${POS[p]}</div>` + row.map((g, i) => { const r = Math.min(1, g / 30); return `<div style="background:rgba(239,68,68,${(0.1 + r * 0.9).toFixed(2)})" title="历史最大遗漏 ${d.maxGap[p][i]}">${g}</div>` }).join('')).join('')
  // 总和分布 vs 理论（5 个 0-9 均匀和的分布，用卷积算）
  let dist = [1]; for (let i = 0; i < 5; i++) { const nd = Array(dist.length + 9).fill(0); for (let a = 0; a < dist.length; a++) for (let b = 0; b < 10; b++) nd[a + b] += dist[a] / 10; dist = nd }
  chart('ch-sum', { type: 'bar', data: { labels: [...Array(46).keys()], datasets: [{ label: '实际', data: d.sumDist, backgroundColor: d.sumDist.map((_, i) => i >= 23 ? '#ef444488' : '#3b82f688') }, { label: '理论期望', data: dist.map(p => p * d.n), type: 'line', borderColor: '#fbbf24', pointRadius: 0, borderWidth: 1.5 }] }, options: { scales: { x: { ticks: { maxTicksLimit: 12 } } } } })
  chart('ch-roll', { type: 'line', data: { labels: d.roll.map(r => r.expect.slice(-4)), datasets: [{ label: '大 比率', data: d.roll.map(r => r.bigRate), borderColor: '#ef4444', pointRadius: 0, tension: .3 }, { label: '单 比率', data: d.roll.map(r => r.oddRate), borderColor: '#a855f7', pointRadius: 0, tension: .3 }, { label: '50%', data: d.roll.map(() => .5), borderColor: '#64748b', borderDash: [4, 4], pointRadius: 0 }] }, options: { scales: { y: { min: .2, max: .8, ticks: { callback: v => pct(v, 0) } }, x: { ticks: { maxTicksLimit: 10 } } } } })
  const hrs = [...Array(24).keys()]
  chart('ch-hour', { type: 'bar', data: { labels: hrs.map(h => h + '时'), datasets: [{ label: '期数', data: hrs.map(h => d.hourly[h]?.n || 0), backgroundColor: '#1e293b', yAxisID: 'n' }, { label: '大率', data: hrs.map(h => d.hourly[h] ? d.hourly[h].big / d.hourly[h].n : null), type: 'line', borderColor: '#ef4444', yAxisID: 'r', tension: .3 }, { label: '单率', data: hrs.map(h => d.hourly[h] ? d.hourly[h].odd / d.hourly[h].n : null), type: 'line', borderColor: '#a855f7', yAxisID: 'r', tension: .3 }] }, options: { scales: { n: { position: 'left', grid: { display: false } }, r: { position: 'right', min: .2, max: .8, ticks: { callback: v => pct(v, 0) } } } } })
  const sh = d.shape, shT = { leopard: .01, straight: .048, pair: .27, mixed: .672 }
  chart('ch-shape', { type: 'bar', data: { labels: ['豹子', '顺子', '对子', '杂六'], datasets: [{ label: '实际', data: ['leopard', 'straight', 'pair', 'mixed'].map(k => sh[k] / d.n), backgroundColor: '#ec4899' }, { label: '理论', data: Object.values(shT), backgroundColor: '#64748b' }] }, options: { maintainAspectRatio: false, plugins: { title: { display: true, text: '前三形态' } }, scales: { y: { ticks: { callback: v => pct(v, 0) } } } } })
  const dr = d.dragon
  chart('ch-dragon', { type: 'doughnut', data: { labels: ['龙', '虎', '和'], datasets: [{ data: [dr.dragon, dr.tiger, dr.tie], backgroundColor: ['#ef4444', '#3b82f6', '#22c55e'] }] }, options: { maintainAspectRatio: false, plugins: { title: { display: true, text: `龙虎（理论 45/45/10）` } } } })
  const L = { big: '大', small: '小', odd: '单', even: '双', dragon: '龙', tiger: '虎', tie: '和' }
  $('streaks').innerHTML = Object.entries(d.maxStreak).map(([k, v]) => { const m = S.markets.find(x => x.key === k); const c = d.currentStreak[k]; return `<div class="kpi !p-2"><div class="text-slate-500 truncate">${m?.name || k}</div><div class="flex justify-between items-end"><span>最长 <b class="font-mono text-amber-400 text-base">${v}</b></span><span class="text-slate-400">当前 ${L[c.v]}×<b class="text-slate-200">${c.len}</b></span></div></div>` }).join('')
}
// =====================================================================
// K 线模块（ECharts）
// =====================================================================
const UP = '#ef4444', DOWN = '#22c55e'   // 中式：红涨绿跌
 function ec(id) { const el = $(id); if (!el) return null; if (!S.ec[id]) { S.ec[id] = echarts.init(el, null, { renderer: 'canvas' }) } return S.ec[id] }
window.addEventListener('resize', () => Object.values(S.ec).forEach(c => c.resize()))

/** 通用蜡烛图 option */
function candleOption(candles, opt = {}) {
  const { base, title, ma5, ma20, yFmt = v => pct(v, 0), volume = true, yMin, yMax, evLine = true } = opt
  const x = candles.map(c => c.expect.slice(-4))
  const series = [{ name: title || '频率', type: 'candlestick', data: candles.map(c => [c.o, c.c, c.l, c.h]), itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN }, xAxisIndex: 0, yAxisIndex: 0,
    markLine: base !== undefined && evLine ? { symbol: 'none', silent: true, lineStyle: { color: '#fbbf24', type: 'dashed', width: 1 }, label: { show: true, position: 'end', formatter: '理论 ' + yFmt(base), color: '#fbbf24', fontSize: 10 }, data: [{ yAxis: base }] } : undefined }]
  if (ma5) series.push({ name: 'MA5', type: 'line', data: ma5, smooth: true, showSymbol: false, lineStyle: { width: 1.2, color: '#f59e0b' }, xAxisIndex: 0, yAxisIndex: 0 })
  if (ma20) series.push({ name: 'MA20', type: 'line', data: ma20, smooth: true, showSymbol: false, lineStyle: { width: 1.2, color: '#06b6d4' }, xAxisIndex: 0, yAxisIndex: 0 })
  if (volume) series.push({ name: '命中次数', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: candles.map(c => ({ value: c.v, itemStyle: { color: c.c >= c.o ? UP + '99' : DOWN + '99' } })) })
  return {
    backgroundColor: 'transparent', animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 }, formatter: (ps) => { const c = candles[ps[0].dataIndex]; if (!c) return ''; return `<b>${c.from} → ${c.to}</b><br/>开 ${yFmt(c.o)} 收 <b style="color:${c.c >= c.o ? UP : DOWN}">${yFmt(c.c)}</b><br/>高 ${yFmt(c.h)} 低 ${yFmt(c.l)}<br/>命中 ${c.v} 次 / 期望 ${c.ev}` + (ma5 ? `<br/>MA5 ${ma5[ps[0].dataIndex] == null ? '—' : yFmt(ma5[ps[0].dataIndex])} · MA20 ${ma20?.[ps[0].dataIndex] == null ? '—' : yFmt(ma20[ps[0].dataIndex])}` : '') } },
    legend: ma5 ? { data: ['MA5', 'MA20'], top: 0, right: 10, textStyle: { color: '#94a3b8', fontSize: 10 }, itemWidth: 14 } : undefined,
    grid: volume ? [{ left: 44, right: 56, top: 22, height: '58%' }, { left: 44, right: 56, top: '76%', height: '16%' }] : [{ left: 44, right: 56, top: 14, bottom: 26 }],
    xAxis: [{ type: 'category', data: x, gridIndex: 0, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 9, show: !volume }, axisTick: { show: false }, boundaryGap: true }, ...(volume ? [{ type: 'category', data: x, gridIndex: 1, axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 9 }, axisTick: { show: false } }] : [])],
    yAxis: [{ scale: true, gridIndex: 0, min: yMin, max: yMax, splitLine: { lineStyle: { color: '#1e293b' } }, axisLabel: { color: '#64748b', fontSize: 9, formatter: yFmt } }, ...(volume ? [{ gridIndex: 1, splitNumber: 2, splitLine: { show: false }, axisLabel: { color: '#64748b', fontSize: 9 } }] : [])],
    dataZoom: [{ type: 'inside', xAxisIndex: volume ? [0, 1] : [0], start: Math.max(0, 100 - 6000 / Math.max(1, candles.length)), end: 100 }],
    series,
  }
}

async function loadKline() {
  const d = (await api.get('/analysis/kline', { params: { source: S.source, digit: S.digit, pos: S.pos, bucket: $('bucket-sel').value, window: $('window-sel').value } })).data
  S.kl = d
  $('kl-title').textContent = `数字 ${d.digit} · ${d.posName} · ${d.n} 期`
  // 位置 tab
  $('pos-tabs').innerHTML = [['any', '任意位'], [0, '万'], [1, '千'], [2, '百'], [3, '十'], [4, '个']].map(([k, l]) => `<button class="tab ${String(S.pos) === String(k) ? 'active' : ''}" data-p="${k}">${l}</button>`).join('')
  document.querySelectorAll('#pos-tabs .tab').forEach(b => b.onclick = () => { S.pos = b.dataset.p === 'any' ? 'any' : Number(b.dataset.p); loadKline() })
  // 数字选择器（带冷热标记）
  $('digit-sel').innerHTML = d.profile.map(p => `<button class="digit-btn ${p.digit === d.digit ? 'active' : ''} ${p.heat > 0.3 ? 'hot' : p.heat < -0.3 ? 'cold' : ''}" data-d="${p.digit}" title="全量 ${pct(p.freq)} · 近30 ${pct(p.freq30)} · 遗漏 ${p.gap}">${p.digit}<small>${pct(p.freq30, 0)} · 遗${p.gap}</small></button>`).join('')
  document.querySelectorAll('.digit-btn').forEach(b => b.onclick = () => { S.digit = Number(b.dataset.d); loadKline() })
  // 主 K 线
  ec('k-main').setOption(candleOption(d.candles, { base: d.base, title: `数字 ${d.digit} 频率`, ma5: d.ma5, ma20: d.ma20 }), true)
  // KPI
  const st = d.stats
  const k = (l, v, c = 'text-cyan-300') => `<div class="kpi !p-2"><div class="text-[10px] text-slate-500">${l}</div><div class="font-mono font-bold ${c}">${v}</div></div>`
  $('kl-kpis').innerHTML = k('实际 / 期望', `${st.total} / ${st.expected}`) + k('出现率', pct(st.rate), st.rate > d.base ? 'text-red-400' : 'text-emerald-400') + k('z 分数', (st.z > 0 ? '+' : '') + st.z, Math.abs(st.z) > 2 ? 'text-amber-400' : 'text-slate-300') + k('当前遗漏', st.gapNow, st.gapNow > st.avgGap * 2 ? 'text-blue-400' : 'text-slate-300') + k('平均 / 最大遗漏', `${st.avgGap} / ${st.maxGap}`) + k('最长连出', st.maxRun) + k('阳线 / 阴线', `${st.upCount} / ${st.downCount}`) + k('趋势', st.trend === 'up' ? '升温 ↗' : st.trend === 'down' ? '降温 ↘' : '震荡 →', st.trend === 'up' ? 'text-red-400' : st.trend === 'down' ? 'text-emerald-400' : 'text-slate-300')
  $('kl-tl').innerHTML = d.timeline.map(h => `<i class="${h ? 'on' : ''}"></i>`).join('')
  ec('k-gap').setOption({ backgroundColor: 'transparent', animation: false, grid: { left: 28, right: 6, top: 6, bottom: 18 }, tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#e2e8f0', fontSize: 11 } }, xAxis: { type: 'category', data: st.gapHist.map((_, i) => i === 20 ? '20+' : i), axisLabel: { color: '#64748b', fontSize: 8, interval: 3 } }, yAxis: { type: 'value', axisLabel: { color: '#64748b', fontSize: 8 }, splitLine: { lineStyle: { color: '#1e293b' } } }, series: [{ type: 'bar', data: st.gapHist, itemStyle: { color: '#3b82f6' } }, { type: 'line', showSymbol: false, lineStyle: { color: '#fbbf24', width: 1 }, data: st.gapHist.map((_, i) => { const p = d.per * d.base; const tot = st.gapHist.reduce((a, b) => a + b, 0); return i < 20 ? tot * p * (1 - p) ** i : tot * (1 - p) ** 20 }) }] }, true)
  // 文字解读
  const r = []
  r.push(`数字 <b class="text-amber-400">${d.digit}</b> 在${d.posName}共出现 ${st.total} 次（期望 ${st.expected}），z=${st.z}：${Math.abs(st.z) < 1 ? '完全在随机波动范围内' : Math.abs(st.z) < 2 ? '轻微偏离，仍属正常' : '偏离较大（|z|>2），属 5% 小概率事件——但 50 个数字×位置中总会有几个'}。`)
  r.push(`当前遗漏 ${st.gapNow} 期（平均 ${st.avgGap}，历史最大 ${st.maxGap}），${st.gapNow > st.avgGap * 2 ? '处于“冷号”区间，追冷派会关注' : st.gapNow === 0 ? '上一期刚刚开出，热号派会跟' : '处于正常区间'}。`)
  r.push(`K 线：最新收盘 ${pct(st.lastClose)}，MA5 ${st.m5 == null ? '—' : pct(st.m5)}，MA20 ${st.m20 == null ? '—' : pct(st.m20)} → ${st.trend === 'up' ? '多头排列，短期“升温”' : st.trend === 'down' ? '空头排列，短期“降温”' : '均线纠绕，震荡'}。记住：频率均值回归到 10% 是数学必然，趋势不具预测力。`)
  $('kl-read').innerHTML = r.join('<br/>')
  // 市场 K 线
  const mk = d.markets
  ec('k-sum').setOption(candleOption(mk.sum, { base: 22.5, title: '总和', yFmt: v => Number(v).toFixed(1), volume: false, yMin: 0, yMax: 45 }), true)
  ec('k-big').setOption(candleOption(mk.big, { base: .5, title: '大率', volume: false, yMin: .2, yMax: .8 }), true)
  ec('k-odd').setOption(candleOption(mk.odd, { base: .5, title: '单率', volume: false, yMin: .2, yMax: .8 }), true)
  ec('k-dragon').setOption(candleOption(mk.dragon, { base: .45, title: '龙率', volume: false, yMin: .15, yMax: .75 }), true)
}
$('bucket-sel').onchange = loadKline; $('window-sel').onchange = loadKline

// =====================================================================
// 本期推荐模块
// =====================================================================
const PLAY_ICON = { pos: 'fa-crosshairs', pos2: 'fa-arrows-left-right', sum: 'fa-plus-minus', dragon: 'fa-dragon', shape: 'fa-shapes' }
const LVL = { strong: '强共识', mild: '温和', neutral: '中性' }
function candRow(c, prior, top) {
  const w = Math.min(100, c.p / (prior * 2.2) * 100)          // 以 2.2×先验 为满格
  const bx = Math.min(100, 100 / 2.2)
  const col = c.p > prior * 1.08 ? UP : c.p < prior * 0.92 ? DOWN : '#64748b'
  return `<div class="cand ${top ? 'top1' : ''}" title="投票 ${c.votes} · 遗漏 ${c.gap} · EV ${c.ev >= 0 ? '+' : ''}${c.ev}">
    <span class="lb" style="color:${top ? '#fbbf24' : '#e2e8f0'}">${c.label}</span>
    <span class="pb"><i style="width:${w}%;background:${col}"></i><b style="left:${bx}%"></b></span>
    <span class="font-mono w-12 text-right">${pct(c.p)}</span>
    <span class="text-[10px] text-slate-500 w-10 text-right">×${c.odds}</span>
    <span class="text-[10px] ${c.ev > 0 ? 'text-emerald-400' : 'text-slate-600'} w-12 text-right">EV ${c.ev >= 0 ? '+' : ''}${(c.ev * 100).toFixed(0)}%</span>
    <span class="text-amber-400 text-[9px] w-10">${'★'.repeat(c.star)}</span></div>`
}
function renderPlay() {
  const d = S.rec; if (!d) return
  const play = d.plays.find(p => p.play === S.play)
  $('play-tabs').innerHTML = d.plays.map(p => { const best = [...p.groups].sort((a, b) => b.tilt - a.tilt)[0]; return `<button class="tab ${p.play === S.play ? 'active' : ''}" data-p="${p.play}"><i class="fas ${PLAY_ICON[p.play]} mr-1"></i>${p.name.split('（')[0]} <span class="text-[10px] opacity-70">最高倾向 ${best.tilt}</span></button>` }).join('')
  document.querySelectorAll('#play-tabs .tab').forEach(b => b.onclick = () => { S.play = b.dataset.p; renderPlay() })
  const cols = play.groups.length === 1 ? 'xl:grid-cols-1 md:grid-cols-1' : play.groups.length === 2 ? 'xl:grid-cols-2' : 'xl:grid-cols-5'
  $('play-body').className = 'grid md:grid-cols-2 gap-3 ' + cols
  $('play-body').innerHTML = play.groups.map(g => {
    const top = g.candidates[0]
    return `<div class="play-card">
      <div class="flex justify-between items-start mb-1"><div><div class="text-xs text-slate-400">${g.name}</div><div class="text-2xl font-black" style="color:${g.level === 'strong' ? '#22c55e' : g.level === 'mild' ? '#eab308' : '#94a3b8'}">${top.label} <span class="text-sm font-mono text-amber-400">${pct(top.p)}</span></div></div>
        <div class="text-right text-[10px]"><div class="lvl-${g.level} font-bold">${LVL[g.level]}</div><div class="text-slate-500">倾向 ${g.tilt} · 共识 ${g.consensus}%</div>${g.streak.len >= 3 ? `<div class="text-orange-400"><i class="fas fa-fire"></i> ${g.streak.label}连${g.streak.len}</div>` : ''}</div></div>
      <div class="space-y-0.5 mt-2">${g.candidates.map((c, i) => candRow(c, c.prior, i === 0)).join('')}</div>
      <div class="text-[11px] text-slate-400 mt-2 leading-relaxed border-t border-slate-800 pt-2"><i class="fas fa-lightbulb text-amber-400 mr-1"></i>${g.advice}</div>
    </div>`
  }).join('')
}
async function loadRecommend() {
  const d = (await api.get('/analysis/recommend', { params: { source: S.source } })).data
  S.rec = d
  $('rec-next').textContent = `下一期 ${d.next_expect || '—'}`
  $('rec-regime').textContent = d.strategy.regimeText; $('rec-regime').className = 'px-2 py-1 rounded-lg text-[11px] ' + (d.strategy.regime === 'pattern' ? 'bg-emerald-500/15 text-emerald-300' : d.strategy.regime === 'anti' ? 'bg-red-500/15 text-red-300' : 'bg-slate-700 text-slate-300')
  $('rec-steps').innerHTML = d.strategy.steps.map(s => `<div class="step-li">${s}</div>`).join('')
  const chip = (x, cls) => `<span class="px-2 py-1 rounded-lg text-[11px] ${cls}">${x.market} → <b>${x.pick}</b> ${pct(x.p)}</span>`
  $('rec-focus').innerHTML = d.strategy.focus.map(x => chip(x, 'bg-emerald-500/15 text-emerald-300 border border-emerald-700/40')).join('') + d.strategy.secondary.map(x => chip(x, 'bg-amber-500/10 text-amber-300 border border-amber-700/40')).join('') + d.strategy.streakWatch.map(x => `<span class="px-2 py-1 rounded-lg text-[11px] bg-orange-500/10 text-orange-300 border border-orange-700/40"><i class="fas fa-fire"></i> ${x.market} ${x.label}连${x.len}</span>`).join('')
  $('rec-board').innerHTML = d.digitBoard.map(x => `<div class="cand ${x.rank <= 3 ? 'top1' : ''} cursor-pointer" data-d="${x.digit}" title="最可能位置：${x.bestPosName}位 ${pct(x.perPos[x.bestPos])} · 近 30 期出现 ${x.cnt30} 次（期望 15）">
      <span class="text-slate-500 w-4 text-[10px]">${x.rank}</span><span class="lb text-lg" style="color:${x.rank <= 3 ? '#fbbf24' : '#e2e8f0'}">${x.digit}</span>
      <span class="pb"><i style="width:${Math.min(100, x.pAny / 0.6 * 100)}%;background:${x.pAny > x.priorAny ? UP : DOWN}"></i><b style="left:${x.priorAny / 0.6 * 100}%"></b></span>
      <span class="font-mono w-12 text-right">${pct(x.pAny)}</span><span class="text-[10px] w-14 text-right ${x.heat > 0.3 ? 'text-red-400' : x.heat < -0.3 ? 'text-blue-400' : 'text-slate-500'}">热 ${x.heat > 0 ? '+' : ''}${(x.heat * 100).toFixed(0)}%</span><span class="text-[10px] text-slate-500 w-10 text-right">遗 ${x.gapAny}</span></div>`).join('')
  document.querySelectorAll('#rec-board .cand').forEach(el => el.onclick = () => { S.digit = Number(el.dataset.d); S.pos = 'any'; loadKline(); $('kline-section').scrollIntoView({ behavior: 'smooth', block: 'start' }) })
  $('rec-disc').textContent = d.disclaimer
  renderPlay()
  // 倒计时：下一期开奖大致时间 = 最新一期时间 + 间隔
  const src = S.sources.find(s => s.key === S.source)
  if (src?.latest && d.interval_ms) { S.nextAt = src.latest + d.interval_ms; if (!S.cdTimer) S.cdTimer = setInterval(() => { const left = S.nextAt - Date.now(); if (left < -3000 && !S.refreshing) { S.refreshing = true; loadAll().finally(() => { S.refreshing = false; if (S.nextAt - Date.now() < 0) S.nextAt = Date.now() + 15000 }) } $('rec-countdown').textContent = left > 0 ? `距下期开奖 ≈ ${Math.floor(left / 60000)}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}` : '等待开奖数据…' }, 1000) }
}

init()
window.addEventListener('unhandledrejection', e => console.error('UNHANDLED:', e.reason?.stack || e.reason))
window.addEventListener('error', e => console.error('ERR:', e.error?.stack || e.message))
