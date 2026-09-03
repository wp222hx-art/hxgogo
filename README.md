# HashPlay · 链上哈希可验证公平游戏演示平台

## 项目概述
- **名称**: HashPlay
- **定位**: 复刻「哈希竞猜」类玩法的完整机制，但 **只用虚拟积分、无任何支付/充提通道**。核心价值是演示 **Provably Fair（可验证公平）** 机制：每一局结果都能被任何第三方离线复算。
- **免责**: 所有积分为虚拟数值，不可充值、提现，不具货币价值。哈希输出不可预测，历史走势对未来无预测意义。

## 在线地址
- **沙箱预览**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai
- **量化分析中心**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/analysis
- **策略竞技场（自动战绩榜）**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/arena
- **生产环境**: 待部署（Cloudflare Pages）

## 已完成功能
### 三个开奖厅
| 厅 | 周期 | 封盘 | 随机源 | 验证方式 |
|---|---|---|---|---|
| TRON 区块厅 | 30s | 提前 6s | 波场公链真实区块哈希：取「时间戳 ≥ 本局截止时间的第一个区块」的 blockID | Tronscan 查区块即可核对 |
| 五位数厅 | 60s | 提前 8s | 哈希分分彩规则：区块哈希剔除字母后取末 5 个数字 → 万千百十个 | Tronscan 核对区块 |
| 种子承诺厅 | 20s | 提前 4s | `HMAC_SHA256(server_seed, "seed:{round_no}:{bets_hash}")` | 开局公示 `sha256(server_seed)`，开奖后公开种子；`bets_hash` = 全场注单 ID 排序后 sha256（玩家共同贡献熵） |

### 五种玩法（统一取数规则）
从哈希 **末位向左** 取第 1 个数字 = `digit1`，第 2 个数字 = `digit2`：
| 玩法 | 规则 | 赔率 |
|---|---|---|
| 单双 | digit1 奇/偶 | 1.95 |
| 大小 | digit1 ≥5 大 / ≤4 小 | 1.95 |
| 庄闲 | digit2(庄) vs digit1(闲)，大者胜；相等为和，压庄/闲退本 | 1.95 / 和 8.5 |
| 字符 | 哈希末位是数字还是字母 a-f | 数字 1.55 / 字母 2.55 |
| 幸运数字 | 精准命中 digit1 | 9.5 |

### 五位数厅玩法（对标哈希分分彩）
| 玩法 | selection 编码 | 赔率 |
|---|---|---|
| 定位胆 `pos` | `"<位0-4>-<数字>"` 如 `4-7` = 个位 7 | 9.5 |
| 定位两面 `pos2` | `"<位>-big/small/odd/even"` | 1.95 |
| 总和 `sum` | `big`(≥23) / `small` / `odd` / `even` | 1.95 |
| 龙虎 `dragon` | `dragon`(万>个) / `tiger` / `tie`（押龙虎遇和退本） | 1.95 / 和 8.5 |
| 前三形态 `shape` | `leopard` 豹子 / `straight` 顺子 / `pair` 对子 / `mixed` 杂六 | 70 / 15 / 3.3 / 1.35 |

### 量化分析中心 `/analysis`
- **数据采集**: 懒同步 qkltj 公开接口 5 个彩种（哈希分分/三分/五分/十分彩、以太坊分分彩），每源最多 1000 期（接口上限），增量拉取；本地五位厅开奖同步归档为 `local:five`
- **19 个分析市场**: 5 位×大小、5 位×单双、5 位×定位胆(10 类)、总和大小、总和单双、龙虎、前三形态
- **20 种分析机制**（分 6 组）:
  - 频率: 全量频率 / 近 30 期 / 近 100 期 / 指数加权
  - 遗漏: 遗漏回补(追冷) / 热号延续(追热)
  - 形态: 长龙反转 / 长龙跟随 / 交替模式
  - 转移: 一阶马尔可夫 / 二阶马尔可夫
  - 周期: 最佳滞后周期
  - 统计: 均值回归 / 卡方偏差跟随 / 熵收缩 / 贝叶斯后验 / 块 Bootstrap
  - 条件: 时段条件频率 / 哈希字母密度条件 / 跨维联动
- **滚动回测**: 对最近 N 期逐期"只用之前数据"预测，输出每个机制的命中率、log-loss、vs 基线、近 30 期命中点阵
- **集成量化**: 按 log-loss 的 softmax 权重加权 20 机制 → 集成概率、**倾向指数**(0-100)、**机制共识度**、投票分布
- **多维图表**（Chart.js + ECharts）: 全市场倾向卡片、集成概率 vs 基线、20 机制回测横向条形图、五位×数字频率热力图、当前遗漏热力图、总和分布 vs 理论卷积曲线、滚动 30 期大/单比率、24 小时时段分布、形态/龙虎 vs 理论、各市场最长连开
- **方法论声明**: 页面明示哈希为密码学随机数，回测命中率长期收敛于基线，分析仅为统计展示

### 本期推荐 & 预见性策略（`/analysis` 顶部 + 五位厅推荐条）
- **每个玩法全部候选的概率都写出来**: 定位胆 5 位×10 数字、定位两面 5 位×(大小/单双)、总和大小/单双、龙虎和（和率用实际频率）、前三形态 —— 共 19 组 / **81 个候选概率**，每个候选附：集成概率、理论先验（黄线刻度）、赔率、**EV = p×赔率−1**、机制投票数、当前遗漏、★ 星级
- **分级**: 强共识（倾向≥12 且共识≥45%）/ 温和 / 中性；形态盘倾向相对非均匀先验计算，避免「杂六 67%」虚高
- **每组一句预见性建议**: 规则引擎综合 倾向/共识/连开/遗漏/回测边际 自动生成
- **幸运数字综合榜**: 合并 5 个位置的定位胆概率 → “任意位至少出现一次”概率（理论 41%）+ 最可能位置 + 近 30 期热度 + 遗漏；点击直接切换 K 线
- **全局策略卡**: regime 判定（跟随期 / 反规律期 / 纯随机）、①主攻 ②辅攻 ③幸运数字 ④规避 ⑤仓位纪律 五步、长龙观察、EV Top
- **五位厅推荐条**: 游戏页五位厅下注面板顶部展示 Top8 推荐 + 幸运数字榜，**点击即下注**；本厅归档 <200 期时自动退回同规则的哈希分分彩历史；每局结算后自动刷新
- 倒计时：距下一期开奖 ≈ 最新期时间 + 彩种间隔，到点自动重算

### 幸运数字 K 线（ECharts 蜡烛图）
- **价格 = 出现频率**: 选定数字 0-9 × 位置（任意/万/千/百/十/个），按滚动窗口（10~100 期）算频率序列，再按 K 线粒度（1~20 期/根）聚合为 OHLC
- 阳线(红)=升温、阴线(绿)=降温、黄色虚线=理论 10%、MA5/MA20 均线、成交量=该根内实际命中次数；支持滚轮缩放
- 数字选择器带冷热标记（红点=近 30 期偏热，蓝点=偏冷），显示近 30 期频率与当前遗漏
- KPI: 实际/期望、出现率、**二项 z 分数**、当前/平均/最大遗漏、最长连出、阳阴线数、趋势（均线多空排列）
- 近 100 期命中点阵、遗漏长度分布 vs 几何分布理论曲线、自动文字解读
- **市场 K 线**: 总和 K 线（价格=每期总和，22.5 中轴）、总和大率 / 单率 / 龙率 K 线（滚动频率）

### 单双 K 线 + BOLL / MACD / KDJ 三指标预判（`/analysis` 中部 `#parity-section`）
- **两条实时 K 线**：默认万位、500 注。「单指数」= 100 + Σ(开单 +1 / 开双 −1)，「双指数」为其镜像；每期一个 tick，按粒度（1/3/5 期/根）聚合 OHLC，成交量=该根内命中次数；可切换万/千/百/十/个
- **三指标叠加（三栏图）**：主图蜡烛 + BOLL(20,2) 上中下轨；副图 MACD(12,26,9) DIF/DEA/柱；副图 KDJ(9,3,3)；所有 x 轴联动缩放
- **预判逻辑**：每个指标输出 [−1,1] 投票（BOLL：%B 位置/触轨反转；MACD：多空+柱体加速/金叉死叉；KDJ：J 极值反转/金叉死叉），按权重 0.3/0.4/0.3 合成；`score=(单分−双分)/2`，`P(单)=0.5+clamp(score×0.25,±0.2)`；|score|<0.08 → 观望，≥0.2 温和，≥0.45 强信号；给出下一期期号、单/双概率条、3 指标同向数、逐条判读与策略文案
- **实时**：按开奖间隔/4（10~60s）轮询，仅当最新期号变化才重绘并高亮闪烁
- **诚实回测**：对全样本逐根计算「信号 vs 下一根方向」命中率（BOLL/MACD/KDJ/合成 + 最近 20 次 ✓/✗），基线 50%；实测 6001 万位 ≈ 46~50%，页面明确标注「指标不具预测力，仅供参考」

### 量化选号器：下一期 Top-N 前三位（万·千·百）号预选 + 一键复制（`/analysis` 中部 `#pick-section`）
- **只取前三位**：号码空间 = 万×千×百 = 1000 种，理论基线 N/1000（300 注 = 30%）
- **数量拖拽自定义**：滑杆 10~1000 注（步进 10）+ 数字输入 + 预设 100/200/300/400/500/600/800 三者联动，350ms 防抖后重算；标题实时显示「下一期期号 · 共 N 注 · 当前显示」
- **算法（`src/picker.ts`）**：每位 0~9 倾向分布 = 20 机制集成概率 × 单双修正（复用单双 K 线预判 pOdd，权重 0.6）× 大小修正（权重 0.4），再按「分散度」温度 1/1.5/2.2 做 pow(1/temp) 展平；三位联合概率用最大堆 K-best 取 3N 候选，再按组合级信号（前三和 ≥14 大/单双近 60 期经验频率、万 vs 百 龙虎、前三形态相对先验 [0.01,0.048,0.27,0.672] 且夹紧 0.6~1.5 倍）重排取 Top-N
- **分层与标签**：核心 10% / 主力 40% / 外围 50%，卡片按层配色；每注显示排名，鼠标点击任一号码可单独复制
- **等价复式方案**：贪心按每位分布挑选子集，使乘积 ≈ N，给出「万[028] 千[0123456789] 百[…]」文案与覆盖率，可一键复制
- **量化覆盖率**：Top-N 倾向概率合计 vs 理论基线 N/1000，显示倾向倍数；同时给出每位「种数 / 首数占比」分散度
- **一键复制**：空格分隔 / 逗号分隔 / 每行一个 / 仅核心层 / 复式方案 五种格式，`navigator.clipboard` 失败自动回退 `execCommand('copy')`，成功后显示「已复制到剪贴板」；**下方「号码文本」框自带「一键复制全部号码」大按钮**（复制框内全部内容，显示注数与格式，复制后框内全选高亮）与「全选」按钮，`readonly` 文本框三击亦可全选
- **诚实回测**：最近 20 期用「当期之前的数据」生成 Top-N，统计真实开奖「前三位」是否落入（命中/期数、实际覆盖率、理论基线、理论期望命中）+ 最近 20 期命中序列（含榜内排名）；实测 300 注 8/20（期望 6），差异在随机波动范围内，页面明确标注「有据可循的随机选号器，非预测」
- **性能**：机制权重仅计算一次并在回测各步复用，bt=20 约 0.8~1.0s；结果 60s 缓存并带 `cached:true` / `X-Cache: HIT`，数据版本变更即失效；页面按开奖间隔/3（15~60s）自动刷新

### 选号器实盘战绩追踪（`#pick-track`，表 `pick_log`）
- **开奖前锁定**：每期为固定预设（300 / 500 注 · 均衡）自动生成 Top-N 快照并 `INSERT OR IGNORE` 入库（首次为准、不可改写）；由首页/分析页心跳 `GET /api/sync/status?tick=1` 触发，不依赖有人打开分析页；用户在分析页看到的任何默认权重配置（任意 N × 分散度）也会同步锁定
- **开奖后评分**：懒执行——任何读取战绩的请求先 JOIN `draws` 给未评分快照打分：实开前三位是否在名单内、榜内排名
- **战绩面板**：累计命中率 vs 理论基线（各期 N/1000 均值）vs 量化覆盖率均值三线图（ECharts）、命中点标记、`+pp` 相对基线与 z 值（|z|≥1.96 才着色）、命中落点分层（核心/主力/外围）、最近 40 期序列、按配置分组汇总（勾选「汇总全部配置」）、自动结论文案（<30 期不下结论）
- **诚实原则**：快照写入时目标期尚未开奖，评分只比对名单，无任何可调参数——这是对「量化选号器是否优于随机」最直接的长期检验

### 策略竞技场 · 自动战绩榜（独立页面 `/arena`，表 `arena_rounds`）
- **赛制**：12 个策略并行（11 个规则/统计策略 + 1 个 AI 预测官），每期开奖前各自自动锁定 **500 注三位号（万/千/百）**，`INSERT OR IGNORE` 首次为准；开奖后自动结算命中 / 名次 / 盈亏（每注 1 单位，参考赔率 950×，保本命中率 52.6%）
- **策略池**：量化集成·均衡（temp 1.5）/ 量化集成·聚焦（temp 1.0）/ 热号追击 / 冷号回补 / 单双大小倾向 / 贝叶斯衰减后验（半衰期 30）/ 马尔可夫一阶转移 / **随机对照组**（期号种子，理论 50%）/ **组合最优·自适应加权** / **跟随最强·动态切换**（整份复制之前滚动 40 期 z 最高的基础策略）/ **多策略共识投票**（按被几个基础策略同时选中排序）
- **向前滚动优化（walk-forward）**：「组合最优」只用目标期之前已结算的滚动 40 期战绩计算各基础策略 z 分数 → `w = 信任度·exp(0.6·clamp(z,−2,2)) + (1−信任度)`（信任度 n/(n+20)，样本不足自动趋向等权）→ 加权融合 1000 维概率 → Top 500；每期自动重算权重，即「以向前数据为依托，在下一期生成时做优化」
- **自动化**：心跳 `GET /api/sync/status?tick=1` → 同步开奖 → 结算已开奖期 → 为下一期生成全部策略 → 顺带补齐最近漏掉的期（每 tick ≤2 期）；页面无需常开
- **回放补齐**：`POST /api/arena/replay` 对历史已开奖期按时间正序、严格只用该期之前的数据生成并即时结算（标记 `mode='replay'`，与 `live` 可分开查看），首日即可积累 300 期样本（≈1 秒/30 期）
- **页面**：KPI（组合最优命中率/盈亏、当前最强、随机对照）· 战绩榜（已结算/命中/命中率/基线/提升/z/滚动命中率/滚动 z/累计盈亏/ROI/最大回撤/连续未中/下期权重/结论）· 累计盈亏 & 累计命中率曲线（ECharts，组合最优加粗、对照组虚线、50% 基线）· 组合最优下期权重条 · 自动生成的投资策略分析（诚实版）· 本期待开 9 策略 × 500 注（策略卡切换、三种格式、一键复制）· 逐期结算矩阵（点击期号弹窗查看该期各策略全部号码并高亮命中）
- **投资策略模拟**：6 套「选哪套 × 何时下注」完整方案（组合最优每期必投 / 跟随最强每期必投 / 组合最优择时 z>0.5 / 跟随最强择时 z>1 / 连败 2 期止损 / 逆向跟最弱对照），每期决策只用之前已结算数据，输出下注期/观望期/命中率/z/累计盈亏/ROI/最大回撤/实际跟投分布 + 累计盈亏曲线；结论文案明示「多方案挑最好带有选择偏差」
- **诚实原则**：任何策略必须长期显著跑赢随机对照组（z>1.96）才算有信号；页面明示 500 注每期期望 −25（950× 赔率），仅做统计验证，不构成投资建议

### 本期 AI 推荐 500 注（`/arena` 顶部 `#ai-pick-section` · 主入口）
- **每期一个选择**：每期开奖后，系统自动为下一期（本期待开）调用大模型推理并锁定 **500 注三位号**（万/千/百），页面顶部直接展示 + 一键复制（空格/逗号/每行一个）。推理中显示「推理中」并每 4 秒轮询 `GET /api/arena/pick`，就绪自动刷新
- **推理说明**：`regime`（局势判断）· `reasoning`（推理依据）· **`pick_plan`（这 500 注是怎么选的：各位重点数字、参考策略、加注/回避逻辑）** · 融合策略权重 · 加注/回避号 · 下期验证假设
- **结构拆解（由号码实际统计，非 AI 口述）**：各位 0-9 注数柱状图 + 重点数字、形态（豹/顺/对/杂）、万位大小单双、和值大小、加注号入选/回避号剔除计数、与其他策略的重合注数（共识度）
- **兜底**：本期 AI 调用失败/超时 → 用「组合最优」500 注兜底并明确标注 `fallback`，保证每期都有选择；成功后与其他策略同台结算并反馈 AI 复盘
- 分析官报告**默认不再自动生成**（`AI_REPORT_EVERY` 默认 0；页面按钮已移除，接口保留，可设 `AI_REPORT_EVERY=30` 重新开启二阶闭环）

### AI 预测官 / AI 分析官（大模型推理闭环，`/arena` 中部 `#ai-section`，表 `ai_forecasts` / `ai_reports`）
- **AI 预测官（策略 key `ai`，仅实盘）**：每期开奖后、下一期生成时，Worker 直接 `fetch` OpenAI 兼容接口（默认 `gpt-5-mini`，`response_format=json_object`），输入三块上下文：① **全部统计信号摘要**（近 60 期三位号、各位 60/200 期频率、当前遗漏、近 30 期大小/单双/和值/龙虎/形态走势、200 期形态分布）② **各策略滚动 40 期战绩 + 组合最优当前权重** ③ **它自己近 6 期的预测、验证假设与真实结果**（命中/名次/盈亏）→ 输出结构化 JSON：`regime`（当前局势判断）/ `confidence` / `pos_weights`（万千百 3×10 权重）/ `strategy_blend`（对 7 个基础策略的融合比例）/ `boost` / `avoid` / `reasoning` / `next_focus`（下期验证假设）
- **落地为号码**：`aiScores` = norm(√(自有分布 × 策略融合分布))，其中自有分布 = 三位权重乘积（+5 地板、0.8 次幂温和化防过度自信），再 boost ×1.6 / avoid ×0.4 → 1000 维得分 → Top 500 → 以 `strategy='ai'` 写入 `arena_rounds`，与随机对照、组合最优等**同规则结算、同榜排名、同曲线对比**
- **不间断迭代**：命中/失误在下一期作为「你上几期的预测与结果」喂回模型，系统提示明确要求连续失误时切换思路；页面「逐期预测 · 复盘」时间线展示每期的局势判断、把握、推理摘要、验证假设与实际开奖/命中名次
- **AI 分析官**：按钮 `POST /api/arena/report` 把 12 策略完整战绩、组合最优权重、6 套投资策略模拟、AI 预测官逐期表现、近 30 期结算一并交给模型，输出 Markdown 报告（一句话结论 / 各策略解读 / AI 复盘 / 权重建议 / 下一阶段择时·仓位·止损规则），系统提示强制「不编造数据、明示理论期望为负与样本不足」；同一结算期只生成一次（缓存于 `ai_reports`）
- **成本 / 稳健性**：每期 1 次调用（`INSERT OR IGNORE`，失败落 `error` 不重试）；`AI_EFFORT=low` 默认（约 8-15 秒，1 分钟一期的厅安全），35 秒超时则本期轮空；回放模式不含 AI（避免历史刷费与前视）；未配置密钥时 AI 行自动隐藏、其余策略照常
- **环境变量**：`OPENAI_API_KEY` / `OPENAI_BASE_URL`（必需，缺一则 AI 关闭）、`AI_MODEL`（默认 gpt-5-mini）、`AI_EFFORT`（low/medium/high）、`AI_REPORT_EVERY`（自动报告节奏，默认 0 = 关闭；设 30 开启）。本地写在 `.dev.vars`（已 gitignore），生产用 `wrangler pages secret put`

### AI 建议自动回测 · 二阶闭环（`/arena` `#ai-plans-section`，表 `ai_plans`，模块 `src/ai_plans.ts`）
「AI 提建议 → 系统验证 → 结果反馈给 AI」：分析官报告里的择时/仓位/止损建议不再只是文字，而是被自动编译成**可回测的投资策略**，和内置 6 套模拟同台比较，并把样本外结果喂回下一份报告。
- **规则编译**：报告生成后追加一次低推理 LLM 调用（`extractRules`，`json_object`），把报告「下一阶段规则」压成 ≤3 条受限 DSL；每条经 `normalizeRule` 严格校验/裁剪（非法指标、越界参数、引用 `ai` 策略均丢弃），落表 `ai_plans` 并记录 `report_expect`（提出时刻）
- **规则 DSL**（只允许系统真实能算的量，杜绝口头玄学）：
  - `conditions`（AND）/ `any_conditions`（OR）：`metric ∈ roll_z | roll_rate | miss_streak | hit_streak | meta_weight | best_z`，可指定 `strategy` 与 `window`，`op ∈ > >= < <=`
  - `target`：`fixed`（固定跟某策略）/ `best_z` / `worst_z` / `best_rate`（按滚动窗口择优，`min_n` 不足或无候选时走 `fallback`，`null`=观望）
  - `sizing`：`base / high / low` 倍数（0.5–2）+ `high_if / low_if` 条件
  - `risk`：`stop_after_misses`（连错暂停）+ `pause_periods` + `max_drawdown`（单位「注」；LLM 若写成比例 ≤1 自动换算为 ×100×500，下限 1000；触发后暂停 2×pause_periods 并重置回撤峰值，而非永久停机）
- **Walk-forward 回测**：每次加载战绩榜，`aiExtraPlans` 用与内置 6 套完全相同的逐期链（只用该期之前信息）模拟每条活跃规则，结果作为粉色 `ai:true` 行并入 `plans[]`；**样本内**（规则提出前的历史）与**样本外**（`expect > report_expect`，规则提出后的真实新期）分列展示，图表以虚线 + `since_index` 标线区分——只有样本外才是 AI 建议的真实成绩
- **反馈闭环**：下一份报告上下文新增 `ai_plans`（每条规则人话描述、提出时刻、样本内+样本外全量、样本外单独）与 `ai_plans_retired`，系统提示要求写「## AI 建议回测复盘」章节：对上一轮建议逐条认账/改进，再提 1–3 条新的机械规则（只能用 `available_metrics`）
- **自动退役**：`retirePlans` —— 样本外 ≥30 投且 z<−1 → 退役（`retire_reason=forward_negative`）；活跃 >4 套 → 退役样本外盈亏最差者（`too_many`）；也可手动 `POST /api/arena/plans/:id/retire`
- **自动节奏**：实盘每累计 `AI_REPORT_EVERY`（默认 0 关闭，设 30 开启）期结算，`/api/arena/board` 在 `waitUntil` 中后台生成新报告 → 新规则自动入池（`reportBusy` 防并发；未配置密钥时静默关闭）
- **UI**：投资策略表新增「样本外」列；`#ai-plans-section` 卡片展示每套规则的规则原文 / AI 依据 / 样本内 / 样本外 / 退役按钮，折叠区列出已退役规则与原因

### 首页「统计结果」逐期数据表（严格对齐 qkltj 接口）
- 数据源：`GET https://api.qkltj.com/api/draw-result?code=6001&rows=N`，字段 **原样入库**：`opennumber / lottoType / lottoTypeCn / openTime / id / block / hash / expect`
- **运算结果以官方 `opennumber` 为准**（n1~n5 直接取自官方值）；本地哈希推算仅做交叉校验，不一致时 `mismatch=1` 并在表格以 ⚠ 标注（当前 6 源 0 条不一致）
- 同步改为 **UPSERT**：历史行也会回填官方字段，保证与接口逐字段一致（已用 100 期逐字段比对：0 差异）
- 表格列：统计时间 | 奖期 | 区块（Tronscan/Etherscan 链接） | 区块哈希值（官方取用的最后 5 个数字字符 **红色高亮**） | 运算结果
- 支持切换 6001/6002/6003/6004/7001、20~100 期、每 20s 自动刷新、新一期首行闪动；「接口原文核对」链接直通 `/api/qkltj/raw`

### 实时同步机制（与 api.qkltj.com 逐字段一致）+ 手动同步
- **按开奖节拍调度（非固定轮询）**：记录每源 `latest_open_ms`，下一期理论发布时间 = latest_open + interval（+15s 官方入库延迟）之前不请求；到点后每 4s 追赶，拿到新期即停。分分彩实测新期检测延迟 **≈ 2~3s**（官方 openTime 03:46:14 → 本站 03:46:16），每次仅拉 5 行
- **周期审计**：每 5 分钟拉 100 行逐字段（block/hash/opennumber/openTime）与本地比对，差异即 UPSERT 修正并记录 `audit_rows/diff/fixed`
- **缓存版本化**：所有分析接口缓存 key 含 `dataVersion(source)`，任何写入即 bump 并清空该源缓存 → 同步后即一致，不会拿到旧结果
- **缓存可见**：命中缓存的响应带 `cached:true / cache_age_ms` 与 `X-Cache: HIT` 头；前端出现「缓存 Ns · 点击刷新」黄色徽标，点击即强制同步
- **手动同步按钮「立即同步」**（首页统计结果卡 / 分析页顶部状态条）：`POST /api/sync?force=1` → 拉 100 行逐字段核对 → 修正 → 清缓存 → 展示报告（新增/修正/一致条数、最新期、延迟、逐条差异）
- **状态条**：绿点=实时一致、黄点=滞后追赶、红点=接口异常；显示最新期与时间、下一期倒计时、审计结果、上次拉取延迟、库内期数；无需 cron（每次前端心跳携带 `tick=1` 由服务端顺带执行到点同步）

### 「统计时间 ↔ 区块」对应口径（逆向 qkltj.com/js/common.js + 链上 60 期逐块验证）
- **取块规则**：哈希分分彩固定取每分钟 **03 秒** 的 TRON 区块（03 秒无块取下一个）；实测 60/60 期区块时间戳秒位 = 03，相邻期区块号恒差 20；ETH 分分彩取每分钟 11 秒区块
- **奖期 expect** = `YYYYMMDD` + 当日分钟序号(4 位, UTC+8)，如 `202609030670` = 09-03 11:10
- **hash** = 区块 blockID（60/60 与 TronGrid 一致）；**运算结果** = 去 a-f 后末 5 位（60/60 一致）
- **统计时间 openTime** = 官方抓块入库时间 = 区块时间 +10~12s（非区块时间本身）
- **本站五位厅已对齐同一口径**：结算目标 = 分钟 + 3s 的第一个区块；期号改用官方格式；`GET /api/qkltj/reconcile` 逐期对账（首页有对账面板，实测 5/5 期区块、结果完全一致）

### 其他
- 匿名虚拟账户（Token 存 localStorage），初始 10,000 积分；余额 < 500 每小时可领 5,000 救济金
- 实时倒计时、开奖哈希滚动动画、末位数字高亮（黄=闲/红=庄）
- 路单走势（大路 6 行）、近 100 局分布统计、开奖历史、积分榜、个人流水
- **验证弹窗**: 逐步展示推导链 + 服务端重算一致性 + 离线复算代码
- 限额: 单注 10~5000，单局累计 20,000；封盘后拒单；余额原子扣减（防并发超扣）
- TRON 厅 10 分钟内取不到区块自动作废退款

## API 一览
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/rooms` | 厅配置、赔率、限额、服务器时间 |
| POST | `/api/auth/guest` | 创建匿名账户 `{nickname?}` → `{token}` |
| GET | `/api/me` | 当前用户（Header `X-Token`） |
| POST | `/api/me/relief` | 领取救济积分 |
| GET | `/api/state?room=tron\|seed` | 当前局 + 上局结果 + 我的注单 + 全场投注池（触发懒结算） |
| POST | `/api/bet` | `{room, bet_type, selection, amount}` |
| GET | `/api/history?room=&limit=` | 已结算历史 |
| GET | `/api/stats?room=` | 近 100 局分布 |
| GET | `/api/round/:room/:no` | 单局详情 + 投注聚合 |
| GET | `/api/verify/:room/:no` | **可验证公平推导链**（含 bet_ids、种子、承诺、重算结果） |
| GET | `/api/my/bets?limit=` | 个人注单 |
| GET | `/api/leaderboard` | 积分榜 Top20 |
| GET | `/api/sources` | 数据源列表 + 同步状态 + 期数 |
| POST | `/api/sync?source=&force=1` | 手动同步外部数据 |
| GET | `/api/draws?source=&limit=` | 原始开奖数据（含五位解析） |
| GET | `/api/analysis/markets` | 市场与机制定义 |
| GET | `/api/analysis/stats?source=` | 多维统计（热力图/遗漏/总和/时段/连开） |
| GET | `/api/analysis/predict?source=&market=&steps=&limit=` | **20 机制预测 + 回测 + 集成量化** |
| GET | `/api/analysis/overview?source=` | 全市场倾向总览 |
| GET | `/api/analysis/parity?source=&pos=0-4&bucket=1-20&limit=60-1000` | **单双指数 K 线**（odd/even 各含 candles/BOLL/MACD/KDJ/votes/stats/backtest）+ forecast（side/level/pOdd/reasons/strategy）+ 近 30 期序列 |
| GET | `/api/analysis/kline?source=&digit=0-9&pos=any\|0-4&bucket=1-50&window=5-200` | **幸运数字频率 K 线**（OHLC/MA/遗漏/z 分数/10 数字概况）+ 总和/大率/单率/龙率 K 线 |
| GET | `/api/analysis/pick?source=&count=10-1000&steps=20-150&bt=0-60&wp=&ws=&wc=&temp=0.5-3` | **量化选号器**：下一期 Top-N 前三位号（万千百，`digits:3, space:1000`；含 rank/tier/p/lift/tags）+ 每位倾向分布 + 组合信号 + 分层统计 + 分散度 + 等价复式方案 + 覆盖率倍数 + 诚实回测 |
| GET | `/api/analysis/pick/track?source=&count=&temp=&all=0\|1&limit=` | **选号器实盘战绩**：n/hits/rate/baseline/expected_hits/z/quant_avg/pending/tier_hits/by_config/verdict + 累计曲线 series + recent |
| GET | `/api/arena/board?source=&mode=all\|live\|replay&limit=` | **策略竞技场战绩榜**：strategies[]（n/hits/rate/baseline/lift/z/pnl/roi/max_dd/streak_miss/rolling/cum_pnl/cum_rate/verdict）+ periods[] 逐期结算 + current 本期各策略 500 注 + weights 下期权重 + best + advice[] + plans[]（投资策略模拟）+ plan_best |
| GET | `/api/arena/strategies` | 策略定义（key/name/desc/color/control/meta）+ 每策略注数 + 赔率 |
| GET | `/api/arena/round?source=&expect=&strategy=` | 单期单策略详情（numbers[] / actual / hit / rank / pnl） |
| POST | `/api/arena/replay?source=&n=1-30&lookback=` | 回放补齐历史（严格 walk-forward，返回 replayed / remaining） |
| GET | `/api/arena/pick?source=` | **本期 AI 推荐**：pick{expect, status ready/thinking/fallback, numbers[500], forecast{regime,reasoning,pick_plan,pos_weights,strategy_blend,boost,avoid,next_focus}, breakdown{pos_count,pos_focus,shape,wan,sum_big,consensus…}} + record（AI 实盘战绩）+ history |
| GET | `/api/arena/ai?source=&limit=` | **AI 预测官**逐期记录：regime / confidence / reasoning / next_focus / boost / avoid / pos_weights / strategy_blend + 结算 actual/hit/rank/pnl + tokens/latency/error |
| GET | `/api/arena/report?source=` | 最新一份 AI 分析官报告（Markdown） |
| POST | `/api/arena/report?source=` | 基于当前全部战绩生成 AI 分析官报告（同一结算期缓存）；随后自动编译规则，返回 `plans_added` / `plans_error` |
| GET | `/api/arena/plans?source=` | **AI 建议回测**：active[]（规则 DSL + 人话描述 + 样本内/样本外统计）/ retired[]（含 retire_reason）/ builtin（内置 6 套 key） |
| POST | `/api/arena/plans/:id/retire?source=` | 手动退役一条 AI 规则 |

> `/api/arena/board` 的 `plans[]` 现包含 `ai:true` 行（`plan_id / report_expect / rationale / forward{bets,hits,rate,z,pnl,roi,max_dd} / since_index`），`ai` 字段新增 `report_every` / `plans_retired_now` / `pick`（同 `/api/arena/pick` 的 pick）。
| GET | `/api/analysis/recommend?source=&steps=` | **本期推荐**：5 玩法 19 组 81 候选概率 + 幸运数字综合榜 + 预见性策略 |
| GET | `/api/qkltj/table?code=6001&limit=30` | 首页统计结果表：官方字段 + `highlight`（哈希中取用数字下标）+ `mismatch` |
| GET | `/api/sync/status?source=&tick=1` | 同步状态（latest_expect / lag_ms / expected_publish_ms / audit / fresh / version）；`tick=1` 顺带执行到点同步 |
| POST | `/api/sync?source=&force=1` | 同步；`force=1` 拉 100 行逐字段核对修正并清空分析缓存，返回 `{fetched,inserted,updated,unchanged,consistent,diffs[]}` |
| GET | `/api/qkltj/reconcile?limit=30` | 本站五位厅 vs 官方 6001 逐期对账（同期号→区块/哈希是否一致） |
| GET | `/api/qkltj/raw?code=6001&rows=1` | **严格直通** qkltj 接口原文（逐期一致性核对） |

## 数据架构
- **存储**: Cloudflare D1 (SQLite)
- **表**: `users` / `rounds` / `bets` / `draws`（统一格式开奖库：source+expect 主键，n1~n5 + 官方原字段 opennumber/lotto_type/lotto_type_cn/open_time/src_id/mismatch）/ `sync_meta`（同步节流）/ `pick_log`（选号器每期 Top-N 快照 + 开奖评分）/ `arena_rounds`（竞技场：source+expect+strategy 主键，mode live/replay，500 注号码、倾向覆盖、当期权重、actual/hit/rank/pnl）/ `ai_forecasts`（AI 预测官每期结构化输出 + 推理 + regime/confidence + tokens/latency/error）/ `ai_reports`（AI 分析官报告，按结算期缓存）/ `ai_plans`（AI 建议编译出的规则 DSL：source、report_expect、name、rule JSON、rationale、model、retired_ms、retire_reason）
- **调度**: 无 cron，采用 **懒结算**——任意请求到达时结算所有到期局（`open → settling(锁) → settled/void`），天然适配 Workers 无常驻进程的限制
- **局号**: `floor(now / roundMs)`，全球一致、可离线推算任一时刻的局号

## 本地开发
```bash
npm run build
npm run db:migrate:local
pm2 start ecosystem.config.cjs      # http://localhost:3000
```

## 部署
- **平台**: Cloudflare Pages + D1
- **步骤**: `wrangler d1 create webapp-production` → 填 `database_id` → `npm run db:migrate:prod` → `npm run deploy`
- **技术栈**: Hono + TypeScript + TailwindCSS(CDN) + D1 + OpenAI 兼容 LLM（gpt-5-mini，Worker 内直接 fetch）
- **生产密钥**: `wrangler pages secret put OPENAI_API_KEY` / `OPENAI_BASE_URL`（可选 `AI_MODEL` / `AI_EFFORT`）
- **最后更新**: 2026-09-03

## 未实现 / 下一步建议
- [x] 选号器战绩追踪（已完成，见上）
- [x] 策略竞技场 · 自动战绩榜 `/arena`（已完成，见上）
- [x] AI 预测官（实盘参赛、逐期自我复盘）+ AI 分析官报告（已完成，见上）
- [x] AI 建议自动回测二阶闭环（报告 → 规则 DSL → walk-forward 样本内/样本外 → 反馈下一份报告 → 自动退役 / 自动节奏）
- [ ] AI 扩展：多模型同台（gpt-5 vs mini vs nano 各一个选手）、AI 报告定时归档、DSL 扩展（允许引用形态/和值等原始信号）、规则版本对比（同名规则迭代前后样本外曲线叠加）
- [ ] 竞技场扩展：可配置注数（300/500/800）与赔率、按小时段/趋势状态分组战绩、导出 CSV
- [ ] 「本期推荐」5 玩法战绩追踪：同样快照落库 + 开奖评分，展示推荐命中率曲线 vs 基线
- [ ] 用户下注行为多维分析（按玩法/时段/筹码分布/跟随倾向 vs 命中）
- [ ] 选号器分散度增强（按位限制单数字占比上限）与权重 wp/ws/wc 前端可调
- [ ] 机制参数可调（窗口长度、阈值）与自定义组合回测
- [ ] 独立的「离线验证器」静态页（粘贴 seed / bet_ids 即可在浏览器本地复算，不依赖服务端）
- [ ] 每局区块哈希附带 TronGrid 多节点交叉校验（防单节点数据异常）
- [ ] 房间参数后台可配（周期、赔率、限额）
- [ ] WebSocket/SSE 推送替代轮询（需 Durable Objects，BYOK 部署可选）
- [ ] 多语言 / 移动端手势优化
