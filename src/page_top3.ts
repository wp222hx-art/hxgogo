import { atlasEntry } from './atlas-entry'
export const top3Page = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 战绩榜优质策略推荐选号</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23fbbf24%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2718%27 text-anchor=%27middle%27%3E%F0%9F%8F%86%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<style>
body { background:#0b0f1a; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.hero { background: linear-gradient(180deg,#1f1a0a 0%,#111827 70%); border:1px solid #fbbf2455; border-radius:16px; }
.card { background:#0f172a; border:1px solid #1e293b; border-radius:14px; }
.grid500 { display:grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap:4px; }
.grid500 span { font-family: ui-monospace, monospace; font-size:13px; text-align:center; padding:4px 0; border-radius:5px; background:rgba(148,163,184,.10); color:#e2e8f0; }
.grid500 span.c3 { background:#fbbf24; color:#000; font-weight:800; }
.grid500 span.c2 { background:#fbbf2455; color:#fde68a; }
.grid500 span.hit { background:#22c55e; color:#000; font-weight:800; }
textarea.nums { width:100%; height:96px; background:#fff; color:#111; border-radius:10px; padding:10px; font-family: ui-monospace, monospace; font-size:13px; line-height:1.6; resize:vertical; }
.stat { background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; } .stat .v { font-family: ui-monospace, monospace; font-size:20px; font-weight:800; }
.streak { display:flex; gap:2px; } .streak i { width:10px; height:18px; border-radius:2px; background:#334155; } .streak i.h { background:#22c55e; }
.member { border:1px solid #1e293b; border-radius:12px; background:#0f172a; }
.member .bar { height:4px; border-radius:999px; }
.rank { width:26px; height:26px; border-radius:8px; display:grid; place-items:center; font-weight:900; font-size:13px; color:#000; }
.hrow { background:#0f172a; border:1px solid #1e293b; border-radius:12px; } .hrow summary { list-style:none; cursor:pointer; display:grid; grid-template-columns: 110px 70px 1fr 90px 90px; gap:10px; align-items:center; padding:10px 14px; font-size:13px; }
.hrow summary::-webkit-details-marker { display:none; } .hrow[open] summary { border-bottom:1px solid #1e293b; } .hrow.hit { border-color:#22c55e66; }
.badge { font-size:11px; padding:2px 8px; border-radius:999px; font-weight:700; } .badge.h { background:#22c55e; color:#000; } .badge.m { background:#1e293b; color:#94a3b8; }
.chip { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; padding:1px 7px; border-radius:999px; background:#1e293b; color:#cbd5e1; }
.chip i { width:6px; height:6px; border-radius:50%; display:inline-block; }
.lb { display:grid; grid-template-columns: 24px 1fr 60px 60px 60px; gap:8px; font-size:12px; align-items:center; padding:5px 8px; border-radius:8px; }
.lb.top { background:#fbbf2418; } .lb .bar { height:5px; border-radius:999px; background:#1e293b; overflow:hidden; } .lb .bar > div { height:100%; }
.prog { height:6px; border-radius:999px; background:#1e293b; overflow:hidden; } .prog > div { height:100%; border-radius:999px; background:linear-gradient(90deg,#fbbf24,#f97316); transition: width .4s ease; }
.skel { background:linear-gradient(90deg,#0f172a 25%,#1e293b 50%,#0f172a 75%); background-size:200% 100%; animation: sk 1.4s infinite; border-radius:6px; } @keyframes sk { 0% { background-position:200% 0 } 100% { background-position:-200% 0 } }
.tab { font-size:12px; padding:6px 12px; border-radius:10px; border:1px solid #1e293b; background:#0f172a; color:#94a3b8; cursor:pointer; } .tab.on { background:#fbbf24; color:#000; border-color:#fbbf24; font-weight:700; }
.fade-in { animation: fi .35s ease; } @keyframes fi { from { opacity:0; transform: translateY(4px) } to { opacity:1; transform:none } }
</style>
</head>
<body class="text-slate-200">
<header class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-300 to-orange-500 grid place-items-center text-black text-sm"><i class="fas fa-trophy"></i></span>
      <span>战绩榜<span class="text-amber-400">优质策略</span>推荐选号 <span class="text-xs font-normal text-slate-500 ml-1">滚动前三 · 各 500 注 + 融合 500 注</span></span>
    </div>
    <nav class="flex items-center gap-2 text-xs">
      <select id="source-sel" class="bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-700"></select>
      ${atlasEntry}
      <a href="/ai" class="bg-pink-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-brain mr-1"></i>AI 推荐</a>
      <a href="/arena" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-ranking-star mr-1 text-emerald-400"></i>竞技场</a>
      <a href="/" class="bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>游戏</a>
    </nav>
  </div>
</header>

<main class="max-w-5xl mx-auto px-4 py-5 space-y-4">
  <div id="stale-bar" class="hidden bg-rose-600/20 border border-rose-500/50 text-rose-200 text-sm rounded-xl px-4 py-2"></div>
  <section id="loader" class="hero p-5">
    <div class="flex items-center justify-between text-sm mb-2"><span id="ld-text"><i class="fas fa-trophy text-amber-400 mr-2"></i>正在读取战绩榜…</span><span id="ld-pct" class="mono text-slate-400">0%</span></div>
    <div class="prog" id="ld-bar"><div style="width:0%"></div></div>
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
      </div>
    </div>

    <!-- 前三成员 -->
    <div class="grid md:grid-cols-3 gap-3 mt-4" id="members"></div>

    <!-- 选择要复制哪一份 -->
    <div class="flex flex-wrap items-center gap-2 mt-4" id="tabs"></div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <button id="copy-btn" class="bg-amber-400 hover:bg-amber-300 text-black font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-40"><i class="fas fa-copy mr-2"></i>一键复制 500 注</button>
      <select id="fmt" class="bg-slate-800 rounded-lg px-2 py-2 border border-slate-700 text-xs"><option value="space">空格分隔</option><option value="comma">逗号分隔</option><option value="line">每行一个</option></select>
      <span id="copied" class="hidden text-emerald-400 text-sm"><i class="fas fa-check mr-1"></i>已复制到剪贴板</span>
      <span class="ml-auto text-xs text-slate-500" id="cur-meta"></span>
    </div>
    <textarea id="cur-text" class="nums mt-3" readonly spellcheck="false"></textarea>
    <div class="text-[11px] text-slate-500 mt-2" id="legend"></div>
    <div class="grid500 mt-2" id="cur-grid"></div>
  </section>

  <!-- 战绩 -->
  <section id="stats" class="grid grid-cols-2 md:grid-cols-4 gap-3 hidden"></section>

  <!-- 排行说明 -->
  <section id="lb-sec" class="card p-4 hidden">
    <div class="flex items-center justify-between mb-2"><h2 class="font-bold text-sm"><i class="fas fa-ranking-star mr-2 text-amber-400"></i>为什么是这三个 <span class="text-xs text-slate-500 font-normal">本期之前滚动 40 期 z 分数排名（与竞技场同口径，前三入选）</span></h2></div>
    <div id="lb"></div>
  </section>

  <!-- 逐期历史 -->
  <section id="hist-sec" class="hidden">
    <div class="flex items-center justify-between mb-2"><h2 class="font-bold text-sm"><i class="fas fa-clock-rotate-left mr-2 text-cyan-400"></i>融合策略逐期战绩 <span class="text-xs text-slate-500 font-normal">点击展开该期 500 注与当期三位成员各自命中情况</span></h2><select id="hist-n" class="bg-slate-800 rounded-lg px-2 py-1 border border-slate-700 text-xs"><option value="12">最近 12 期</option><option value="30">最近 30 期</option><option value="60">最近 60 期</option></select></div>
    <div id="hist" class="space-y-2"></div>
  </section>
  <p class="text-[11px] text-slate-600 leading-relaxed" id="foot">哈希开奖逐期独立，任何三位号理论概率恒为 1/1000；500 注理论命中率 50%，按 950× 赔率保本需 52.6%。「前三名」以目标期之前的滚动战绩排定（实验性滚动筛选），融合结果与所有策略同规则结算，由真实开奖逐期检验，不构成任何收益承诺。</p>
</main>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/top3.js"></script>
</body>
</html>`
