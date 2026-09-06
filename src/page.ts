import { atlasEntry } from './atlas-entry'
export const page = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%23f59e0b%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 text-anchor=%27middle%27 font-family=%27monospace%27 font-weight=%27bold%27%3E%23%3C/text%3E%3C/svg%3E">
<title>HashPlay · 链上哈希公平游戏演示</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
</head>
<body class="bg-[#0b0f1a] text-slate-200 min-h-screen">

<header id="site-header" class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 grid place-items-center text-black"><i class="fas fa-cube"></i></span>
      <span>Hash<span class="text-amber-400">Play</span></span>
      <span class="hidden sm:inline text-xs font-normal text-slate-500 ml-2 border border-slate-700 rounded px-2 py-0.5">虚拟积分 · 可验证公平演示</span>
    </div>
    <nav id="room-tabs" class="flex gap-1 bg-slate-900 rounded-lg p-1">
      <button data-room="tron" class="room-tab active"><i class="fas fa-link mr-1"></i>TRON 区块厅</button>
      <button data-room="seed" class="room-tab"><i class="fas fa-key mr-1"></i>种子承诺厅</button>
      <button data-room="five" class="room-tab"><i class="fas fa-hashtag mr-1"></i>五位数厅</button>
    </nav>
    ${atlasEntry}
      <a href="/analysis" class="hidden md:inline-flex items-center text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg"><i class="fas fa-chart-line mr-1"></i>量化分析</a>
    <a href="/arena" class="hidden md:inline-flex items-center text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg"><i class="fas fa-trophy mr-1"></i>策略竞技场</a>
    <a href="/ai" class="inline-flex items-center text-xs bg-pink-500 hover:bg-pink-400 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-brain mr-1"></i>AI 推荐</a>
    <a href="/top3" class="hidden md:inline-flex items-center text-xs bg-amber-400 hover:bg-amber-300 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-trophy mr-1"></i>优质策略</a>
    <div id="user-box" class="flex items-center gap-3 text-sm">
      <div class="text-right leading-tight">
        <div id="user-nick" class="text-slate-400 text-xs">连接中…</div>
        <div class="font-mono font-bold text-amber-400"><i class="fas fa-coins mr-1"></i><span id="user-balance">—</span></div>
      </div>
      <button id="relief-btn" class="hidden text-xs bg-emerald-600 hover:bg-emerald-500 px-2 py-1 rounded">领救济金</button>
      <button id="menu-btn" class="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700"><i class="fas fa-user"></i></button>
    </div>
  </div>
</header>

<main class="max-w-7xl mx-auto px-4 py-5 grid lg:grid-cols-3 gap-5">

  <!-- 左：开奖 & 下注 -->
  <section class="lg:col-span-2 space-y-5">
    <article id="round-card" class="card">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div class="text-xs text-slate-400"><span id="room-name">TRON 区块厅</span> · 第 <span id="round-no" class="font-mono text-slate-200">—</span> 局</div>
          <div id="room-desc" class="text-xs text-slate-500 mt-0.5"></div>
        </div>
        <div class="text-right">
          <div id="phase-label" class="text-xs text-slate-400">下注中</div>
          <div id="countdown" class="font-mono text-4xl font-bold tabular-nums text-emerald-400">--</div>
        </div>
      </div>
      <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-4"><div id="progress" class="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style="width:0%"></div></div>

      <div id="commit-box" class="hidden text-xs bg-slate-900 rounded-lg p-2 mb-3 font-mono break-all border border-slate-800">
        <span class="text-slate-500">本局承诺值 sha256(seed) = </span><span id="commit-val" class="text-cyan-300"></span>
      </div>

      <!-- 上一局结果 -->
      <div id="last-result" class="bg-slate-900/70 rounded-xl p-4 border border-slate-800">
        <div class="flex items-center justify-between mb-2 text-xs text-slate-400">
          <span>上局开奖 · 第 <span id="last-no" class="font-mono">—</span> 局 <span id="last-block" class="ml-2"></span></span>
          <button id="verify-last" class="text-amber-400 hover:underline"><i class="fas fa-shield-halved mr-1"></i>验证公平</button>
        </div>
        <div id="last-hash" class="font-mono text-xs sm:text-sm break-all text-slate-300 leading-relaxed">等待开奖…</div>
        <div id="last-badges" class="flex flex-wrap gap-2 mt-3"></div>
      </div>
    </article>

    <!-- 下注面板 -->
    <article id="bet-panel" class="card">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold"><i class="fas fa-dice mr-2 text-amber-400"></i>下注面板</h2>
        <div id="chip-row" class="flex gap-1.5">
          <button class="chip" data-v="10">10</button>
          <button class="chip" data-v="50">50</button>
          <button class="chip active" data-v="100">100</button>
          <button class="chip" data-v="500">500</button>
          <button class="chip" data-v="1000">1K</button>
          <button class="chip" data-v="5000">5K</button>
        </div>
      </div>
      <div id="bet-grid-five" class="hidden space-y-3">
        <div id="rec-strip" class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2"><span class="font-bold text-amber-300"><i class="fas fa-bullseye mr-1"></i>本期推荐（20 机制集成 · 本厅历史）</span><span class="flex items-center gap-2"><span id="rec-src" class="text-slate-500"></span><a href="/analysis?source=local:five" class="text-cyan-400 hover:underline">完整 K 线 & 策略 →</a></span></div>
          <div id="rec-chips" class="flex flex-wrap gap-1.5"><span class="text-slate-500">计算中…</span></div>
          <div id="rec-lucky" class="mt-2 flex flex-wrap items-center gap-1.5"></div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="bet-group"><div class="bet-group-title">总和 大小（≥23 大）</div>
            <button class="bet-btn red" data-t="sum" data-s="big">大 <em>1.95</em></button><button class="bet-btn blue" data-t="sum" data-s="small">小 <em>1.95</em></button></div>
          <div class="bet-group"><div class="bet-group-title">总和 单双</div>
            <button class="bet-btn red" data-t="sum" data-s="odd">单 <em>1.95</em></button><button class="bet-btn blue" data-t="sum" data-s="even">双 <em>1.95</em></button></div>
          <div class="bet-group"><div class="bet-group-title">龙虎（万 vs 个）</div>
            <button class="bet-btn red" data-t="dragon" data-s="dragon">龙 <em>1.95</em></button><button class="bet-btn blue" data-t="dragon" data-s="tiger">虎 <em>1.95</em></button><button class="bet-btn green" data-t="dragon" data-s="tie">和 <em>8.5</em></button></div>
          <div class="bet-group"><div class="bet-group-title">前三形态</div>
            <button class="bet-btn" data-t="shape" data-s="leopard">豹子 <em>70</em></button><button class="bet-btn" data-t="shape" data-s="straight">顺子 <em>15</em></button><button class="bet-btn" data-t="shape" data-s="pair">对子 <em>3.3</em></button><button class="bet-btn" data-t="shape" data-s="mixed">杂六 <em>1.35</em></button></div>
        </div>
        <div class="bet-group"><div class="bet-group-title">定位两面 ×1.95</div><div id="pos2-grid" class="grid grid-cols-5 gap-2"></div></div>
        <div class="bet-group"><div class="bet-group-title">定位胆 ×9.5 · 先选位置再选数字</div>
          <div id="pos-tabs" class="flex gap-1 mb-2"></div><div id="pos-grid" class="grid grid-cols-5 sm:grid-cols-10 gap-2"></div></div>
      </div>
      <div id="bet-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bet-group col-span-2 md:col-span-1"><div class="bet-group-title">单双</div>
          <button class="bet-btn" data-t="parity" data-s="odd">单 <em>1.95</em></button>
          <button class="bet-btn" data-t="parity" data-s="even">双 <em>1.95</em></button></div>
        <div class="bet-group col-span-2 md:col-span-1"><div class="bet-group-title">大小</div>
          <button class="bet-btn" data-t="size" data-s="big">大 5-9 <em>1.95</em></button>
          <button class="bet-btn" data-t="size" data-s="small">小 0-4 <em>1.95</em></button></div>
        <div class="bet-group col-span-2 md:col-span-1"><div class="bet-group-title">庄闲（倒2位 vs 末位）</div>
          <button class="bet-btn red" data-t="bp" data-s="banker">庄 <em>1.95</em></button>
          <button class="bet-btn blue" data-t="bp" data-s="player">闲 <em>1.95</em></button>
          <button class="bet-btn green" data-t="bp" data-s="tie">和 <em>8.5</em></button></div>
        <div class="bet-group col-span-2 md:col-span-1"><div class="bet-group-title">末位字符</div>
          <button class="bet-btn" data-t="chartype" data-s="digit">数字 <em>1.55</em></button>
          <button class="bet-btn" data-t="chartype" data-s="letter">字母 a-f <em>2.55</em></button></div>
        <div class="bet-group col-span-2 md:col-span-4"><div class="bet-group-title">幸运数字（末位数字精准命中 ×9.5）</div>
          <div class="grid grid-cols-5 sm:grid-cols-10 gap-2" id="lucky-row"></div></div>
      </div>
      <div id="my-bets" class="mt-4 text-xs text-slate-400 flex flex-wrap gap-2"></div>
    </article>
  </section>

  <!-- 右：走势 & 历史 -->
  <aside class="space-y-5">
    <article class="card">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold text-sm"><i class="fas fa-chart-simple mr-2 text-cyan-400"></i>路单走势（近 60 局）</h2>
        <select id="trend-type" class="bg-slate-800 text-xs rounded px-2 py-1 border border-slate-700">
          <option value="parity">单双</option><option value="size">大小</option><option value="bp">庄闲</option><option value="chartype">字符</option>
          <option value="sumSize" class="five-only">总和大小</option><option value="sumParity" class="five-only">总和单双</option><option value="dragon" class="five-only">龙虎</option>
        </select>
      </div>
      <div id="trend-grid" class="trend-grid"></div>
      <div id="stats-bar" class="mt-3 space-y-1.5 text-xs"></div>
    </article>

    <article class="card">
      <h2 class="font-bold text-sm mb-3"><i class="fas fa-clock-rotate-left mr-2 text-violet-400"></i>开奖历史</h2>
      <div id="history-list" class="space-y-1.5 max-h-[420px] overflow-y-auto pr-1 text-xs"></div>
    </article>

    <article class="card">
      <h2 class="font-bold text-sm mb-3"><i class="fas fa-trophy mr-2 text-amber-400"></i>积分榜</h2>
      <div id="leaderboard" class="text-xs space-y-1"></div>
    </article>
  </aside>
</main>

<!-- 官方逐期统计结果（严格按 api.qkltj.com/api/draw-result 字段） -->
<section id="qkltj-table-section" class="max-w-7xl mx-auto px-4 pb-5">
  <article class="card">
    <div id="sync-bar" class="mb-3"></div>
    <header class="flex flex-wrap items-center gap-3 mb-3">
      <h2 class="font-bold text-lg"><i class="fas fa-table-list text-amber-400 mr-2"></i>统计结果 <span id="qk-name" class="text-slate-400 text-sm font-normal ml-1">哈希分分彩</span></h2>
      <nav id="qk-tabs" class="flex gap-1 text-xs">
        <button data-code="6001" class="qk-tab active">分分彩</button>
        <button data-code="6002" class="qk-tab">三分彩</button>
        <button data-code="6003" class="qk-tab">五分彩</button>
        <button data-code="6004" class="qk-tab">十分彩</button>
        <button data-code="7001" class="qk-tab">ETH 分分彩</button>
      </nav>
      <select id="qk-limit" class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
        <option value="20">20 期</option><option value="30" selected>30 期</option><option value="50">50 期</option><option value="100">100 期</option>
      </select>
      <span id="qk-status" class="text-xs text-slate-500 ml-auto"><i class="fas fa-satellite-dish mr-1"></i>数据源 api.qkltj.com · 按开奖节拍实时同步</span>
      <a id="qk-raw" href="/api/qkltj/raw?code=6001&rows=1" target="_blank" class="text-xs text-sky-400 hover:underline"><i class="fas fa-code mr-1"></i>接口原文核对</a>
    </header>
    <div class="overflow-x-auto">
      <table id="qk-table" class="w-full text-sm qk-table">
        <thead>
          <tr class="text-slate-300">
            <th class="text-left">统计时间</th><th class="text-left">奖期</th><th class="text-left">区块 (Block)</th><th class="text-left">区块哈希值</th><th class="text-right">运算结果</th>
          </tr>
        </thead>
        <tbody id="qk-body"><tr><td colspan="5" class="text-center text-slate-500 py-6"><i class="fas fa-spinner fa-spin mr-1"></i>加载中…</td></tr></tbody>
      </table>
    </div>
    <!-- 口径说明 + 本地对账 -->
    <div class="grid md:grid-cols-2 gap-3 mt-4">
      <div id="qk-rule" class="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs leading-relaxed">
        <h3 class="font-bold text-slate-200 mb-1"><i class="fas fa-link text-sky-400 mr-1"></i>「统计时间 ↔ 区块」对应口径（链上逐期验证）</h3>
        <ul class="list-disc pl-4 space-y-0.5 text-slate-400">
          <li><b class="text-slate-200">取块规则</b>：哈希分分彩固定取每分钟 <b class="text-amber-300">03 秒</b> 的 TRON 区块（03 秒无块则取下一个）；三分/五分/十分彩同理取对应分钟 03 秒；ETH 分分彩取每分钟 11 秒的区块。</li>
          <li><b class="text-slate-200">奖期 expect</b> = <code>YYYYMMDD</code> + 当日分钟序号（UTC+8，4 位）。例：<code>…0670</code> = 11:10 这一分钟。</li>
          <li><b class="text-slate-200">区块 block</b>：该分钟 03 秒出块的区块号；相邻两期区块号恒差 20（TRON 3s/块）。<b class="text-slate-200">hash</b> = 该区块 blockID（Tronscan 可查）。</li>
          <li><b class="text-slate-200">统计时间 openTime</b> = 官方系统抓到区块并入库的时间，恒为区块时间 <b class="text-amber-300">+10~12 秒</b>（如区块 11:10:03 → 统计 11:10:14），<u>不是</u>区块本身的时间。</li>
          <li><b class="text-slate-200">运算结果</b> = 区块哈希去掉 a–f 后从左到右的最后 5 位数字（红色高亮）。本站五位厅已按同一口径取块，可逐期对账 →</li>
        </ul>
      </div>
      <div id="qk-recon" class="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs">
        <h3 class="font-bold text-slate-200 mb-2 flex items-center gap-2"><i class="fas fa-scale-balanced text-emerald-400 mr-1"></i>本站五位厅 vs 官方 6001 逐期对账 <span id="qk-recon-sum" class="ml-auto font-mono text-slate-400">…</span></h3>
        <div class="overflow-x-auto"><table class="w-full qk-table text-[11px]">
          <thead><tr class="text-slate-400"><th class="text-left">奖期</th><th class="text-left">官方区块 / 结果</th><th class="text-left">本站区块 / 结果</th><th class="text-right">状态</th></tr></thead>
          <tbody id="qk-recon-body"><tr><td colspan="4" class="text-center text-slate-500 py-3">加载中…</td></tr></tbody>
        </table></div>
      </div>
    </div>
    <p class="text-[11px] text-slate-500 mt-2"><i class="fas fa-circle-info mr-1"></i>运算结果 = 接口 <code>opennumber</code> 原值；哈希中<span class="text-red-400 font-bold">红色</span>为官方取用的最后 5 个数字字符（去除 a-f 后倒数 5 位）。若官方值与本地推算不一致会以 <i class="fas fa-triangle-exclamation text-amber-400"></i> 标注。</p>
  </article>
</section>

<footer class="max-w-7xl mx-auto px-4 pb-8 text-xs text-slate-500 leading-relaxed">
  <div class="border-t border-slate-800 pt-4">
    <p><i class="fas fa-circle-info mr-1"></i><b>免责声明</b>：本站为「链上哈希随机数 + 可验证公平机制」的技术演示，所有积分均为虚拟数值，不可充值、不可提现、不具有任何货币价值。开奖哈希来自 TRON 公链公开区块或服务端承诺种子，任何人均可离线复算校验。哈希函数（SHA-256）的输出不可预测，历史走势对未来结果没有任何预测意义。</p>
  </div>
</footer>

<!-- 验证弹窗 -->
<div id="verify-modal" class="fixed inset-0 z-50 hidden bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
  <div class="max-w-3xl mx-auto my-8 card">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-lg"><i class="fas fa-shield-halved text-emerald-400 mr-2"></i>可验证公平 · 第 <span id="v-no"></span> 局</h3>
      <button id="verify-close" class="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700"><i class="fas fa-xmark"></i></button>
    </div>
    <div id="verify-body" class="space-y-3 text-sm"></div>
  </div>
</div>

<!-- 个人中心 -->
<div id="me-modal" class="fixed inset-0 z-50 hidden bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
  <div class="max-w-2xl mx-auto my-8 card">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-bold text-lg"><i class="fas fa-user mr-2 text-amber-400"></i>我的记录</h3>
      <button id="me-close" class="w-8 h-8 rounded bg-slate-800 hover:bg-slate-700"><i class="fas fa-xmark"></i></button>
    </div>
    <div id="me-stats" class="grid grid-cols-4 gap-2 text-center text-xs mb-4"></div>
    <div id="me-bets" class="text-xs space-y-1 max-h-[50vh] overflow-y-auto"></div>
    <button id="reset-account" class="mt-4 text-xs text-slate-500 hover:text-red-400">重置为新账户</button>
  </div>
</div>

<div id="toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 hidden px-4 py-2 rounded-lg text-sm shadow-xl"></div>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/sync.js"></script>
<script src="/static/app.js"></script>
</body>
</html>`
