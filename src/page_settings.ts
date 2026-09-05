export const settingsPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HashPlay · 配置中心 · AI 供应商</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%2338bdf8%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2718%27 text-anchor=%27middle%27%3E%E2%9A%99%3C/text%3E%3C/svg%3E">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<style>
body { background:#0b0f1a; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card { background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:18px; }
.card.active { border-color:#38bdf8aa; box-shadow:0 0 0 1px #38bdf822 inset; }
label.f { display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; }
input.f, select.f { width:100%; background:#0b1220; border:1px solid #1e293b; border-radius:10px; padding:9px 12px; font-size:13px; color:#e2e8f0; }
input.f:focus, select.f:focus { outline:none; border-color:#38bdf8; }
input.f.mono { font-family: ui-monospace, monospace; letter-spacing:.3px; }
.src { font-size:10px; padding:1px 6px; border-radius:999px; margin-left:6px; vertical-align:middle; }
.src.db { background:#38bdf8; color:#000; } .src.env { background:#334155; color:#cbd5e1; } .src.none { background:#1e293b; color:#64748b; }
.btn { border-radius:10px; padding:9px 16px; font-size:13px; font-weight:700; } .btn:disabled { opacity:.45; cursor:not-allowed; }
.res { background:#0b1220; border:1px solid #1e293b; border-radius:12px; padding:12px 14px; font-size:12.5px; line-height:1.7; }
.res.ok { border-color:#22c55e88; } .res.bad { border-color:#ef444488; }
.kv { display:grid; grid-template-columns: 110px 1fr; gap:2px 10px; } .kv b { color:#94a3b8; font-weight:500; }
.pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; padding:4px 10px; border-radius:999px; background:#1e293b; }
.prov { cursor:pointer; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; display:flex; gap:10px; align-items:center; }
.prov.sel { border-color:#38bdf8; background:#0b1220; }
.mc { display:grid; grid-template-columns: 1fr auto; gap:2px 10px; border:1px solid #1e293b; border-radius:10px; padding:8px 10px; cursor:pointer; background:#0b1220; }
.mc.sel { border-color:#38bdf8; box-shadow:0 0 0 1px #38bdf844 inset; } .mc .id { font-family: ui-monospace, monospace; font-weight:700; font-size:13px; } .mc .tag { font-size:10px; padding:1px 6px; border-radius:999px; background:#1e293b; color:#cbd5e1; align-self:start; }
.mc .tag.rec { background:#22c55e; color:#000; } .mc .tag.top { background:#a855f7; color:#fff; } .mc .tag.exp { background:#f59e0b; color:#000; }
.mc .d { grid-column:1 / -1; font-size:11px; color:#94a3b8; } .mc .m { grid-column:1 / -1; font-size:10.5px; color:#64748b; font-family: ui-monospace, monospace; }
.tk { border:1px solid #1e293b; border-radius:8px; padding:6px 4px; background:#0b1220; display:flex; flex-direction:column; align-items:center; font-size:11px; color:#94a3b8; } .tk b { color:#e2e8f0; font-size:12px; } .tk span { font-size:10px; }
.tk.sel { border-color:#38bdf8; color:#e2e8f0; background:#0f1a2e; }
.fade-in { animation: fi .3s ease; } @keyframes fi { from { opacity:0; transform: translateY(4px) } to { opacity:1; transform:none } }
</style>
</head>
<body class="text-slate-200">
<header class="border-b border-slate-800 bg-[#0e1424]/90 backdrop-blur sticky top-0 z-40">
  <div class="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 font-bold text-lg">
      <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-cyan-600 grid place-items-center text-black text-sm"><i class="fas fa-gear"></i></span>
      <span>配置<span class="text-sky-400">中心</span> <span class="text-xs font-normal text-slate-500 ml-1">AI 供应商 · 模型 · 报单窗口</span></span>
    </div>
    <nav class="flex items-center gap-2 text-xs">
      <a href="/ai" class="bg-pink-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-brain mr-1"></i>AI 推荐</a>
      <a href="/arena" class="hidden md:inline-flex bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"><i class="fas fa-trophy mr-1 text-emerald-400"></i>竞技场</a>
      <a href="/" class="bg-amber-500 text-black font-semibold px-3 py-1.5 rounded-lg"><i class="fas fa-dice mr-1"></i>游戏</a>
    </nav>
  </div>
</header>

<main class="max-w-4xl mx-auto px-4 py-5 space-y-4">
  <!-- 当前生效 -->
  <section class="card" id="status-card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs text-slate-400">当前生效</div>
        <div class="text-xl font-black mt-0.5" id="eff-line"><span class="text-slate-500">加载中…</span></div>
        <div class="text-xs text-slate-500 mt-1" id="eff-sub"></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="pill" id="live-pill"><i class="fas fa-circle-notch fa-spin text-sky-400"></i>读取本期 AI 状态…</span>
        <button class="btn bg-slate-800 border border-slate-700 hover:bg-slate-700" id="btn-test-live"><i class="fas fa-stethoscope mr-1"></i>校验当前配置</button>
      </div>
    </div>
    <div id="live-res" class="hidden mt-3"></div>
  </section>

  <!-- 供应商 -->
  <section class="card">
    <h2 class="font-bold mb-3"><i class="fas fa-plug mr-2 text-sky-400"></i>供应商与密钥 <span class="text-xs text-slate-500 font-normal ml-2">密钥仅存服务端 D1，页面只显示打码；留空 = 沿用环境变量</span></h2>
    <div class="grid md:grid-cols-3 gap-2 mb-4" id="prov-pick">
      <div class="prov" data-v=""><i class="fas fa-wand-magic-sparkles text-slate-400"></i><div><div class="text-sm font-bold">自动</div><div class="text-[11px] text-slate-500">有 DeepSeek key 就用 DeepSeek，否则 OpenAI</div></div></div>
      <div class="prov" data-v="deepseek"><i class="fas fa-fish text-sky-400"></i><div><div class="text-sm font-bold">DeepSeek <span class="text-[10px] text-emerald-400 font-normal">推荐</span></div><div class="text-[11px] text-slate-500">deepseek-chat · 快 · 便宜</div></div></div>
      <div class="prov" data-v="openai"><i class="fas fa-robot text-slate-300"></i><div><div class="text-sm font-bold">OpenAI 兼容</div><div class="text-[11px] text-slate-500">gpt-5-mini 或任意兼容网关</div></div></div>
    </div>
    <div class="grid md:grid-cols-2 gap-4">
      <div class="card space-y-3" id="card-ds">
        <div class="font-bold text-sm text-sky-300"><i class="fas fa-fish mr-1"></i>DeepSeek</div>
        <div><label class="f">DEEPSEEK_API_KEY <span class="src" id="src-DEEPSEEK_API_KEY"></span></label><div class="flex gap-2"><input class="f mono" id="in-DEEPSEEK_API_KEY" type="password" placeholder="sk-…（留空不修改）" autocomplete="off"><button class="btn bg-slate-800 border border-slate-700 px-3 eye" data-for="in-DEEPSEEK_API_KEY"><i class="fas fa-eye"></i></button></div><div class="text-[11px] text-slate-500 mt-1" id="cur-DEEPSEEK_API_KEY"></div></div>
        <div><label class="f">DEEPSEEK_BASE_URL <span class="src" id="src-DEEPSEEK_BASE_URL"></span></label><input class="f mono" id="in-DEEPSEEK_BASE_URL" placeholder="https://api.deepseek.com"></div>
        <div>
          <label class="f">DEEPSEEK_MODEL · 模型（V4 系列，官方 2026-08 目录） <span class="src" id="src-DEEPSEEK_MODEL"></span></label>
          <div class="space-y-2" id="ds-models"></div>
          <input class="f mono mt-2" id="in-DEEPSEEK_MODEL" placeholder="或手填模型 id（留空 = deepseek-v4-flash）">
          <div class="text-[11px] text-slate-500 mt-1"><i class="fas fa-circle-info mr-1"></i>旧名 <code>deepseek-chat</code> / <code>deepseek-reasoner</code> 官方已于 2026-07-24 停用；填了也会自动映射为 v4-flash（reasoner → 思考模式 low）</div>
        </div>
        <div>
          <label class="f">DEEPSEEK_THINKING · 思考模式（推理链） <span class="src" id="src-DEEPSEEK_THINKING"></span></label>
          <div class="grid grid-cols-4 gap-1" id="ds-think">
            <button type="button" class="tk" data-v="off"><b>关闭</b><span>非思考 · 最快</span></button>
            <button type="button" class="tk" data-v="low"><b>low</b><span>轻推理</span></button>
            <button type="button" class="tk" data-v="high"><b>high</b><span>标准推理</span></button>
            <button type="button" class="tk" data-v="max"><b>max</b><span>最深 · 很慢</span></button>
          </div>
          <div class="text-[11px] text-slate-500 mt-1" id="ds-think-hint"></div>
        </div>
        <details class="text-xs"><summary class="cursor-pointer text-sky-300 select-none"><i class="fas fa-code mr-1"></i>将发送的请求（chat/completions 请求体预览）</summary>
          <pre class="mono text-[11px] bg-[#0b1220] border border-slate-800 rounded-lg p-3 mt-2 overflow-auto text-slate-300" id="ds-preview">—</pre>
          <div class="text-[11px] text-slate-500 mt-1">端点 <code id="ds-endpoint">https://api.deepseek.com/chat/completions</code> · Header <code>Authorization: Bearer &lt;key&gt;</code> · 思考模式下返回 <code>reasoning_content</code>（思维链）与 <code>content</code>（JSON 结论）分离，系统会把思维链存入 <code>ai_forecasts.cot</code></div>
        </details>
        <button class="btn bg-sky-500 hover:bg-sky-400 text-black w-full" id="btn-test-ds"><i class="fas fa-vial mr-1"></i>用上面填的内容校验 DeepSeek</button>
        <div id="res-ds" class="hidden"></div>
      </div>
      <div class="card space-y-3" id="card-oa">
        <div class="font-bold text-sm text-slate-300"><i class="fas fa-robot mr-1"></i>OpenAI 兼容</div>
        <div><label class="f">OPENAI_API_KEY <span class="src" id="src-OPENAI_API_KEY"></span></label><div class="flex gap-2"><input class="f mono" id="in-OPENAI_API_KEY" type="password" placeholder="sk-…（留空不修改）" autocomplete="off"><button class="btn bg-slate-800 border border-slate-700 px-3 eye" data-for="in-OPENAI_API_KEY"><i class="fas fa-eye"></i></button></div><div class="text-[11px] text-slate-500 mt-1" id="cur-OPENAI_API_KEY"></div></div>
        <div><label class="f">OPENAI_BASE_URL <span class="src" id="src-OPENAI_BASE_URL"></span></label><input class="f mono" id="in-OPENAI_BASE_URL" placeholder="https://api.openai.com/v1"></div>
        <div><label class="f">AI_MODEL <span class="src" id="src-AI_MODEL"></span></label><input class="f mono" id="in-AI_MODEL" placeholder="gpt-5-mini"></div>
        <div><label class="f">AI_EFFORT（推理强度，仅 OpenAI 推理模型） <span class="src" id="src-AI_EFFORT"></span></label><select class="f" id="in-AI_EFFORT"><option value="">low（默认）</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div>
        <button class="btn bg-slate-700 hover:bg-slate-600 w-full" id="btn-test-oa"><i class="fas fa-vial mr-1"></i>用上面填的内容校验 OpenAI</button>
        <div id="res-oa" class="hidden"></div>
      </div>
    </div>
  </section>

  <!-- 时间窗口 -->
  <section class="card">
    <h2 class="font-bold mb-3"><i class="fas fa-stopwatch mr-2 text-amber-400"></i>报单窗口与时限</h2>
    <div class="grid md:grid-cols-3 gap-4">
      <div><label class="f">AI_LEAD_MS · 开奖前多少毫秒必须锁定 <span class="src" id="src-AI_LEAD_MS"></span></label><input class="f mono" id="in-AI_LEAD_MS" type="number" min="5000" max="120000" step="1000" placeholder="20000"><div class="text-[11px] text-slate-500 mt-1">默认 20000 = 留 20 秒报单时间。1 分钟厅建议 15000–25000</div></div>
      <div><label class="f">AI_TIMEOUT_MS · 单次调用上限 <span class="src" id="src-AI_TIMEOUT_MS"></span></label><input class="f mono" id="in-AI_TIMEOUT_MS" type="number" min="3000" max="90000" step="1000" placeholder="25000"><div class="text-[11px] text-slate-500 mt-1">会被报单截止进一步裁剪；剩余 &lt;3s 直接走兜底</div></div>
      <div><label class="f">AI_REPORT_EVERY · 自动分析报告节奏 <span class="src" id="src-AI_REPORT_EVERY"></span></label><input class="f mono" id="in-AI_REPORT_EVERY" type="number" min="0" max="500" placeholder="0"><div class="text-[11px] text-slate-500 mt-1">0 = 关闭；30 = 每结算 30 期生成一份（走二阶闭环）</div></div>
    </div>
    <div class="mt-3 text-xs text-slate-400 bg-[#0b1220] rounded-lg p-3" id="window-calc"></div>
  </section>

  <!-- 自定义注数 -->
  <section class="card" id="custom-n-sec">
    <h2 class="font-bold mb-3"><i class="fas fa-sliders mr-2 text-violet-400"></i>AI 精选 · 自定义注数档位</h2>
    <div class="grid md:grid-cols-2 gap-4">
      <div>
        <label class="f">AI_CUSTOM_N · 逗号分隔的注数 <span class="src" id="src-AI_CUSTOM_N"></span></label>
        <input class="f mono" id="in-AI_CUSTOM_N" type="text" placeholder="例如 200,250">
        <div class="text-[11px] text-slate-500 mt-1">范围 10–900，最多 4 个；100/150/300/500 已是固定档位无需填写。定义后从下一期开始，AI 每期推理完成即按该注数生成精选，并作为独立策略记录、结算、进入战绩榜。</div>
      </div>
      <div class="text-xs text-slate-400 bg-[#0b1220] rounded-lg p-3 leading-relaxed">
        <div class="font-semibold text-slate-300 mb-1"><i class="fas fa-brain mr-1 text-violet-400"></i>推理积累机制</div>
        每期 AI 的上下文会携带 <code>your_tier_performance</code>：各档位（含自定义档）历史命中率、盈亏、命中名次分布。模型据此判断自己的优势集中在头部还是长尾，动态调整下期的排序信心，形成“推理 → 记录 → 结算 → 反馈 → 再推理”的数据飞轮。
      </div>
    </div>
  </section>

  <!-- 数据完整性 -->
  <section class="card" id="coverage-sec">
    <h2 class="font-bold mb-3 flex items-center justify-between">
      <span><i class="fas fa-database mr-2 text-cyan-400"></i>开奖数据完整性（近 7 天）</span>
      <span class="flex gap-2">
        <button class="btn bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs" id="btn-cov"><i class="fas fa-rotate mr-1"></i>重新扫描</button>
        <button class="btn bg-cyan-600 hover:bg-cyan-500 text-xs" id="btn-gapfill"><i class="fas fa-link mr-1"></i>链上补齐缺失</button>
      </span>
    </h2>
    <div id="cov-body" class="text-sm text-slate-400">加载中…</div>
    <p class="text-[11px] text-slate-600 mt-2">后台心跳每 5 分钟自动扫描近 2 天并从 TRON 链按“分钟 +3s 首个区块”规则补齐；上游接口最多只返回 1000 期，链上补齐是找回历史缺失的唯一途径。补齐记录 <code>src='chain'</code>。</p>
  </section>

  <div class="flex flex-wrap items-center gap-3 sticky bottom-4">
    <button class="btn bg-emerald-500 hover:bg-emerald-400 text-black" id="btn-save"><i class="fas fa-floppy-disk mr-1"></i>保存配置</button>
    <button class="btn bg-slate-800 border border-slate-700 hover:bg-slate-700" id="btn-save-test"><i class="fas fa-check-double mr-1"></i>保存并校验</button>
    <button class="btn bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-300" id="btn-clear"><i class="fas fa-eraser mr-1"></i>清除页面配置（回到环境变量）</button>
    <span id="save-msg" class="text-sm"></span>
  </div>
  <p class="text-[11px] text-slate-600 leading-relaxed">保存后 15 秒内全站生效（无需重启）；后台 AI 推理会在下一期自动使用新供应商。密钥存于 Cloudflare D1 <code>app_config</code> 表，接口只返回打码值；生产环境建议同时用 <code>wrangler pages secret put</code> 兜底。</p>
</main>

<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/settings.js"></script>
</body>
</html>`
