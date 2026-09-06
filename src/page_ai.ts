export const aiPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · AI 推荐 · 每期 500 注</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23f472b6%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-weight=%27bold%27%3EAI%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<style>
body { background:#0b0f1a; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hero { background: linear-gradient(180deg,#1a1030 0%,#111827 70%); border:1px solid #f472b655; border-radius:16px; }
.grid500 { display:grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap:4px; }
.grid500 span { font-family: ui-monospace, monospace; font-size:13px; text-align:center; padding:4px 0; border-radius:5px; background:rgba(148,163,184,.10); color:#e2e8f0; }
.grid500 span.boost { background:#f472b6; color:#000; font-weight:700; }
.grid500 span.hit { background:#22c55e; color:#000; font-weight:800; }
.grid500 span.dim { opacity:.35; } .grid500 span.novel { box-shadow: inset 0 0 0 1px #22d3ee88; }
.tab { font-size:12px; padding:6px 12px; border-radius:10px; border:1px solid #1e293b; background:#0f172a; color:#94a3b8; cursor:pointer; } .tab.on { background:#f472b6; color:#000; border-color:#f472b6; font-weight:700; } .tab small { opacity:.7; margin-left:4px; }
.sc { background:#0b1220; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; } .sc.on { border-color:#f472b6; }
.chipsub { display:inline-flex; align-items:center; gap:3px; font-size:10px; padding:1px 6px; border-radius:999px; background:#1e293b; color:#94a3b8; } .chipsub.h { background:#22c55e33; color:#86efac; } .chipsub.c { outline:1px solid #7c3aed66; }
textarea.nums { width:100%; height:96px; background:#fff; color:#111; border-radius:10px; padding:10px; font-family: ui-monospace, monospace; font-size:13px; line-height:1.6; resize:vertical; }
.stat { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; } .stat .v { font-family: ui-monospace, monospace; font-size:20px; font-weight:800; }
.streak { display:flex; gap:2px; } .streak i { width:10px; height:18px; border-radius:2px; background:#334155; } .streak i.h { background:#22c55e; }
/* 逐期记录 · 紧凑表格 */
.hn { font-size:11px; padding:3px 9px; border-radius:6px; background:#0f172a; border:1px solid #1e293b; color:#94a3b8; font-family: ui-monospace, monospace; } .hn:hover { color:#e2e8f0; } .hn.on { background:#0e7490; border-color:#22d3ee; color:#fff; }
.hsum { display:flex; flex-wrap:wrap; gap:6px; } .hsum .t { display:inline-flex; align-items:center; gap:6px; font-size:11px; padding:3px 8px; border-radius:6px; background:#0f172a; border:1px solid #1e293b; color:#94a3b8; } .hsum .t b { font-family: ui-monospace, monospace; color:#e2e8f0; } .hsum .t.good b { color:#86efac; } .hsum .t.c { border-color:#7c3aed66; }
.htbl-wrap { background:#0f172a; border:1px solid #1e293b; border-radius:12px; overflow:auto; max-height:70vh; }
.htbl { width:100%; border-collapse:separate; border-spacing:0; font-size:12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.htbl thead th { position:sticky; top:0; z-index:1; background:#0b1220; color:#64748b; font-weight:500; font-size:10.5px; letter-spacing:.02em; padding:6px 8px; text-align:center; border-bottom:1px solid #1e293b; white-space:nowrap; }
.htbl thead th.l { text-align:left; } .htbl thead th.r { text-align:right; } .htbl thead th.c { color:#a78bfa; } .htbl thead th.s { color:#fde047; }
.htbl tbody tr.hr { cursor:pointer; height:26px; } .htbl tbody tr.hr:hover td { background:#111c33; } .htbl tbody tr.hr.open td { background:#111c33; }
.htbl tbody tr.hr:nth-child(4n+1) td { border-top:1px solid #1e293b44; }
.htbl td { padding:2px 8px; text-align:center; white-space:nowrap; border-bottom:1px solid #0b1220; line-height:1.3; }
.htbl td.l { text-align:left; } .htbl td.r { text-align:right; }
.htbl td.ex { color:#fcd34d; } .htbl td.ex small { color:#475569; margin-left:4px; font-size:10px; }
.htbl td.ac { font-weight:800; color:#cbd5e1; letter-spacing:.06em; } tr.hit td.ac { color:#4ade80; }
.htbl td.rk { color:#64748b; } tr.hit td.rk { color:#86efac; font-weight:700; }
.htbl td.pn.p { color:#4ade80; } .htbl td.pn.m { color:#fb7185; }
.htbl td.rg { color:#64748b; font-family: system-ui, sans-serif; font-size:11px; max-width:190px; overflow:hidden; text-overflow:ellipsis; text-align:left; } .htbl td.rg.fb { color:#475569; font-style:italic; }
.cell { display:inline-block; width:18px; height:14px; border-radius:3px; background:#1e293b; vertical-align:middle; } .cell.h { background:#22c55e; } .cell.c { box-shadow: inset 0 0 0 1px #7c3aed88; } .cell.s { box-shadow: inset 0 0 0 1px #eab30888; } .cell.na { background:transparent; border:1px dashed #1e293b; }
.htbl tr.det td { padding:10px 12px; background:#0b1220; text-align:left; white-space:normal; border-bottom:1px solid #1e293b; cursor:default; }
.htbl .grid500 span { font-size:12px; padding:3px 0; }
@media (max-width: 768px) { .htbl td.rg, .htbl th.rg { display:none; } }
.badge { font-size:11px; padding:2px 8px; border-radius:999px; font-weight:700; } .badge.h { background:#22c55e; color:#000; } .badge.m { background:#1e293b; color:#94a3b8; }
/* 进度条 */
.prog { height:6px; border-radius:999px; background:#1e293b; overflow:hidden; } .prog > div { height:100%; border-radius:999px; background:linear-gradient(90deg,#f472b6,#a855f7); transition: width .4s ease; }
.prog.indet > div { width:40% !important; animation: indet 1.2s infinite ease-in-out; } @keyframes indet { 0% { margin-left:-40% } 100% { margin-left:100% } }
.steps { display:grid; grid-template-columns: repeat(4,1fr); gap:6px; font-size:11px; color:#64748b; } .steps div { display:flex; align-items:center; gap:5px; } .steps div.on { color:#f9a8d4; } .steps div.done { color:#86efac; }
.skel { background:linear-gradient(90deg,#0f172a 25%,#1e293b 50%,#0f172a 75%); background-size:200% 100%; animation: sk 1.4s infinite; border-radius:6px; } @keyframes sk { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
.reason { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:12px; font-size:12.5px; line-height:1.7; color:#cbd5e1; }
.reason b { color:#f9a8d4; }
.pw { display:grid; grid-template-columns: 28px repeat(10, 1fr); gap:2px; font-size:10px; align-items:end; height:44px; }
.pw .b { background:linear-gradient(180deg,#f472b6,#be185d); border-radius:2px 2px 0 0; min-height:2px; }
.fade-in { animation: fi .35s ease; } @keyframes fi { from { opacity:0; transform: translateY(4px) } to { opacity:1; transform:none } }
</style>
</head>
<body class="text-slate-200">
<header class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-400 to-purple-600 grid place-items-center text-black text-sm">AI</span>
      <span>AI <span class="text-pink-400">推荐</span> <span class="text-xs font-normal text-slate-500 ml-1">每期 500 注 · 三位号（万/千/百）</span> <span id="hd-model" class="hidden lg:inline text-[10px] font-normal text-slate-600 ml-1"></span></span>
    </div>
    <nav class="flex items-center gap-2 text-xs whitespace-nowrap">
      <select id="source-sel" class="bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700"></select>
      <a href="/top3" class="inline-flex whitespace-nowrap bg-amber-400 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-trophy mr-1"></i>优质策略</a>
      <a href="/query" title="逐期命中查询" class="inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-magnifying-glass mr-1 text-cyan-400"></i>查询</a>
      <a href="/settings" title="配置中心" class="inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-gear text-sky-400"></i></a>
      <a href="/arena" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-trophy mr-1 text-emerald-400"></i>竞技场</a>
      <a href="/analysis" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-chart-line mr-1 text-cyan-400"></i>量化</a>
      <a href="/" class="bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>游戏</a>
    </nav>
  </div>
</header>

<main class="max-w-5xl mx-auto px-4 py-5 space-y-4">
  <div id="stale-bar" class="hidden bg-rose-600/20 border border-rose-500/50 text-rose-200 text-sm rounded-xl px-4 py-2"></div>
  <!-- 加载进度（数据到达前的唯一可见内容） -->
  <section id="loader" class="hero p-5">
    <div class="flex items-center justify-between text-sm mb-2"><span id="ld-text" class="text-slate-200"><i class="fas fa-brain text-pink-400 mr-2"></i>正在连接…</span><span id="ld-pct" class="mono text-slate-400">0%</span></div>
    <div class="prog" id="ld-bar"><div style="width:0%"></div></div>
    <div class="steps mt-3" id="ld-steps">
      <div data-s="1"><i class="fas fa-circle text-[6px]"></i>连接数据源</div>
      <div data-s="2"><i class="fas fa-circle text-[6px]"></i>同步最新开奖</div>
      <div data-s="3"><i class="fas fa-circle text-[6px]"></i>AI 推理本期</div>
      <div data-s="4"><i class="fas fa-circle text-[6px]"></i>锁定 500 注</div>
    </div>
    <div class="mt-4 space-y-2"><div class="skel h-6 w-2/3"></div><div class="skel h-24"></div><div class="skel h-40"></div></div>
  </section>

  <!-- 本期 -->
  <section id="cur" class="hero p-5 hidden">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs text-slate-400">本期待开</div>
        <div class="text-3xl font-black mono text-amber-300" id="cur-expect">—</div>
        <div class="text-xs text-slate-500 mt-1" id="cur-sub"></div>
      </div>
      <div class="text-right">
        <div class="text-xs text-slate-400">距开奖 <span class="text-slate-600" id="cur-open-bj"></span></div>
        <div class="text-2xl font-black mono text-slate-100" id="cur-cd">—</div>
        <div class="text-[11px] text-slate-500" id="cur-state"></div>
        <div class="text-[11px] text-slate-400 mt-1" id="cur-lock"></div>
      </div>
    </div>
    <!-- 精选档位：同一份 AI 排序，前 N 注 -->
    <div class="flex flex-wrap items-center gap-2 mt-4" id="sub-tabs"></div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <button id="copy-btn" class="bg-pink-500 hover:bg-pink-400 text-black font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed"><i class="fas fa-copy mr-2"></i>一键复制 500 注</button>
      <select id="fmt" class="bg-slate-800 rounded-lg px-2 py-2 border border-slate-700 text-xs"><option value="space">空格分隔</option><option value="comma">逗号分隔</option><option value="line">每行一个</option></select>
      <span id="copied" class="hidden text-emerald-400 text-sm"><i class="fas fa-check mr-1"></i>已复制到剪贴板</span>
      <span class="ml-auto text-xs text-slate-500" id="cur-meta"></span>
    </div>
    <div id="cur-wait" class="hidden mt-4">
      <div class="flex items-center justify-between text-xs mb-1"><span class="text-pink-300"><i class="fas fa-spinner fa-spin mr-1"></i><span id="wait-text">AI 正在推理本期…</span></span><span class="mono text-slate-500" id="wait-sec">0s</span></div>
      <div class="prog indet"><div></div></div>
    </div>
    <textarea id="cur-text" class="nums mt-4" readonly spellcheck="false" placeholder="500 注将在此显示"></textarea>
    <div class="grid500 mt-3" id="cur-grid"></div>
    <details class="mt-3" id="cur-why"><summary class="text-xs text-pink-300 cursor-pointer select-none"><i class="fas fa-lightbulb mr-1"></i>为什么是这 500 注（AI 推理）</summary><div class="reason mt-2" id="cur-reason"></div></details>
  </section>

  <!-- 报单同步状态 + 对账 -->
  <section id="sync-line" class="hidden text-xs text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1 px-1"></section>
  <section id="chk-sec" class="text-xs">
    <div class="flex items-center gap-3"><button id="chk-btn" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg"><i class="fas fa-scale-balanced mr-1"></i>与上游 API 对账</button><span class="text-slate-500">此刻直接拉 api.qkltj.com 原始数据，逐期比对期号 · 开奖时间 · 号码 · 区块 · hash 与 AI 结算</span></div>
    <div id="chk-out" class="hidden mt-2 bg-[#0f172a] border border-slate-800 rounded-xl p-3 text-slate-300"></div>
  </section>

  <!-- 战绩概览：500 注 + 三档精选 -->
  <section id="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 hidden"></section>
  <section id="sub-stats" class="hidden bg-[#0f172a] border border-slate-800 rounded-xl p-4">
    <h2 class="font-bold text-sm mb-2"><i class="fas fa-filter mr-2 text-rose-400"></i>AI 各档位战绩 <span class="text-xs text-slate-500 font-normal">每个注数都是独立生成（非 500 注前缀）；⚡ 二级精准 = 对全部一级生成加权共识；每档独立结算（每注 1，命中 +950−N，未中 −N）；保本 = N/950</span></h2>
    <div class="grid md:grid-cols-4 gap-3" id="sub-cards"></div>
  </section>

  <!-- 多组独立生成：每档 5 组 A–E -->
  <section id="sets-sec" class="hidden bg-[#0f172a] border border-slate-800 rounded-xl p-4">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold text-sm"><i class="fas fa-layer-group mr-2 text-violet-400"></i>本期 5 组独立生成 <span class="text-xs text-slate-500 font-normal" id="sets-expect"></span></h2>
      <div class="flex items-center gap-1 text-xs" id="sets-ntabs"></div>
    </div>
    <p class="text-[11px] text-slate-500 mb-3">每档注数都由 5 种视角<b class="text-slate-400">各自独立算出</b>（不是 500 注的前缀）：<span style="color:#f472b6">A 融合</span> AI 定位×量化 · <span style="color:#a78bfa">B 定位</span> 纯 AI 三位权重 · <span style="color:#22d3ee">C 量化</span> 仅 z&gt;0 量化共识 · <span style="color:#fbbf24">D 聚焦</span> 核心号优先 · <span style="color:#34d399">E 互补</span> 与 A 零重叠。每组独立入榜结算，<i class="fas fa-crown text-amber-300"></i> = 该注数下历史最会中的组，<i class="fas fa-fire text-orange-400"></i> = 近 60 期最热。</p>
    <div id="sets-cards" class="grid md:grid-cols-5 gap-2"></div>
    <div id="sets-board" class="mt-3"></div>
  </section>

  <!-- 注数回测：只投前 N 注 -->
  <section id="stake-sec" class="hidden bg-[#0f172a] border border-slate-800 rounded-xl p-4">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="font-bold text-sm"><i class="fas fa-sliders mr-2 text-amber-400"></i>投注注数回测 <span class="text-xs text-slate-500 font-normal">若每期只投 AI 排名前 N 注（号码按 AI 得分排序，前 N 个即上方列表前 N 个），历史命中率 / ROI 会怎样</span></h2><span id="stake-best" class="text-xs"></span></div>
    <div id="stake" class="overflow-auto"></div>
    <div class="text-[11px] text-slate-600 mt-2">保本命中率 = N/950。edge = 实际命中率 − 保本线。用已结算期的命中位次直接推算，非模拟。样本越少 z 越不可信，请以 z 与期数一并判断。</div>
  </section>

  <!-- 逐期历史 -->
  <section id="hist-sec" class="hidden">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold text-sm"><i class="fas fa-clock-rotate-left mr-2 text-cyan-400"></i>逐期记录 <span class="text-xs text-slate-500 font-normal">点击行展开该期 500 注 · <span class="inline-block w-2 h-2 rounded-sm bg-emerald-500 align-middle"></span> 命中 · <span class="inline-block w-2 h-2 rounded-sm bg-slate-700 align-middle"></span> 未中</span></h2>
      <div class="flex items-center gap-1" id="hist-n" role="tablist">
        <button class="hn" data-n="50">50</button><button class="hn" data-n="100">100</button><button class="hn" data-n="200">200</button><button class="hn" data-n="500">500</button><button class="hn" data-n="1000">1000</button><span class="text-[11px] text-slate-500 ml-1">期</span>
      </div>
    </div>
    <div id="hist-sum" class="hsum mb-2"></div>
    <div class="htbl-wrap">
      <table class="htbl" id="hist-tbl"><thead><tr id="hist-head"></tr></thead><tbody id="hist"></tbody></table>
    </div>
    <div id="hist-foot" class="text-[11px] text-slate-500 mt-1"></div>
  </section>
  <p class="text-[11px] text-slate-600 leading-relaxed">哈希开奖逐期独立，任何三位号理论概率恒为 1/1000；500 注理论命中率 50%，按 950× 赔率保本需 52.6%。AI 推荐是量化信号 + 大模型推理的综合倾向，由真实开奖逐期检验，不构成任何收益承诺。</p>
</main>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/ai.js"></script>
</body>
</html>`
