// ================= HashQuant 分析中心 =================
const $ = (id) => document.getElementById(id)
const api = axios.create({ baseURL: '/api' })
const S = { source: new URLSearchParams(location.search).get('source') || 'qkltj:6001', market: 'sum-size', markets: [], charts: {}, sources: [] }
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
async function loadAll() { renderKpis(); await Promise.all([loadOverview(), loadPredict(), loadStats()]) }

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
init()
window.addEventListener('unhandledrejection', e => console.error('UNHANDLED:', e.reason?.stack || e.reason))
window.addEventListener('error', e => console.error('ERR:', e.error?.stack || e.message))
