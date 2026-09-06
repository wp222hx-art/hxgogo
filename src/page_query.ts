import { atlasEntry } from './atlas-entry'
/** /query —— 简易逐期命中查询页：按期号 / 日期 / 最近 N 期查 AI 各档位命中情况；顶部显示后台运行状态 */
export const queryPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 逐期命中查询</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2322d3ee%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2718%27 text-anchor=%27middle%27%3E%F0%9F%94%8D%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<style>
body { background:#0b0f1a; color:#e2e8f0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card { background:#0f172a; border:1px solid #1e293b; border-radius:14px; }
.f { width:100%; background:#0b1220; border:1px solid #1e293b; border-radius:10px; padding:9px 12px; font-size:14px; color:#e2e8f0; } .f:focus { outline:none; border-color:#22d3ee; }
.btn { padding:9px 16px; border-radius:10px; font-weight:700; font-size:14px; white-space:nowrap; }
.qk { font-size:12px; padding:5px 11px; border-radius:8px; background:#0b1220; border:1px solid #1e293b; color:#94a3b8; } .qk:hover { color:#fff; } .qk.on { background:#0e7490; border-color:#22d3ee; color:#fff; }
.dot { width:9px; height:9px; border-radius:50%; display:inline-block; } .dot.ok { background:#22c55e; box-shadow:0 0 0 4px #22c55e33; animation:pulse 1.6s infinite; } .dot.bad { background:#f43f5e; }
@keyframes pulse { 0%,100% { box-shadow:0 0 0 3px #22c55e22 } 50% { box-shadow:0 0 0 7px #22c55e11 } }
.sum { display:flex; flex-wrap:wrap; gap:6px; } .sum .t { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 10px; border-radius:8px; background:#0b1220; border:1px solid #1e293b; color:#94a3b8; } .sum .t b { font-family: ui-monospace, monospace; color:#e2e8f0; } .sum .t.good b.r { color:#86efac; } .sum .t.c { border-color:#7c3aed66; }
.tw { background:#0f172a; border:1px solid #1e293b; border-radius:14px; overflow:auto; max-height:72vh; }
table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; font-family: ui-monospace, Menlo, monospace; }
thead th { position:sticky; top:0; z-index:1; background:#0b1220; color:#64748b; font-weight:500; font-size:11px; padding:8px; text-align:center; border-bottom:1px solid #1e293b; white-space:nowrap; } thead th.l { text-align:left; } thead th.r { text-align:right; } thead th.c { color:#a78bfa; }
tbody tr { height:30px; } tbody tr:hover td { background:#111c33; } tbody tr.hl td { background:#164e6333; }
td { padding:3px 8px; text-align:center; white-space:nowrap; border-bottom:1px solid #0b1220; } td.l { text-align:left; } td.r { text-align:right; }
td.ex { color:#fcd34d; } td.ex small { color:#475569; margin-left:5px; font-size:10.5px; }
td.ac { font-weight:800; letter-spacing:.08em; color:#cbd5e1; } tr.hit td.ac { color:#4ade80; }
td.rk { color:#64748b; } tr.hit td.rk { color:#86efac; font-weight:700; }
td.p { color:#4ade80; } td.m { color:#fb7185; }
.cell { display:inline-block; width:22px; height:16px; border-radius:4px; background:#1e293b; vertical-align:middle; } .cell.h { background:#22c55e; } .cell.c { box-shadow: inset 0 0 0 1px #7c3aed88; } .cell.s { box-shadow: inset 0 0 0 1px #eab30888; } .cell.na { background:transparent; border:1px dashed #1e293b; }
.big { font-size:34px; font-weight:900; font-family: ui-monospace, monospace; letter-spacing:.1em; }
@media (max-width:640px) { td.tm, th.tm { display:none; } }
</style>
</head>
<body class="min-h-screen">
<header class="border-b border-slate-800/70 bg-[#0b0f1a]/90 backdrop-blur sticky top-0 z-20">
  <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <h1 class="font-black text-lg"><i class="fas fa-magnifying-glass mr-2 text-cyan-400"></i>逐期命中查询</h1>
      <select id="source" class="bg-slate-800 rounded-lg px-2 py-1 border border-slate-700 text-xs"></select>
    </div>
    <div class="flex items-center gap-3 text-xs">
      <span id="bg-pill" class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800"><span class="dot" id="bg-dot"></span><span id="bg-text" class="text-slate-400">后台状态…</span></span>
      <nav class="hidden md:flex gap-3 text-slate-400">${atlasEntry}
      <a href="/ai" class="hover:text-white">AI 推荐</a><a href="/top3" class="hover:text-white">优质策略</a><a href="/arena" class="hover:text-white">战绩榜</a><a href="/settings" class="hover:text-white">设置</a></nav>
    </div>
  </div>
</header>

<main class="max-w-6xl mx-auto px-4 py-5 space-y-4">
  <!-- 后台运行详情 -->
  <section class="card p-4" id="bg-sec">
    <div class="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
      <div><div class="text-slate-500">服务端心跳</div><div id="k-hb" class="mono text-slate-200 mt-0.5">—</div></div>
      <div><div class="text-slate-500">守护进程（Keeper）</div><div id="k-keeper" class="mono text-slate-200 mt-0.5">—</div></div>
      <div><div class="text-slate-500">最近一次 AI 推理</div><div id="k-last" class="mono text-slate-200 mt-0.5">—</div></div>
      <div><div class="text-slate-500">24h 推理次数</div><div id="k-24h" class="mono text-slate-200 mt-0.5">—</div></div>
      <div><div class="text-slate-500">累计已结算 / 命中</div><div id="k-scored" class="mono text-slate-200 mt-0.5">—</div></div>
    </div>
    <p class="text-[11px] text-slate-600 mt-2">后台链路：拉取开奖 → 结算所有策略 → AI 推理下一期（带各档位战绩反馈）→ 记录 → 每 5 分钟漏期链上补齐。<b class="text-slate-500">与网页是否打开无关</b>，本地应用由后台进程持续协调。</p>
  </section>

  <!-- 查询 -->
  <section class="card p-4">
    <div class="flex flex-col md:flex-row gap-3 md:items-end">
      <div class="flex-1">
        <label class="text-xs text-slate-500">完整期号（随数据源为 11 或 12 位）或当日序号</label>
        <input id="q-expect" class="f mono mt-1" placeholder="202609060146 或 0146" inputmode="numeric">
      </div>
      <div class="md:w-52">
        <label class="text-xs text-slate-500">日期（北京）</label>
        <input id="q-date" type="date" class="f mono mt-1">
      </div>
      <button id="q-go" class="btn bg-cyan-500 hover:bg-cyan-400 text-black"><i class="fas fa-search mr-1"></i>查询</button>
    </div>
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <span class="text-xs text-slate-500 mr-1">快捷：</span>
      <button class="qk" data-n="50">最近 50 期</button><button class="qk" data-n="100">最近 100 期</button><button class="qk" data-n="300">最近 300 期</button><button class="qk" data-n="1000">最近 1000 期</button>
      <button class="qk" data-hit="1"><i class="fas fa-filter mr-1"></i>只看命中</button>
      <span class="text-xs text-slate-600 ml-auto" id="q-msg"></span>
    </div>
  </section>

  <!-- 5 组独立生成 · 组别命中对比 -->
  <section class="card p-4" id="sets-sec">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 class="font-bold text-sm"><i class="fas fa-layer-group mr-2 text-violet-400"></i>AI 5 组独立生成 · 固定窗口历史对照 <span class="text-xs text-slate-500 font-normal" id="sets-n"></span></h2>
      <div class="flex items-center gap-1 text-xs"><span class="text-slate-500 mr-1">近期窗口</span><div class="flex gap-1" id="sets-k"><button class="qk" data-k="30">30</button><button class="qk on" data-k="60">60</button><button class="qk" data-k="150">150</button></div></div>
    </div>
    <p class="text-[11px] text-slate-500 mb-2"><span style="color:#f472b6">A 融合</span> AI 定位×量化 · <span style="color:#a78bfa">B 定位</span> 纯 AI 三位权重 · <span style="color:#22d3ee">C 量化</span> z&gt;0 量化共识 · <span style="color:#fbbf24">D 聚焦</span> 核心号优先 · <span style="color:#34d399">E 互补</span> 与 A 零重叠。每组独立结算；<i class="fas fa-crown text-amber-300"></i> 历史 z 最高 · <i class="fas fa-fire text-orange-400"></i> 近期 z 最高。</p>
    <div class="tw" style="max-height:none"><table id="sets-tbl"><thead><tr id="sets-head"></tr></thead><tbody id="sets-body"><tr><td colspan="6" class="py-4 text-slate-500">加载中…</td></tr></tbody></table></div>
  </section>

  <!-- 档位分析：下一期命中概率 / 长龙 / 进坑 / 倍投 -->
  <section class="card p-4" id="ta-sec">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="font-bold text-sm"><i class="fas fa-chart-pie mr-2 text-amber-400"></i>档位检验 · 理论基线 / 连挂频率 / 风险模拟 / 每 <span id="ta-round">10</span> 期倍投</h2>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-500">历史模拟自评分阈值</span>
        <div class="flex gap-1" id="ta-conf"><button class="qk" data-c="0">不看</button><button class="qk" data-c="0.5">≥50%</button><button class="qk on" data-c="0.6">≥60%</button><button class="qk" data-c="0.7">≥70%</button></div>
        <span class="text-slate-500 ml-2">每轮</span>
        <div class="flex gap-1" id="ta-rnd"><button class="qk on" data-r="10">10 期</button><button class="qk" data-r="20">20 期</button></div>
      </div>
    </div>
    <div id="ta-next" class="text-xs text-slate-400 mb-3"></div>
    <div id="ta-cards" class="grid md:grid-cols-2 2xl:grid-cols-3 gap-3"><div class="text-slate-500 text-sm">加载中…</div></div>
    <p class="text-[11px] text-slate-600 mt-3 leading-relaxed">
      <b class="text-slate-500">理论基线</b>：在独立、均匀假设下为 N/1000。全量、近100、近30和连挂后的命中率只描述历史，不能直接当作下一期概率。区间未校正多策略筛选或重复查看。
      <b class="text-slate-500">长龙存活率</b>：已挂 L 期后继续挂的实测概率 vs 理论 q。<b class="text-slate-500">连续进坑</b>：从现在起再连挂 k 期的概率；以及一轮内至少出现一次 ≥4 连挂的概率（马氏链精确解）。
      <b class="text-slate-500">倍投</b>：每轮独立、轮末清零。「命中后翻倍」= 历史本期中且下一条 AI 自评分达阈值 → 下期 ×2（连中继续翻，最高 ×8），未中回 1；「挂后加码」= 1-2-4 三级马丁；均与平注对比。仅供风险模拟；AI 自评分未校准，不作为当前加码依据。
    </p>
  </section>

  <!-- 连挂风险 -->
  <section class="card p-4" id="streak-sec">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="font-bold text-sm"><i class="fas fa-wave-square mr-2 text-rose-400"></i>连挂风险 · 各投注档位连续 <span id="sk-k" class="mono text-rose-300">4</span> 期及以上不命中的概率</h2>
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-500">连挂阈值</span>
        <div class="flex gap-1" id="sk-kbtns"><button class="qk" data-k="3">≥3</button><button class="qk on" data-k="4">≥4</button><button class="qk" data-k="5">≥5</button><button class="qk" data-k="6">≥6</button></div>
        <span class="text-slate-500 ml-2">样本</span>
        <div class="flex gap-1" id="sk-nbtns"><button class="qk" data-n="200">近 200</button><button class="qk" data-n="500">近 500</button><button class="qk on" data-n="0">全部</button></div>
      </div>
    </div>
    <div class="tw" style="max-height:none"><table id="sk-tbl"><thead><tr>
      <th class="l">档位</th><th>单期不中</th><th title="任取连续 K 期全部不中的概率 = q^K">理论·任意 K 连挂</th><th title="一段连挂一旦开始，延续到 ≥K 期的概率 = q^(K-1)">理论·段达 K</th>
      <th title="实测：所有连挂段中长度 ≥K 的比例">实测·段达 K</th><th title="实测：处于 ≥K 连挂之中的期数占比">实测·期占比</th><th title="每 100 期出现 ≥K 连挂段的次数（理论 vs 实测）">每 100 期次数</th><th>最长</th><th>当前</th><th class="l">连挂长度分布 1·2·3·4·5·6+</th>
    </tr></thead><tbody id="sk-body"><tr><td colspan="10" class="py-4 text-slate-500">加载中…</td></tr></tbody></table></div>
    <p class="text-[11px] text-slate-600 mt-2 leading-relaxed" id="sk-note">理论值基于逐期独立、每注 1/1000：单期不中 q = 1 − N/1000。<b class="text-slate-500">「任意 K 连挂」</b>= 随便挑连续 K 期全挂的概率 q<sup>K</sup>；<b class="text-slate-500">「段达 K」</b>= 已经挂了 1 期后继续挂到 ≥K 期的概率 q<sup>K−1</sup>（对应"我刚挂一期，接下来会不会连挂到 4"）。实测列用真实开奖切分连挂段统计，<span class="text-emerald-400">绿</span> = 实测优于理论（更少连挂），<span class="text-rose-400">红</span> = 差于理论。</p>
  </section>

  <!-- 单期结果卡 -->
  <section class="card p-5 hidden" id="one">
    <div class="flex flex-wrap items-center gap-5">
      <div><div class="text-xs text-slate-500">期号</div><div class="mono text-amber-300 text-xl font-bold" id="o-expect">—</div><div class="text-xs text-slate-500" id="o-time"></div></div>
      <div><div class="text-xs text-slate-500">开奖号码</div><div class="big" id="o-actual">—</div></div>
      <div><div class="text-xs text-slate-500">AI 500 注</div><div id="o-res" class="text-lg font-bold mt-1">—</div></div>
      <div class="flex-1 min-w-[240px]"><div class="text-xs text-slate-500 mb-1">各档位命中</div><div id="o-tiers" class="flex flex-wrap gap-2"></div></div>
    </div>
    <div class="text-xs text-slate-400 mt-3" id="o-regime"></div>
    <div class="mt-3 flex items-center gap-3 text-xs"><button id="o-show" class="qk"><i class="fas fa-th mr-1"></i>显示该期 500 注</button><span id="o-copy-wrap"></span></div>
    <div id="o-grid" class="hidden mt-3" style="display:none"></div>
  </section>

  <!-- 列表 -->
  <section>
    <div id="sum" class="sum mb-2"></div>
    <div class="tw"><table><thead><tr id="thead"></tr></thead><tbody id="tbody"><tr><td class="py-6 text-slate-500" colspan="9">输入条件或点击快捷按钮开始查询</td></tr></tbody></table></div>
    <div id="foot" class="text-[11px] text-slate-500 mt-1"></div>
  </section>
  <p class="text-[11px] text-slate-600">哈希开奖逐期独立，任何三位号理论概率恒为 1/1000。此页仅供查询已发生的真实开奖与 AI 推荐的命中记录，不构成任何收益承诺。</p>
</main>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/query.js"></script>
</body>
</html>`
