export const arenaPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 策略竞技场（自动战绩榜）</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2322c55e%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-weight=%27bold%27%3E%E2%9A%94%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<link href="/static/style.css" rel="stylesheet">
<style>
.kpi { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:12px; }
.kpi .v { font-family: ui-monospace, monospace; font-size: 22px; font-weight: 800; }
.tab { padding:6px 12px; border-radius:8px; font-size:13px; color:#94a3b8; cursor:pointer; } .tab.active { background:#22c55e; color:#000; font-weight:600; }
.board { width:100%; border-collapse:separate; border-spacing:0 4px; font-size:12px; }
.board th { text-align:left; color:#64748b; font-weight:600; padding:4px 8px; font-size:11px; white-space:nowrap; }
.board td { padding:7px 8px; background:#0f172a; white-space:nowrap; } .board tr td:first-child { border-radius:8px 0 0 8px; } .board tr td:last-child { border-radius:0 8px 8px 0; }
.board tr.best td { background:#14532d33; box-shadow: inset 0 0 0 1px #22c55e66; }
.board tr.ctrl td { background:#1e293b66; }
.board tr.aiplan td { background:#83184322; box-shadow: inset 0 0 0 1px #f472b644; }
.plan-card { background:#0f172a; border:1px solid #f472b633; border-radius:12px; padding:12px; } .plan-card .kv { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; font-size:11px; } .plan-card .kv div b { display:block; font-size:13px; }
.mono { font-family: ui-monospace, monospace; }
.wbar { height:8px; border-radius:4px; background:#1e293b; overflow:hidden; } .wbar > div { height:100%; border-radius:4px; }
.strat-card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:10px; cursor:pointer; transition:.15s; } .strat-card:hover, .strat-card.active { border-color:#22c55e; }
.num-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap:3px; max-height:300px; overflow:auto; padding:4px; background:#020617; border:1px solid #1e293b; border-radius:10px; }
.num-grid span { font-family: ui-monospace, monospace; font-size:12px; text-align:center; padding:3px 0; border-radius:4px; background:rgba(148,163,184,.10); color:#cbd5e1; }
.num-grid span.hit { background:#22c55e; color:#000; font-weight:800; }
.hist { display:grid; grid-template-columns: 84px 60px repeat(9, 1fr); gap:3px; font-size:11px; align-items:center; }
.hist > div { padding:4px 6px; border-radius:6px; background:#0f172a; text-align:center; font-family: ui-monospace, monospace; }
.hist > div.h { background:#22c55e; color:#000; font-weight:800; } .hist > div.m { color:#475569; } .hist > div.head { background:transparent; color:#64748b; font-family:inherit; }
.hist > div.replay { color:#94a3b8; font-size:10px; }
.advice li { padding:6px 10px; border-left:3px solid #22c55e; background:#0f172a; border-radius:0 8px 8px 0; font-size:12px; }
.kchart { width:100%; height:300px; }
.ai-card { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:12px; }
.ai-row { display:grid; grid-template-columns: 70px 1fr 90px; gap:8px; padding:6px 8px; border-radius:8px; background:#0f172a; font-size:12px; align-items:start; }
.ai-row.hit { box-shadow: inset 0 0 0 1px #22c55e66; } .ai-row.err { opacity:.6; }
.pw { display:grid; grid-template-columns: 30px repeat(10, 1fr); gap:2px; font-size:10px; align-items:end; height:46px; }
.pw .b { background:linear-gradient(180deg,#f472b6,#be185d); border-radius:2px 2px 0 0; min-height:2px; }
.prose-ai h2 { font-size:14px; font-weight:700; color:#f9a8d4; margin:12px 0 4px; } .prose-ai p, .prose-ai li { color:#cbd5e1; font-size:12.5px; } .prose-ai ul { list-style:disc; padding-left:18px; } .prose-ai strong { color:#fff; }
textarea.nums { width:100%; height:110px; background:#fff; color:#111; border-radius:10px; padding:10px; font-family: ui-monospace, monospace; font-size:13px; line-height:1.6; resize:vertical; }
</style>
</head>
<body class="bg-[#0b0f1a] text-slate-200 min-h-screen">
<header class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-600 grid place-items-center text-black"><i class="fas fa-trophy"></i></span>
      <span>Hash<span class="text-emerald-400">Arena</span> <span class="text-xs font-normal text-slate-500 ml-1">策略竞技场 · 自动战绩榜</span></span>
    </div>
    <div class="flex items-center gap-2">
      <select id="source-sel" class="bg-slate-800 text-sm rounded-lg px-3 py-1.5 border border-slate-700"></select>
      <button id="sync-btn" class="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-rotate mr-1"></i>同步</button>
      <a href="/ai" class="inline-flex text-xs bg-pink-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-brain mr-1"></i>AI 推荐</a>
      <a href="/top3" class="inline-flex text-xs bg-amber-400 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-trophy mr-1"></i>优质策略</a>
      <a href="/settings" title="配置中心" class="inline-flex text-xs bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-gear text-sky-400"></i></a>
      <a href="/analysis" class="hidden md:inline-flex text-xs bg-cyan-600 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-chart-line mr-1"></i>量化分析</a>
      <a href="/" class="text-xs bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>返回游戏</a>
    </div>
  </div>
</header>

<main class="max-w-7xl mx-auto px-4 py-5 space-y-5">
  <div id="sync-bar"></div>

  <!-- 顶部 KPI -->
  <section id="kpis" class="grid grid-cols-2 md:grid-cols-6 gap-3"></section>

  <!-- AI 推荐入口（详情已独立到 /ai 页） -->
  <a href="/ai" id="ai-pick-link" class="card flex flex-wrap items-center justify-between gap-3 hover:border-pink-400/60 transition" style="border-color:#f472b655">
    <div class="flex items-center gap-3">
      <span class="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-purple-600 grid place-items-center text-black font-black">AI</span>
      <div><div class="font-bold">本期 AI 推荐 · 500 注 · 一键复制</div><div class="text-xs text-slate-400">已独立成页：每期实时给出 AI 策略的 500 注与推理，含逐期命中记录</div></div>
    </div>
    <span class="text-xs bg-pink-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-arrow-right mr-1"></i>打开 AI 推荐页</span>
  </a>

  <!-- 规则说明 -->
  <section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-bold"><i class="fas fa-flag-checkered mr-2 text-emerald-400"></i>赛制</h2>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-500">范围</span>
        <div class="flex gap-1" id="mode-tabs"><span class="tab active" data-m="all">全部</span><span class="tab" data-m="live">实盘</span><span class="tab" data-m="replay">回放</span></div>
        <button id="replay-btn" class="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-backward mr-1"></i>回放补齐历史 <span id="replay-left" class="text-slate-500"></span></button>
      </div>
    </div>
    <p class="text-xs text-slate-400 mt-2 leading-relaxed" id="rules"></p>
  </section>

  <!-- 战绩榜 -->
  <section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-ranking-star mr-2 text-amber-400"></i>战绩榜 <span class="text-xs text-slate-500 font-normal ml-2">按滚动 <span id="meta-k">40</span> 期 z 分数排序 · 每策略每期 500 注三位号（万千百）</span></h2>
      <span class="text-xs text-slate-500" id="board-meta"></span>
    </div>
    <div class="overflow-x-auto"><table class="board" id="board"><thead><tr>
      <th>#</th><th>策略</th><th>已结算</th><th>命中</th><th>命中率</th><th>基线</th><th>提升</th><th>z</th><th>滚动命中率</th><th>滚动 z</th><th>累计盈亏</th><th>ROI</th><th>最大回撤</th><th>连续未中</th><th>下期权重</th><th>结论</th>
    </tr></thead><tbody></tbody></table></div>
  </section>

  <!-- 曲线 -->
  <section class="grid lg:grid-cols-2 gap-4">
    <div class="card">
      <h3 class="font-bold text-sm mb-2"><i class="fas fa-chart-line mr-2 text-emerald-400"></i>累计盈亏曲线 <span class="text-xs text-slate-500 font-normal">（每注 1 单位，赔率 <span id="odds-1"></span>×）</span></h3>
      <div id="ch-pnl" class="kchart"></div>
    </div>
    <div class="card">
      <h3 class="font-bold text-sm mb-2"><i class="fas fa-percent mr-2 text-cyan-400"></i>累计命中率 vs 50% 基线</h3>
      <div id="ch-rate" class="kchart"></div>
    </div>
  </section>

  <!-- 自适应权重 + 投资策略结论 -->
  <section class="grid lg:grid-cols-3 gap-4">
    <div class="card">
      <h3 class="font-bold text-sm mb-2"><i class="fas fa-scale-balanced mr-2 text-emerald-400"></i>组合最优 · 下期权重 <span class="text-xs text-slate-500 font-normal">（只用已结算的过往战绩）</span></h3>
      <div id="weights" class="space-y-2"></div>
    </div>
    <div class="card lg:col-span-2">
      <h3 class="font-bold text-sm mb-2"><i class="fas fa-lightbulb mr-2 text-amber-400"></i>投资策略分析（自动生成 · 诚实版）</h3>
      <ul id="advice" class="advice space-y-1.5"></ul>
    </div>
  </section>

  <!-- AI 预测官：其余分析区（逐期复盘时间线） -->
  <section class="card" id="ai-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-timeline mr-2 text-pink-400"></i>AI 预测官 · 逐期预测与复盘 <span class="text-xs text-slate-500 font-normal ml-2" id="ai-meta"></span></h2>
      <span id="ai-status" class="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs"></span>
    </div>
    <p class="text-xs text-slate-400 mb-3 leading-relaxed">每期开奖后，AI 拿到自己上几期的预测与真实结果（命中/名次/盈亏），连同全部统计信号与各策略战绩一起重新推理，形成不间断的自我迭代。绿框 = 该期命中。</p>
    <div id="ai-timeline" class="grid md:grid-cols-2 gap-1.5"></div>
    <div id="ai-report" class="hidden mt-4 border-t border-slate-800 pt-3">
      <div class="flex items-center justify-between mb-2"><div class="text-xs text-slate-400 font-bold"><i class="fas fa-file-lines mr-1 text-pink-400"></i>AI 分析官报告（历史存档） <span id="ai-report-meta" class="font-normal"></span></div></div>
      <div id="ai-report-body" class="prose-ai text-sm leading-relaxed"></div>
    </div>
  </section>

  <!-- 投资策略模拟 -->
  <section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-chess mr-2 text-pink-400"></i>投资策略模拟 <span class="text-xs text-slate-500 font-normal ml-2">「选哪套 × 何时下注」的完整方案，每期决策只用之前已结算数据 · 每次 500 注 · 观望期不投 · <span class="text-pink-300">粉色 = AI 分析官提出、系统自动落成的规则</span></span></h2>
    </div>
    <div class="grid lg:grid-cols-5 gap-4">
      <div class="lg:col-span-3 overflow-x-auto"><table class="board" id="plans"><thead><tr>
        <th>#</th><th>方案</th><th>下注期</th><th>观望期</th><th>命中</th><th>命中率</th><th>z</th><th>累计盈亏</th><th>ROI</th><th>最大回撤</th><th title="AI 方案：规则提出之后的实盘逐期验证（不含提出前的样本内回测）">样本外</th><th>实际跟投</th>
      </tr></thead><tbody></tbody></table></div>
      <div class="lg:col-span-2"><div id="ch-plans" class="kchart"></div></div>
    </div>
  </section>

  <!-- AI 建议回测（二阶闭环） -->
  <section class="card" id="ai-plans-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-rotate mr-2 text-pink-400"></i>AI 建议自动回测 · 二阶闭环 <span class="text-xs text-slate-500 font-normal ml-2" id="ai-plans-meta"></span></h2>
      <span class="text-xs text-slate-500" id="ai-plans-cadence"></span>
    </div>
    <p class="text-xs text-slate-400 mb-3 leading-relaxed">AI 分析官每份报告里「下一阶段投资策略」的择时 / 切换 / 仓位 / 止损建议，会被<b class="text-slate-200">规则编译器</b>翻译成受限 DSL（只允许用该期之前已结算数据可算的指标），自动成为一套新的投资策略模拟：<b class="text-slate-200">样本内</b> = 提出前的历史回测（AI 看过这些数据，仅供参考）；<b class="text-pink-300">样本外</b> = 提出之后的实盘逐期验证（真正的检验）。样本外 ≥30 次下注且 z&lt;−1 的方案自动退役；活跃方案最多 4 套。下一份报告会收到这些样本外战绩——AI 提建议 → 系统验证 → 反馈给 AI。</p>
    <div id="ai-plans" class="grid md:grid-cols-2 gap-3"></div>
    <details class="mt-3" id="ai-plans-retired-wrap"><summary class="text-xs text-slate-500 cursor-pointer">已退役方案 <span id="ai-plans-retired-n"></span></summary><div id="ai-plans-retired" class="mt-2 space-y-1.5 text-xs"></div></details>
  </section>

  <!-- 当前期 500 注 -->
  <section class="card" id="current-section">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-hourglass-half mr-2 text-amber-400"></i>本期待开 · <span id="cur-expect" class="font-mono text-amber-300"></span> <span class="text-xs text-slate-500 font-normal ml-2" id="cur-meta"></span></h2>
      <div class="flex items-center gap-2 text-xs">
        <select id="cur-strat" class="bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700"></select>
        <select id="cur-fmt" class="bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700"><option value="space">空格分隔</option><option value="comma">逗号分隔</option><option value="line">每行一个</option></select>
        <button id="cur-copy" class="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-copy mr-1"></i>一键复制 500 注</button>
        <span id="cur-copied" class="hidden text-emerald-400"><i class="fas fa-check mr-1"></i>已复制</span>
      </div>
    </div>
    <div id="strat-cards" class="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2 mb-3"></div>
    <textarea id="cur-text" class="nums" readonly spellcheck="false"></textarea>
    <div class="num-grid mt-2" id="cur-grid"></div>
  </section>

  <!-- 结算历史 -->
  <section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold"><i class="fas fa-clock-rotate-left mr-2 text-cyan-400"></i>逐期结算 <span class="text-xs text-slate-500 font-normal ml-2">绿 = 命中（括号内为名次）· 点击期号查看该期各策略 500 注</span></h2>
      <select id="hist-n" class="bg-slate-800 text-xs rounded-lg px-2 py-1.5 border border-slate-700"><option value="30">最近 30 期</option><option value="60">最近 60 期</option><option value="120">最近 120 期</option><option value="200">最近 200 期</option></select>
    </div>
    <div id="hist" class="hist"></div>
  </section>

  <p class="text-[11px] text-slate-500 leading-relaxed" id="disclaimer"></p>
</main>

<!-- 期详情弹窗 -->
<div id="modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 overflow-auto">
  <div class="max-w-4xl mx-auto card mt-8">
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-bold" id="modal-title"></h3>
      <button id="modal-close" class="text-slate-400 hover:text-white"><i class="fas fa-xmark text-lg"></i></button>
    </div>
    <div id="modal-body"></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/sync.js"></script>
<script src="/static/arena.js"></script>
</body>
</html>`
