export const analysisPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 量化分析中心</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2306b6d4%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-weight=%27bold%27%3E%25%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<link href="/static/style.css" rel="stylesheet">
<style>
.kpi { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:12px; }
.kpi .v { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 800; }
.mech-row { display:grid; grid-template-columns: 28px 1fr 70px 70px 80px 1fr; gap:8px; align-items:center; padding:6px 8px; border-radius:8px; font-size:12px; }
.mech-row:nth-child(even) { background:#0f172a; }
.bar { height:8px; border-radius:4px; background:#1e293b; overflow:hidden; } .bar > div { height:100%; }
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:2px; }
.heat { display:grid; grid-template-columns: 40px repeat(10, 1fr); gap:3px; font-size:11px; }
.heat div { height:26px; display:grid; place-items:center; border-radius:4px; font-family: ui-monospace, monospace; }
.tab { padding:6px 12px; border-radius:8px; font-size:13px; color:#94a3b8; } .tab.active { background:#06b6d4; color:#000; font-weight:600; }
.mkt-card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:10px; cursor:pointer; transition:.15s; } .mkt-card:hover, .mkt-card.active { border-color:#06b6d4; }
.gauge { position:relative; width:120px; height:60px; overflow:hidden; margin:auto; } .gauge:before { content:''; position:absolute; inset:0; border-radius:120px 120px 0 0; background:conic-gradient(from 270deg, #22c55e 0deg, #eab308 90deg, #ef4444 180deg, transparent 180deg); }
.gauge:after { content:''; position:absolute; left:15px; right:15px; bottom:0; top:15px; background:#111827; border-radius:120px 120px 0 0; }
.needle { position:absolute; left:50%; bottom:0; width:2px; height:52px; background:#fff; transform-origin:bottom center; z-index:2; }
</style>
</head>
<body class="bg-[#0b0f1a] text-slate-200 min-h-screen">
<header class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 grid place-items-center text-black"><i class="fas fa-chart-line"></i></span>
      <span>Hash<span class="text-cyan-400">Quant</span> <span class="text-xs font-normal text-slate-500 ml-1">量化分析中心</span></span>
    </div>
    <div class="flex items-center gap-2">
      <select id="source-sel" class="bg-slate-800 text-sm rounded-lg px-3 py-1.5 border border-slate-700"></select>
      <button id="sync-btn" class="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-rotate mr-1"></i>同步</button>
      <a href="/" class="text-xs bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>返回游戏</a>
    </div>
  </div>
</header>

<main class="max-w-7xl mx-auto px-4 py-5 space-y-5">
  <!-- 数据源 KPI -->
  <section id="kpis" class="grid grid-cols-2 md:grid-cols-6 gap-3"></section>

  <!-- 全市场倾向总览 -->
  <section class="card">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-bold"><i class="fas fa-compass mr-2 text-cyan-400"></i>全市场倾向总览 <span class="text-xs text-slate-500 font-normal ml-2">20 机制集成 · 点击卡片进入深度分析</span></h2>
      <span id="ov-meta" class="text-xs text-slate-500"></span>
    </div>
    <div id="overview" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3"></div>
  </section>

  <!-- 深度分析 -->
  <section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h2 class="font-bold"><i class="fas fa-microscope mr-2 text-violet-400"></i>深度分析 · <span id="mk-name" class="text-cyan-300"></span></h2>
      <div class="flex flex-wrap gap-2 items-center text-xs">
        <select id="market-sel" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"></select>
        <label class="text-slate-400">回测期数 <select id="steps-sel" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option>60</option><option selected>150</option><option>300</option></select></label>
        <label class="text-slate-400">样本 <select id="limit-sel" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option>200</option><option>500</option><option selected>1000</option></select></label>
      </div>
    </div>
    <div class="grid lg:grid-cols-3 gap-4">
      <!-- 集成结果 -->
      <div class="space-y-3">
        <div class="kpi text-center">
          <div class="text-xs text-slate-400 mb-1">集成倾向（下一期）</div>
          <div class="gauge"><div id="needle" class="needle"></div></div>
          <div id="en-top" class="text-3xl font-black mt-1"></div>
          <div class="text-xs text-slate-500 mt-1">倾向指数 <b id="en-tilt" class="text-amber-400 font-mono"></b> / 100 · 机制共识 <b id="en-cons" class="text-cyan-400 font-mono"></b>%</div>
        </div>
        <div class="kpi"><div class="text-xs text-slate-400 mb-2">集成概率分布 vs 理论基线</div><canvas id="ch-ensemble" height="140"></canvas></div>
        <div class="kpi"><div class="text-xs text-slate-400 mb-2">机制投票</div><div id="votes" class="flex flex-wrap gap-1"></div></div>
        <div class="kpi text-xs space-y-1"><div class="text-slate-400 mb-1">形态快照</div><div id="snapshot"></div></div>
      </div>
      <!-- 机制排行 -->
      <div class="lg:col-span-2 space-y-3">
        <div class="kpi">
          <div class="flex justify-between text-xs text-slate-400 mb-2"><span>20 机制滚动回测（最近 <span id="bt-steps"></span> 期，逐期用历史预测下一期）</span><span>基线命中率 <b id="bt-base" class="font-mono text-slate-200"></b></span></div>
          <canvas id="ch-mech" height="190"></canvas>
        </div>
        <div class="kpi">
          <div class="mech-row text-slate-500 font-bold"><span>#</span><span>机制</span><span>命中率</span><span>vs 基线</span><span>权重</span><span>近 30 期命中</span></div>
          <div id="mech-list"></div>
        </div>
      </div>
    </div>
    <div class="mt-4 kpi"><div class="text-xs text-slate-400 mb-2">近 60 期序列（最新在右）</div><div id="recent-seq" class="flex flex-wrap gap-1"></div></div>
  </section>

  <!-- 多维统计图表 -->
  <section class="grid md:grid-cols-2 gap-5">
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-table-cells mr-2 text-amber-400"></i>五位 × 数字 频率热力图</h3><div id="heat" class="heat"></div><div class="text-xs text-slate-500 mt-2">颜色越亮出现越多；理论期望 = 样本/10</div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-snowflake mr-2 text-cyan-400"></i>五位 × 数字 当前遗漏</h3><div id="gaps" class="heat"></div><div class="text-xs text-slate-500 mt-2">数字 = 距上次出现的期数；越红越久未出</div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-column mr-2 text-violet-400"></i>总和分布 (0-45)</h3><canvas id="ch-sum" height="180"></canvas></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-wave-square mr-2 text-emerald-400"></i>滚动 30 期 大/单 比率</h3><canvas id="ch-roll" height="180"></canvas></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-clock mr-2 text-orange-400"></i>24 小时 时段分布（大率 / 单率 · UTC+8）</h3><canvas id="ch-hour" height="180"></canvas></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-shapes mr-2 text-pink-400"></i>形态 & 龙虎 分布 vs 理论</h3><div class="grid grid-cols-2 gap-3"><div style="height:200px"><canvas id="ch-shape"></canvas></div><div style="height:200px"><canvas id="ch-dragon"></canvas></div></div></article>
    <article class="card md:col-span-2"><h3 class="font-bold text-sm mb-3"><i class="fas fa-fire mr-2 text-red-400"></i>各市场最长连开（历史）与当前连开</h3><div id="streaks" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs"></div></article>
  </section>

  <section class="card text-xs text-slate-400 leading-relaxed">
    <b class="text-slate-200"><i class="fas fa-triangle-exclamation text-amber-400 mr-1"></i>方法论说明</b>：本页所有「倾向」均来自 20 种统计机制对历史序列的加权集成，权重由滚动回测的 log-loss 决定。区块哈希是密码学随机数——在足够长的回测中，任何机制命中率都将收敛到理论基线（两面盘 50%、定位胆 10%）。观察「vs 基线」列长期是否显著为正，就是检验随机性最直接的方式。本页用于统计教学与产品演示，不构成任何预测保证。
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/analysis.js"></script>
</body></html>`
