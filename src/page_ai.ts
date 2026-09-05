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
textarea.nums { width:100%; height:96px; background:#fff; color:#111; border-radius:10px; padding:10px; font-family: ui-monospace, monospace; font-size:13px; line-height:1.6; resize:vertical; }
.stat { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; } .stat .v { font-family: ui-monospace, monospace; font-size:20px; font-weight:800; }
.streak { display:flex; gap:2px; } .streak i { width:10px; height:18px; border-radius:2px; background:#334155; } .streak i.h { background:#22c55e; }
.hrow { background:#0f172a; border:1px solid #1e293b; border-radius:12px; } .hrow summary { list-style:none; cursor:pointer; display:grid; grid-template-columns: 110px 70px 1fr 90px 90px; gap:10px; align-items:center; padding:10px 14px; font-size:13px; }
.hrow summary::-webkit-details-marker { display:none; } .hrow[open] summary { border-bottom:1px solid #1e293b; }
.hrow.hit { border-color:#22c55e66; }
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
      <span>AI <span class="text-pink-400">推荐</span> <span class="text-xs font-normal text-slate-500 ml-1">每期 500 注 · 三位号（万/千/百）</span> <span id="hd-model" class="text-[10px] font-normal text-slate-600 ml-1"></span></span>
    </div>
    <nav class="flex items-center gap-2 text-xs">
      <select id="source-sel" class="bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700"></select>
      <a href="/settings" title="配置中心" class="inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-gear text-sky-400"></i></a>
      <a href="/arena" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-trophy mr-1 text-emerald-400"></i>竞技场</a>
      <a href="/analysis" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-chart-line mr-1 text-cyan-400"></i>量化</a>
      <a href="/" class="bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>游戏</a>
    </nav>
  </div>
</header>

<main class="max-w-5xl mx-auto px-4 py-5 space-y-4">
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
        <div class="text-xs text-slate-400">距开奖</div>
        <div class="text-2xl font-black mono text-slate-100" id="cur-cd">—</div>
        <div class="text-[11px] text-slate-500" id="cur-state"></div>
        <div class="text-[11px] text-slate-400 mt-1" id="cur-lock"></div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 mt-4">
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

  <!-- 报单同步状态 -->
  <section id="sync-line" class="hidden text-xs text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1 px-1"></section>

  <!-- 战绩概览 -->
  <section id="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 hidden"></section>

  <!-- 逐期历史 -->
  <section id="hist-sec" class="hidden">
    <div class="flex items-center justify-between mb-2"><h2 class="font-bold text-sm"><i class="fas fa-clock-rotate-left mr-2 text-cyan-400"></i>逐期记录 <span class="text-xs text-slate-500 font-normal">点击展开该期 500 注 · 绿 = 命中</span></h2><select id="hist-n" class="bg-slate-800 rounded-lg px-2 py-1 border border-slate-700 text-xs"><option value="12">最近 12 期</option><option value="30">最近 30 期</option><option value="60">最近 60 期</option></select></div>
    <div id="hist" class="space-y-2"></div>
  </section>
  <p class="text-[11px] text-slate-600 leading-relaxed">哈希开奖逐期独立，任何三位号理论概率恒为 1/1000；500 注理论命中率 50%，按 950× 赔率保本需 52.6%。AI 推荐是量化信号 + 大模型推理的综合倾向，由真实开奖逐期检验，不构成任何收益承诺。</p>
</main>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/ai.js"></script>
</body>
</html>`
