export const analysisPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 量化分析中心</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2306b6d4%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-weight=%27bold%27%3E%25%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
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
.digit-btn { position:relative; height:52px; border-radius:10px; border:1px solid #1e293b; background:#0f172a; font-family: ui-monospace, monospace; font-weight:800; font-size:20px; cursor:pointer; transition:.15s; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1; }
.digit-btn small { font-size:9px; font-weight:400; color:#64748b; margin-top:3px; } .digit-btn:hover { border-color:#06b6d4; } .digit-btn.active { border-color:#f59e0b; background:#f59e0b22; box-shadow:0 0 0 2px #f59e0b55; }
.digit-btn.hot:before, .digit-btn.cold:before { content:''; position:absolute; top:5px; right:5px; width:6px; height:6px; border-radius:50%; } .digit-btn.hot:before { background:#ef4444; } .digit-btn.cold:before { background:#3b82f6; }
.cand { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:6px; font-size:12px; } .cand:nth-child(odd) { background:#0f172a; } .cand.top1 { background:#f59e0b1a; border:1px solid #f59e0b55; }
.cand .lb { width:44px; font-weight:800; font-family: ui-monospace, monospace; } .cand .pb { flex:1; height:8px; background:#1e293b; border-radius:4px; overflow:hidden; position:relative; } .cand .pb > i { position:absolute; left:0; top:0; height:100%; border-radius:4px; } .cand .pb > b { position:absolute; top:-2px; width:2px; height:12px; background:#fbbf24; }
.lvl-strong { color:#22c55e; } .lvl-mild { color:#eab308; } .lvl-neutral { color:#64748b; }
@keyframes pkflash { 0% { box-shadow:0 0 0 0 rgba(217,70,239,.7); } 100% { box-shadow:0 0 0 14px rgba(217,70,239,0); } }
.flash { animation: pkflash 1.2s ease-out 2; }
.play-card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:12px; }
.tl { display:grid; grid-template-columns: repeat(50, 1fr); gap:2px; } .tl i { height:10px; border-radius:2px; background:#1e293b; } .tl i.on { background:#f59e0b; }
.step-li { padding:6px 10px; border-left:3px solid #06b6d4; background:#0f172a; border-radius:0 8px 8px 0; font-size:12px; }
.kchart { width:100%; height:320px; } .kchart.sm { height:200px; }
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

  <!-- 本期推荐 -->
  <section class="card" id="rec-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="font-bold"><i class="fas fa-bullseye mr-2 text-amber-400"></i>本期推荐 · <span id="rec-next" class="text-amber-300 font-mono"></span> <span class="text-xs text-slate-500 font-normal ml-2">20 机制集成 · 每个玩法全部候选的概率都写出来</span></h2>
      <div class="flex items-center gap-2 text-xs"><span id="rec-countdown" class="font-mono text-slate-400"></span><span id="rec-regime" class="px-2 py-1 rounded-lg"></span></div>
    </div>
    <!-- 策略卡 -->
    <div class="grid lg:grid-cols-3 gap-4 mb-4">
      <div class="lg:col-span-2 space-y-2">
        <div class="text-xs text-slate-400 font-bold"><i class="fas fa-chess mr-1 text-cyan-400"></i>预见性策略（规则引擎自动生成）</div>
        <div id="rec-steps" class="space-y-1.5"></div>
        <div id="rec-focus" class="flex flex-wrap gap-2 pt-1"></div>
      </div>
      <div class="play-card">
        <div class="text-xs text-slate-400 font-bold mb-2"><i class="fas fa-star mr-1 text-amber-400"></i>幸运数字综合榜（任意位至少出现一次）</div>
        <div id="rec-board" class="space-y-1"></div>
        <div class="text-[10px] text-slate-500 mt-2">理论值 1−0.9⁵ = 41.0%；点击数字可切换下方 K 线</div>
      </div>
    </div>
    <!-- 玩法 Tab -->
    <div id="play-tabs" class="flex flex-wrap gap-1 mb-3"></div>
    <div id="play-body" class="grid md:grid-cols-2 xl:grid-cols-5 gap-3"></div>
    <div class="text-[11px] text-slate-500 mt-3"><i class="fas fa-circle-info mr-1"></i><span id="rec-disc"></span></div>
  </section>

  <!-- 幸运数字 K 线 -->
  <!-- 单双 K 线 + BOLL / MACD / KDJ -->
  <section class="card" id="parity-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="font-bold"><i class="fas fa-chart-line mr-2 text-fuchsia-400"></i>单双 K 线 · <span id="pk-title" class="text-fuchsia-300"></span> <span class="text-xs text-slate-500 font-normal ml-2">单指数 / 双指数 = 每期 +1/−1 累加路径 · BOLL(20,2) · MACD(12,26,9) · KDJ(9,3,3)</span></h2>
      <div class="flex flex-wrap gap-2 items-center text-xs">
        <div id="pk-pos" class="flex gap-1"></div>
        <label class="text-slate-400">粒度 <select id="pk-bucket" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option value="1" selected>1 期</option><option value="3">3 期</option><option value="5">5 期</option></select></label>
        <label class="text-slate-400">样本 <select id="pk-limit" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option value="200">200 注</option><option value="500" selected>500 注</option><option value="1000">1000 注</option></select></label>
        <span id="pk-live" class="text-slate-500"><i class="fas fa-circle text-emerald-400 mr-1" style="font-size:8px"></i>实时</span>
      </div>
    </div>
    <!-- 预判卡 -->
    <div id="pk-forecast" class="grid lg:grid-cols-3 gap-3 mb-4"></div>
    <!-- 两条 K 线 -->
    <div class="grid lg:grid-cols-2 gap-4">
      <div>
        <div class="flex items-center justify-between mb-1"><h3 class="text-sm font-bold text-red-300"><i class="fas fa-1 mr-1"></i>单指数 K 线（万位开单 +1 / 开双 −1）</h3><span id="pk-odd-kpi" class="text-xs font-mono text-slate-400"></span></div>
        <div id="pk-odd" class="kchart" style="height:520px"></div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1"><h3 class="text-sm font-bold text-sky-300"><i class="fas fa-2 mr-1"></i>双指数 K 线（万位开双 +1 / 开单 −1）</h3><span id="pk-even-kpi" class="text-xs font-mono text-slate-400"></span></div>
        <div id="pk-even" class="kchart" style="height:520px"></div>
      </div>
    </div>
    <!-- 指标读数 + 回测 -->
    <div class="grid lg:grid-cols-3 gap-3 mt-4">
      <div id="pk-ind" class="kpi text-xs lg:col-span-2"></div>
      <div id="pk-bt" class="kpi text-xs"></div>
    </div>
    <div id="pk-seq" class="mt-3 flex flex-wrap gap-1"></div>
    <p id="pk-disc" class="text-[11px] text-slate-500 mt-2"></p>
  </section>

  <section class="card" id="kline-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="font-bold"><i class="fas fa-chart-simple mr-2 text-emerald-400"></i>幸运数字 K 线 · <span id="kl-title" class="text-emerald-300"></span></h2>
      <div class="flex flex-wrap gap-2 items-center text-xs">
        <div id="pos-tabs" class="flex gap-1"></div>
        <label class="text-slate-400">K 线粒度 <select id="bucket-sel" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option value="1">1 期</option><option value="3">3 期</option><option value="5" selected>5 期</option><option value="10">10 期</option><option value="20">20 期</option></select></label>
        <label class="text-slate-400">频率窗口 <select id="window-sel" class="bg-slate-800 rounded px-2 py-1 border border-slate-700"><option value="10">10</option><option value="20" selected>20</option><option value="30">30</option><option value="50">50</option><option value="100">100</option></select></label>
      </div>
    </div>
    <div id="digit-sel" class="grid grid-cols-5 sm:grid-cols-10 gap-2 mb-3"></div>
    <div class="grid lg:grid-cols-4 gap-4">
      <div class="lg:col-span-3"><div id="k-main" class="kchart" style="height:380px"></div></div>
      <div class="space-y-2">
        <div id="kl-kpis" class="grid grid-cols-2 gap-2"></div>
        <div class="kpi"><div class="text-xs text-slate-400 mb-1">近 100 期命中点阵（右=最新）</div><div id="kl-tl" class="tl"></div></div>
        <div class="kpi"><div class="text-xs text-slate-400 mb-1">遗漏长度分布</div><div id="k-gap" class="kchart" style="height:120px"></div></div>
        <div id="kl-read" class="kpi text-xs leading-relaxed"></div>
      </div>
    </div>
    <div class="text-[11px] text-slate-500 mt-2">K 线读法：“价格” = 该数字在滚动窗口内的出现频率；阳线(红)=升温，阴线(绿)=降温；黄色虚线 = 理论频率 10%；下方柱子 = 该根 K 线内实际命中次数（成交量）。</div>
  </section>

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
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-line mr-2 text-violet-400"></i>总和 K 线（价格 = 每期总和，黄线 22.5 中轴）</h3><div id="k-sum" class="kchart sm"></div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-wave-square mr-2 text-emerald-400"></i>总和大率 K 线（滚动窗口，50% 中轴）</h3><div id="k-big" class="kchart sm"></div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-wave-square mr-2 text-fuchsia-400"></i>总和单率 K 线</h3><div id="k-odd" class="kchart sm"></div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-dragon mr-2 text-red-400"></i>龙率 K 线（理论 45%）</h3><div id="k-dragon" class="kchart sm"></div></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-chart-column mr-2 text-violet-400"></i>总和分布 (0-45)</h3><canvas id="ch-sum" height="180"></canvas></article>
    <article class="card"><h3 class="font-bold text-sm mb-3"><i class="fas fa-wave-square mr-2 text-emerald-400"></i>滚动 30 期 大/单 比率（折线）</h3><canvas id="ch-roll" height="180"></canvas></article>
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
