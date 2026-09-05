# HashPlay · 链上哈希可验证公平游戏演示平台

## 项目概述
- **名称**: HashPlay
- **定位**: 复刻「哈希竞猜」类玩法的完整机制，但 **只用虚拟积分、无任何支付/充提通道**。核心价值是演示 **Provably Fair（可验证公平）** 机制：每一局结果都能被任何第三方离线复算。
- **免责**: 所有积分为虚拟数值，不可充值、提现，不具货币价值。哈希输出不可预测，历史走势对未来无预测意义。

## 在线地址
- **沙箱预览**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai
- **量化分析中心**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/analysis
- **策略竞技场（自动战绩榜）**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/arena
- **AI 推荐（每期 500 注 · 一键复制）⭐**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/ai
- **配置中心（填 key · 校验 · 报单窗口）**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/settings
- **战绩榜优质策略推荐选号（滚动前三 · 融合 500 注）⭐**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/top3
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

### AI 推荐 · 独立页面 `/ai`（每期 500 注 · 一键复制）⭐ 当前主功能
极简单页：**一屏内 = 本期期号 + 开奖倒计时 + 一键复制 + 500 注**，下方是战绩概览与逐期记录。只展示 `ai` 策略（AI 预测官）的号码，不再混入其他策略。
- **本期面板 `#cur`**：待开期号、基于哪一期、距开奖倒计时（预计开奖时刻 + 15s 发布延迟，归零后显示「开奖中」并每 4s 轮询直到新期号出现）、`一键复制 500 注`（Clipboard API + execCommand 兜底，格式：空格 / 逗号 / 每行一个，记忆在 localStorage）、可全选的文本框 + 500 格网格（粉色 = AI 额外看好 `boost`）
- **推理折叠区 `#cur-why`**：盘面判断 / 自评把握 / 推理 / **500 注构成方案 `pick_plan`** / 落地结构（各位重点数字实际注数、形态、大小单双、和值、策略融合比例、加注/回避号）/ 各位 0-9 权重柱图 / 下期验证假设 / 模型·耗时·tokens
- **状态机**：`thinking`（推理中：不定长进度条 + 已等待秒数，每 4s 轮询）→ `ready`（锁定）；调用失败 → `fallback`（用组合最优 500 注兜底并明确标注），保证每期都有可复制的选择
- **战绩 `#stats`**：已实盘期数、命中率（对照保本 52.6%）、累计盈亏（950×）、近 20 期命中条
- **逐期记录 `#hist-sec`**：最近 12/30/60 期，每行 = 期号 · 实际开出 · 盘面判断 · 命中#名次/未中 · 盈亏；展开后显示该期 500 注（绿色 = 命中号）+ 推理与方案 + 复制该期 500 注
- `/arena` 顶部改为一张跳转卡 `#ai-pick-link`，首页 / 量化 / 竞技场导航均新增「AI 推荐」入口

### 战绩榜优质策略推荐选号 `/top3`（模块 `src/top3.ts`，策略 key `top3`，表 `top3_picks`）⭐
把「谁最近最强」变成一份可直接下注的新号码：**每期取战绩榜滚动前三名的策略，各自 500 注 + 按战绩加权融合成一份全新的 500 注**，一键复制，并像其他策略一样逐期结算。
- **前三怎么定（与竞技场同口径，walk-forward 无前视）**：候选 = 7 个基础策略 + 3 个组合策略（排除随机对照与 AI——AI 异步到达且可能缺席，不能保证每期确定）；按「目标期之前」最近 40 期滚动 z =（命中 − 期望）/√Σp(1−p) 排名，样本 <10 期不参与，不足 3 个时用组合最优/共识投票/量化均衡补位
- **融合规则**：成员权重 w ∝ exp(0.6·clamp(z,−2,2))；每个三位号得分 = Σ w_k·(501 − 该号在成员 k 的 500 注中的名次)；取 Top 500 → 写入 `arena_rounds(strategy='top3')`，成员与权重写入 `top3_picks.members`
- **每期自动**：`arenaTick` 在基础策略生成后立即调用 `top3Round`（幂等）——与开局同步，锁定时刻 ≈ 上期开奖后 5–8s；开奖后与其他策略同规则结算（950×，每注 1）
- **回放补齐 `POST /api/top3/backfill?n=`**：对历史已结算期，用该期之前的战绩排名 + 该期已存的成员 500 注重建融合并直接结算（仍无前视），已补齐全部 ~900 期
- **页面**：本期期号 / 倒计时（北京时间）/ 三张成员卡（名次 · 滚动 z · 近 40 期命中率 · 融合权重 · 其 500 注中多少进入融合）/ **四个可切换列表**（融合 500 注 + 三位成员各 500 注）→ 一键复制（空格 / 逗号 / 每行）/ 网格中金色 = 三策略共识、浅金 = 两策略共识 / 战绩卡（融合策略已实盘期数 · 命中率 vs 52.6% · 累计盈亏 · 近 20 期）/「为什么是这三个」完整排行（入选标记）/ 逐期战绩（每行 = 期号 · 实开 · 北京时间 · 三位成员各自中/未 · 融合命中#名次 · 盈亏；展开看该期 500 注 + 成员权重 + 复制）
- **实测**：本期 `…1207` 前三 = 量化均衡(z+1.48, w49%) / 量化聚焦(+0.82, 33%) / 马尔可夫(−0.16, 18%)，融合 500 注中三策略共识 284 注；融合策略实盘 712 期命中率 49.2%（与理论 50% 一致——「跟随最强」并不自动带来超额，这正是要用数据说话的地方）

### 策略优化 v2（基于 5,082 期审计数据的四项改动 + 拉取保险）
**审计结论**：12 个策略中只有 AI 在保本线之上（52.85%，z=+1.58，累计 +）；开奖数字万/千位完全均匀（卡方 8.3/4.2），**百位卡方 17.09 刚过 5% 临界**；上期→本期转移无记忆效应（卡方 84.7 < 103）；今日 1,323 期 0 漏期。
- **A · AI 成主角**（`src/ai.ts`）：`AI_POS_POW` 0.8→**1.0**（不再温和化模型的每位权重）；`strategy_blend` **只保留滚动 z>0 的策略**（perf 传入 `aiScores`，8 个负期望策略被清零；提示词告知模型 `blend_eligible`）；自有分布/策略融合几何权重 0.5/0.5→**0.65/0.35**；**守门** `AI_GUARD_K=40, AI_GUARD_Z=−1.0`：AI 近 40 期滚动 z 低于 −1 时，推荐面板自动改用组合最优（AI 号码仍照常入榜结算），`pick.guard{z,n,active}` 返回并在页面标注
- **B · top3 门槛 + AI 入候选**（`src/top3.ts`）：候选扩为除随机对照外全部 12 个策略（含 AI）；**只有 z>0 且样本 ≥10 的策略才可入选**，合格者不足 3 个则只融合合格者，全无则退回组合最优；AI 入选但本期未到达时最多等 `TOP3_AI_WAIT_MS=15s`（从基础策略生成起算），超时剔除 AI 只融合已到者。实测时序：meta 22:22:16 → AI 22:22:22 → top3 22:22:27（上期开奖后 13s 锁定，距开奖 47s）；本期成员 AI(z+2.20, w41%) / meta(+1.58, 32%) / markov(+1.27, 27%)，三策略共识 240 注。排行表标注「z≤0 不合格」
- **C · 百位偏差追踪策略 `pos3-bias`**（`src/arena.ts`）：假设检验型——万/千均匀，百位按全样本频率向均匀收缩 50% 加权。已回放 197 期：52.79%，z=+0.78，累计 +300（方向与假设一致但尚不显著；若 200+ 期后 z>1.5 即可确认上游存在系统性偏差）
- **D · 注数回测 `GET /api/arena/stake-curve?strategies=`**：用已结算期的命中位次直接推算「若只投前 N 注」的命中率/edge/z/盈亏/ROI（保本 = N/950）。**AI 788 期：前 150 注 ROI +4.48%（z +1.18）、前 100 注 +3.68%、前 500 注 +0.79%**；markov 前 100 注 +6.23%（z +1.7）但 200 注以上转负；top3/meta/random 全线为负。`/ai` 页新增「投注注数回测」表，★ 标注 ROI 最优 N
- **S · 拉取保险**（`src/sync.ts`）：`fetchQkltj` **三连重试**（超时 5/6/8s，退避 0.8/1.6s，URL 加时间戳防缓存）；`sync_meta.fail_streak` 连续 ≥3 次失败写 `sync_alerts(fetch_fail)`，恢复后自动关闭并记 `recovered`；`syncStatus` 新增 `stale`（距最新开奖 >2 周期+15s）与 `fail_streak`；`/ai` `/top3` 页顶部红条在 stale 或连续失败时提示「自动重试中，当前为最后一期有效数据」；`GET /api/sync/alerts`

### 配置中心 `/settings`（AI 供应商 key 填写 + 真实校验，表 `app_config`，模块 `src/config.ts`）
- **页面填写、即时生效**：DeepSeek 卡片内置 **V4 模型目录卡**（点选即填，含版本/定价/各思考档耗时）+ **思考模式四档按钮**（off/low/high/max，带适用厅型提示）+ **请求体实时预览**（展示将发出的 `chat/completions` JSON，含 `thinking` / `reasoning_effort` / `response_format`）；OpenAI 兼容一组（key、Base URL、模型、effort）；供应商选择（自动 / 强制 deepseek / 强制 openai）、`AI_LEAD_MS` 报单窗口、`AI_TIMEOUT_MS`、`AI_REPORT_EVERY`。保存到 D1 `app_config`，**优先级高于环境变量**，15s 内全站生效（`/api/*` 中间件每请求解析一次 `effectiveEnv` → `c.var.ai`，后台 `aiKick` 同样使用）
- **密钥安全**：只存服务端；`GET /api/config` 只返回打码值（`sk-a…9xYz`）与来源标签（页面配置 / 环境变量 / 未设置）；密钥输入框留空 = 不修改
- **真实校验 `POST /api/config/validate`**（可带未保存草稿）：① `GET /models` 验 key 与 Base（鉴权失败立即返回，含供应商原始错误）② 真实调用 1–3 轮要求返回 3×10 权重 JSON，测**推理耗时**并解析结构，思考模式下显示思维链样例与 `reasoning_tokens`，并附「实际发送的参数」③ DeepSeek 额外查 `/user/balance` 余额；旧模型名给出映射提示；结果附「是否赶得上 1 分钟厅报单窗口」的判断与错误对应的修复提示（key 无效 / 余额不足 / 模型名错 / Base 不可达 / 限流）
- **时间预算计算器**：按 `AI_LEAD_MS` 实时显示「AI 最晚须在 Ns 内锁定 → 你获得 Ns 报单时间」；页头实时显示本期 AI 状态（推理中 / 已锁定 · 模型 · 耗时 / 兜底）
- 一键「清除页面配置」回退到环境变量

### 报单同步保障（AI 锁定与真实开局对齐）· 服务端心跳 + 时序审计
**问题（审计发现）**：此前 AI 推理只由「页面请求」触发——没人开页面就没人推理；页面在上期开奖后 30–45s 才轮询到新期，AI 再跑 5–25s，留给报单的余量只剩 0–20s，甚至直接 `skipped: lock window -5s`；思考模式（think-low）在完整上下文下 >25s 全部超时。
**方案**：
1. **服务端心跳 `heartbeat()`**（`src/index.tsx`）：任何 `/api/*` 请求到达时若心跳未在跑，就用 `waitUntil` 起一条 20 分钟的循环（每 2s 一跳；每跳重新解析 `/settings` 配置），跳内 `syncSource`（受 `dueInfo` 节流，不到点不打网络）→ `arenaTick` → `aiNeeded ? aiKick('heartbeat')`。**新开奖入库后 2–5s 内 AI 即开始推理**，不再依赖有人开着页面
2. **思考模式自动降级**：`THINK_MIN_BUDGET_MS=90s`，预算不足时本期自动切非思考并在 `model` 标注 `:degraded`（1 分钟厅 think 档等价于 off；三分厅以上才真正开思考）
3. **超时不再被吞**：`llmChat` 用 `res.text()` 读体，读体阶段 abort 正确记为 `timeout`；思考耗尽 tokens 无 `content` 记 `thinking consumed all tokens`
4. **时序落库**：`ai_forecasts` 新增 `lock_by_ms / started_ms / trigger`（page | board | pick | heartbeat）
5. **审计接口 `GET /api/ai/sync-audit?source=&n=`**：逐期给出 `started_after_prev_s`（上期开奖后几秒开始）、`locked_after_prev_s`、`margin_to_lock_s`（距截止余量，>0 合格）、`margin_to_open_s`（距实际开奖余量）+ 汇总 `locked_in_time_rate / margin_open_min_s / heartbeat_alive`
6. **`/ai` 页同步状态行**：服务端心跳运行中 · 近 20 期 N/20 在报单截止前锁定 · 上期开奖后平均 Xs 锁定（最慢 Ys）

**实测（修复后连续 5 期无人值守，v4-flash 非思考）**：上期开奖后 **2–5s 开始**、**7.6–10.7s 锁定**、距 20s 截止余量 **+29~32s**、距实际开奖 **48–52s**；5/5 截止前锁定。

### 数据一致性自校验（与上游 API 逐字段对账）
- **`GET /api/ai/self-check?source=&n=10`**：此刻直接拉 `api.qkltj.com` 原始数据，与本库 `draws`（号码 / openTime / block / hash）、AI 结算（`arena_rounds.actual` 是否等于上游前三位）逐期比对；并检查 AI 待开期是否恰为「上游最新期 + 1」且 `based_on` = 上游最新期。返回 `summary{upstream_latest, local_latest, in_sync, all_match, mismatches, pending_expect, expected_next, pending_ok, server_now_bj}` + `rows[]`
- **`/ai` 页「与上游 API 对账」按钮**：一键展示比对表（期号 · 上游开奖(北京) · 上游号码 · 本库号码 · AI 结算 · AI 锁定(北京) · ✓/差异）
- **时区统一**：上游 `openTime` 是北京时间（UTC+8）；此前 `/ai` 页用浏览器本地时区渲染 `created_ms` / `open_ms`，在非 +8 时区的浏览器（或沙箱 UTC）下会显示成「10:58」而上游是「18:58」，看起来像「时间对不上」。现全部改为**明确标注「北京时间」**并按 UTC+8 渲染；倒计时旁显示「预计北京时间 HH:MM:SS 开奖」；逐期记录每行带北京时间开奖时刻
- **实测**：连续 10 期 号码/时间/区块/hash 全部一致；AI 待开期 = 上游最新 + 1 ✓；AI 每期在上期开奖后 ~7–10s（北京时间 xx:xx:2x）锁定，距该期开奖 50s+

### AI 精选档位：前 100 / 150 / 300 注（策略 key `ai-100` `ai-150` `ai-300`）
- **定义**：与 AI 500 注是**同一份排序**的前缀（AI 得分从高到低），不重跑模型。`STRATEGIES` 新增三条 `derived:'ai', n` 派生定义；`externalRound` 写入 `ai` 时同批写入三档；每档作为**独立策略同规则结算**：每注 1，命中 +（950 − N），未中 −N，保本命中率 = N/950（10.5% / 15.8% / 31.6%）
- **每期记录**：`arena_rounds` 里每期有 `ai` `ai-100` `ai-150` `ai-300` 四行；`/api/arena/pick` 返回 `pick.subsets[]{key, n_pick, breakeven, numbers[N], record{n, hits, rate, pnl, z, roi, streak[20]}}`，`history[].subsets{ai-100:{hit,pnl},…}` 标注每期各档是否命中
- **历史回填** `POST /api/ai/backfill-subsets`：由已存 `ai` 行的 `rank` 直接推算（rank ≤ N 即命中），已回填 876 期
- **页面 `/ai`**：500 注上方新增四个档位标签（全部 500 / 前 100 / 前 150 / 前 300，各带保本线与实盘命中率）→ 一键复制按钮随档位变为「复制 N 注」；网格仍显示全部 500，超出所选档位的号码变暗；「AI 精选档位战绩」四张卡（命中率 vs 保本 · 期数 · z · 累计 · ROI · 近 20 期）；逐期记录每行带 `100✓ 150✗ 300✓` 芯片，展开后可分别复制该期前 100/150/300/500
- **当前实盘（876 期）**：500 注 53.1%（+3,750，ROI +0.86%）· 前 100 注 10.8%（z +0.83，ROI **+3.00%**）· 前 150 注 16.0%（z +0.81，+1.20%）· 前 300 注 31.8%（z +1.19，+0.90%）。四档全部在保本线之上，但 z 均 <2，尚未达统计显著；派生策略不参与 top3 排名与 AI 融合候选（注数不同、且与 ai 完全相关）

### 开奖数据完整性：漏期扫描 + 链上补齐（模块 `src/gapfill.ts`，表 `gap_log`，列 `draws.src`）⭐
- **问题**：上游 `api.qkltj.com` 无论传什么参数最多只返回最近 1000 期；一旦拉取连续失败超过 1000 期（约 16.7 小时），官方接口就再也补不回来，战绩榜 / AI 学习样本会出现永久空洞
- **漏期扫描** `scanGaps`：以期号 ↔ 分钟的确定性映射（`expect = YYYYMMDD + 0001..1440`，序号 N = 北京时间当日 00:00 + N 分钟；当日 `1440` 落在次日 00:00）生成完整分钟序列，与库内比对
- **链上补齐** `fillGapsFromChain`：缺失期 → 分钟时间戳 +3s → TRON 首个区块（`findFirstBlockAtOrAfter`）→ `blockID` 去 a–f 取末 5 位 = 开奖号；写入 `draws(src='chain')` + `gap_log`。**已实测**：删除 `202609051200` 后补齐得区块 `85979293` / 号码 `24543`，与上游原记录**逐字段一致**
- **公共节点容灾** `src/tron.ts`：TronGrid 匿名限流（429）→ 自动切换 tronstack / publicnode 备用节点 + 指数退避（4 次）；补齐逐期间隔 250ms；可选 `setTronApiKey` 提升限额
- **自动化**：服务端心跳每 5 分钟对 TRON 厅扫描近 2 天并补齐（每次 ≤10 期）；页面 `/settings`「开奖数据完整性」面板：逐日 已记录/应有 · 链上补数 · 状态 ✓，缺失期号列表，「链上补齐缺失」按钮
- **接口**：`GET /api/draws/coverage?source&days≤30`（days[]、missing[]、total{n,chain}、recent_fills）· `POST /api/draws/gapfill?source&days&max≤50`

### AI 精选自定义注数（配置键 `AI_CUSTOM_N`，策略 key `ai-custom-N`）⭐
- **定义**：`/settings`「AI 精选 · 自定义注数档位」填入逗号分隔的注数（10–900，最多 4 个，不能与 100/150/300/500 重复；服务端 `parseCustomNs` 校验）。示例 `200,250`
- **定义即生效**：保存时立刻从 `ai` 主榜的 `rank` 派生历史（`backfillCustomTiers`，N ≤ 500 可派生，400 期）→ 新档位不从零起步；**从下一期开始**由 AI 每期推理完成后实时生成（`externalRound(..., extraNs)`，N ≤ 500 取排序前缀，N > 500 取 `topN(scores)`），作为**独立策略**记录 `arena_rounds`、逐期结算、进入 `/api/arena/pick.subsets[]`（`custom:true`）与 `history[].subsets`
- **页面 `/ai`**：自定义档位按注数插入标签栏（紫色 ★ 标记）、战绩卡带「自定义」徽标、逐期记录芯片 `200★✓`、展开后可复制该期「前 200★」；缓存键含 `AI_CUSTOM_N`，修改后即时刷新
- **当前实盘（400 期）**：200 注 21.3%（保本 21.1%，z +0.63，ROI +0.9%）· 250 注 26.8%（保本 26.3%，z +0.81，ROI +1.7%）

### AI 推理自学习：档位战绩反馈闭环（`tierDigest` → prompt `your_tier_performance`）⭐
- **逻辑**：每期推理前，系统从 `arena_rounds` 计算 AI 自身各档位（100/150/300/500 + 自定义）在**全部 400 期**与**最近 60 期**的命中率、保本线、edge、z、ROI，以及命中时落在前 100 / 101–200 / 201–300 / 301–500 的**位次分布**（对比均匀分布期望），连同一句决策提示一起喷给模型
- **模型据此调整**：头部档位 edge 持续高于尾部 → 排序有效，`pos_weights` 更有取舍、把最有把握的组合排到前面；头部 edge 为负而 500 注为正 → 前段过度自信，应分散。形成「推理 → 记录 → 结算 → 反馈 → 再推理」的数据飞轮，样本越多反馈越精
- **可观测**：`GET /api/ai/tier-digest?source` 返回模型本期看到的完整摘要（当前：位次分布 49/36/49/80 vs 均匀 43/43/43/86，头部 1–100 略高于均匀，300 注档 z +1.53 最强）

### 前端加载体系优化（缓存 + 后台推理 + 进度反馈）
**问题**：此前 `/api/arena/board` 与 `/api/arena/pick` 在请求路径内**同步等待大模型推理（6–15s）**，且 board JSON 约 290KB，页面首屏 2–15s 不等。
**方案**（`src/index.tsx`）：
1. **AI 推理移出请求路径**：`arenaTick` 只做同步/生成/结算（纯本地计算，~50ms）；AI 通过 `aiNeeded → bg(aiKick)` 用 `c.executionCtx.waitUntil` 在后台执行（`aiBusy` 防并发，`externalRound` 写入 `arena_rounds(strategy='ai')`），任何接口都不再等 AI
2. **服务端内存缓存 `cachedArena`**：key = `路由|source|参数|v{dataVersion}|a{arenaVer}`，board TTL 30s、pick TTL 20s；任何 arena 写入 / 同步入库 / 回放都会 `invalidateArena` 递增版本号立即失效；响应头 `X-Cache: HIT|MISS`，body 带 `cached / cache_age_ms / compute_ms / timing{sync,tick,check,board}`
3. **前端陈旧优先（stale-while-revalidate）**：`/ai` 把每次 `ready` 结果写入 `localStorage['ai:pick:<source>']`，再次打开**先渲染本地缓存**（标注「本地缓存 · 刷新中…」）再后台刷新
4. **进度条四阶段** `#loader`：连接数据源 25% → 同步最新开奖 50% → AI 推理本期 75% → 锁定 500 注 100%，配骨架屏；数据到达后淡入内容；请求失败显示原因并 5s 自动重试
- **实测**：pick 接口 MISS ~110ms / HIT ~60ms（原 6–15s）；board MISS ~1.4s（服务端计算 ~220ms，其余为 wrangler 本地 + 290KB 传输）/ HIT ~80ms；`/ai` 首屏（含 CDN）~4s 内出内容，二次打开 <1s；AI 仍每期后台完成（约 7–8s）并自动翻转 `thinking → ready`

### AI 预测官 / AI 分析官（大模型推理闭环，`/arena` 中部 `#ai-section`，表 `ai_forecasts` / `ai_reports`）
- **AI 预测官（策略 key `ai`，仅实盘）**：每期开奖后、下一期生成时，Worker 直接 `fetch` OpenAI 兼容接口（默认 `gpt-5-mini`，`response_format=json_object`），输入三块上下文：① **全部统计信号摘要**（近 60 期三位号、各位 60/200 期频率、当前遗漏、近 30 期大小/单双/和值/龙虎/形态走势、200 期形态分布）② **各策略滚动 40 期战绩 + 组合最优当前权重** ③ **它自己近 6 期的预测、验证假设与真实结果**（命中/名次/盈亏）→ 输出结构化 JSON：`regime`（当前局势判断）/ `confidence` / `pos_weights`（万千百 3×10 权重）/ `strategy_blend`（对 7 个基础策略的融合比例）/ `boost` / `avoid` / `reasoning` / `next_focus`（下期验证假设）
- **落地为号码**：`aiScores` = norm(√(自有分布 × 策略融合分布))，其中自有分布 = 三位权重乘积（+5 地板、0.8 次幂温和化防过度自信），再 boost ×1.6 / avoid ×0.4 → 1000 维得分 → Top 500 → 以 `strategy='ai'` 写入 `arena_rounds`，与随机对照、组合最优等**同规则结算、同榜排名、同曲线对比**
- **不间断迭代**：命中/失误在下一期作为「你上几期的预测与结果」喂回模型，系统提示明确要求连续失误时切换思路；页面「逐期预测 · 复盘」时间线展示每期的局势判断、把握、推理摘要、验证假设与实际开奖/命中名次
- **AI 分析官**：按钮 `POST /api/arena/report` 把 12 策略完整战绩、组合最优权重、6 套投资策略模拟、AI 预测官逐期表现、近 30 期结算一并交给模型，输出 Markdown 报告（一句话结论 / 各策略解读 / AI 复盘 / 权重建议 / 下一阶段择时·仓位·止损规则），系统提示强制「不编造数据、明示理论期望为负与样本不足」；同一结算期只生成一次（缓存于 `ai_reports`）
- **成本 / 稳健性**：每期 1 次调用（`INSERT OR IGNORE`，失败落 `error` 不重试）；`AI_EFFORT=low` 默认（约 8-15 秒，1 分钟一期的厅安全），35 秒超时则本期轮空；回放模式不含 AI（避免历史刷费与前视）；未配置密钥时 AI 行自动隐藏、其余策略照常
- **模型供应商（DeepSeek 优先，OpenAI 备用）**：`src/ai.ts` 的 `aiProvider()` 统一选择供应商，`llmChat()` / `buildChatBody()` 屏蔽参数差异，`parseJson()` 容忍围栏/废话。**默认：配置了 `DEEPSEEK_API_KEY` 即走 DeepSeek，否则退回 OpenAI**；`AI_PROVIDER=deepseek|openai` 可强制
- **DeepSeek V4 模型目录（官方 api-docs 2026-08，`DEEPSEEK_MODELS`）**：

  | 模型 id | 版本 | 定位 | 峰时价（输入 miss / hit · 输出，$/M） | 并发 |
  |---|---|---|---|---|
  | `deepseek-v4-flash`（默认·推荐） | DeepSeek-V4-Flash-0731 | 1M 上下文，思考/非思考双模式，JSON 输出 | 0.44 / 0.014 · 1.32 | 2500 |
  | `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 旗舰推理（HLE 42.7/60.0），价格 ×3 | 1.32 / 0.044 · 3.96 | 500 |
  | `deepseek-v4-flash-vision-exp` | 实验 | 多模态，文本能力同 Flash | 同 Flash | 2500 |

  谷时（非 UTC 01–04 / 06–10 工作日）半价。旧名 `deepseek-chat` / `deepseek-reasoner` **官方 2026-07-24 已停用**，系统自动映射为 `deepseek-v4-flash`（reasoner → 思考 low）并在校验时给出提示
- **DeepSeek 思考模式（`DEEPSEEK_THINKING` = off | low | high | max）**：请求体 `{"thinking":{"type":"enabled"},"reasoning_effort":"low"}`（off 时 `type:"disabled"`，此时 `temperature` 才生效）；返回 `reasoning_content`（思维链）与 `content`（JSON 结论）分离，思维链存 `ai_forecasts.cot`，`usage.completion_tokens_details.reasoning_tokens` 存 `reasoning_tokens`。**实测（本沙箱）**：v4-flash 非思考 **1.4s**（校验小任务）/ **3.3s**（正式预测官上下文）；v4-flash 思考 low 5.6s；v4-pro 思考 low 9.5–12.6s。1 分钟厅建议 off；三分/五分厅可用 low/high
- **报单窗口（20 秒硬截止）**：`AI_LEAD_MS`（默认 20000）—— AI 必须在「下期理论开奖时刻 − 20s」之前锁定 500 注；`aiKick` 把 `lockByMs` 传给 `forecastFor`，调用超时被裁剪为 `min(AI_TIMEOUT_MS, 剩余预算)`，预算不足 3s 则直接跳过（`error=skipped: lock window`）并由「组合最优」500 注兜底——**保证截止前一定有单可报**。`/ai` 页倒计时下方实时显示「报单窗口 剩 Ns / AI 须在 Ns 内锁定 / 超出截止·将用兜底」
- **环境变量**：`DEEPSEEK_API_KEY`（推荐）、`DEEPSEEK_BASE_URL`（默认 https://api.deepseek.com）、`DEEPSEEK_MODEL`（默认 deepseek-v4-flash）、`DEEPSEEK_THINKING`（默认 off）；备用 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `AI_MODEL` / `AI_EFFORT`；`AI_LEAD_MS`（报单窗口，默认 20000）、`AI_TIMEOUT_MS`（单次调用上限，默认 25000）、`AI_REPORT_EVERY`（自动报告节奏，默认 0 = 关闭）。本地写在 `.dev.vars`（已 gitignore），生产用 `wrangler pages secret put`

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
| GET | `/api/arena/ai?source=&limit=` | **AI 预测官**逐期记录：regime / confidence / reasoning / next_focus / boost / avoid / pos_weights / strategy_blend + 结算 actual/hit/rank/pnl + tokens/latency/error |
| GET | `/api/arena/report?source=` | 最新一份 AI 分析官报告（Markdown） |
| POST | `/api/arena/report?source=` | 基于当前全部战绩生成 AI 分析官报告（同一结算期缓存）；随后自动编译规则，返回 `plans_added` / `plans_error` |
| GET | `/api/arena/plans?source=` | **AI 建议回测**：active[]（规则 DSL + 人话描述 + 样本内/样本外统计）/ retired[]（含 retire_reason）/ builtin（内置 6 套 key） |
| POST | `/api/arena/plans/:id/retire?source=` | 手动退役一条 AI 规则 |

| POST | `/api/ai/backfill-subsets?source=&n=300` | 由 ai 行回填 ai-100/150/300 + 当前自定义档位历史（幂等） |
| GET | `/api/ai/tier-digest?source=` | AI 自学习摘要：各档位全量/近 60 期战绩 + 命中位次分布（即每期喷给模型的 `your_tier_performance`） |
| GET | `/api/draws/coverage?source=&days=7` | 开奖完整性报告：逐日 已记录/应有、链上补数、缺失期号、最近补齐日志 |
| POST | `/api/draws/gapfill?source=&days=7&max=20` | 扫描缺失期并从 TRON 链按「分钟 +3s 首块」规则补齐（`src='chain'`） |
| GET | `/api/arena/stake-curve?source=&strategies=ai,top3,…&limit=2000` | 注数回测：`strategies[]{strategy, periods, curve[]{N, n, hits, rate, breakeven, edge, z, pnl, roi}, best_N, best_roi}` |
| GET | `/api/sync/alerts?source=` | 拉取告警：`open` 未解决数 + `alerts[]{kind fetch_fail\|recovered, detail, created_ms, resolved_ms}` |
| GET | `/api/top3/pick?source=&history=12\|30\|60` | 优质策略推荐：`current{expect, based_on, status, created_ms, members[]{key,name,short,color,desc,z,rate,n,hits,w,numbers[500]}, fused[500], count, overlap[], consensus_all}` + `record{n,hits,rate,pnl,streak[20]}` + `leaderboard[]{key,short,z,n,rate,eligible,total}` + `rules{min_n,min_z,ai_wait_ms,candidates}` + `history[]{expect,numbers,actual,hit,rank,pnl,open_ms,members[]{key,short,z,w,hit,rank}}`；缓存 20s |
| POST | `/api/top3/backfill?source=&n=100` | 回放补齐 top3 历史（幂等） |
| GET | `/api/ai/self-check?source=&n=10` | 与上游 API 逐字段对账：`summary{upstream_latest, local_latest, in_sync, compared, all_match, mismatches, pending_expect, pending_based_on, expected_next, pending_ok, upstream_ms, server_now_bj}` + `rows[]{expect, upstream{opennumber,openTime,block}, local{…}, ai{based_on, actual, hit, rank, scored, locked_bj}, ok, diffs[]}` |
| GET | `/api/ai/sync-audit?source=&n=30` | 报单同步审计：`summary{n, locked_in_time, locked_in_time_rate, ai_success, fallback, margin_open_min_s, margin_open_avg_s, lead_ms, heartbeat_alive}` + `items[]{expect, model, trigger, latency_ms, started_after_prev_s, locked_after_prev_s, margin_to_lock_s, margin_to_open_s, ok, error, hit}` |
| GET | `/api/config` | 配置快照：`items{KEY:{value(密钥打码), source db\|env\|none, set, updated_ms}}` + `effective{provider, model, base}` |
| PUT | `/api/config` | body `{KEY: value \| null}`（白名单键；null/空 = 删除页面配置；数值范围校验） |
| POST | `/api/config/validate` | body 可带草稿 `{AI_PROVIDER, DEEPSEEK_API_KEY, …, rounds}`；返回 `result{ok, provider, model, base, stage auth\|chat, error, models[], model_listed, chat_latency_ms[], chat_avg_ms, usage, sample, balance, warn}` |
| GET | `/api/arena/pick?source=&history=12\|30\|60` | **本期 AI 推荐（/ai 页数据源，缓存 20s）**：顶层 `provider / model / lead_ms / interval_ms`；`pick{expect, based_on, status ready/thinking/fallback, numbers[500], coverage, guard{k,min_z,z,n,active}, subsets[]{key,n_pick,breakeven,numbers,record}, forecast{regime, confidence, reasoning, pick_plan, pos_weights, strategy_blend, boost, avoid, next_focus}, breakdown{pos_count, pos_focus, shape, wan, sum_big, blend, boost_in, avoid_out, consensus[]}, model, latency_ms, tokens, created_ms}` + `record{n, hits, rate, pnl, streak[20]}` + `sync{n, in_time, avg_lock_s, max_lock_s, heartbeat_alive}` + `history[]{expect, numbers, count, actual, hit, rank, pnl, open_ms, regime, confidence, reasoning, pick_plan, boost}` + `cached / cache_age_ms / compute_ms`；响应头 `X-Cache` |

> `/api/arena/board` 的 `plans[]` 现包含 `ai:true` 行（`plan_id / report_expect / rationale / forward{bets,hits,rate,z,pnl,roi,max_dd} / since_index`），`ai` 字段新增 `report_every` / `plans_retired_now`（本期 pick 已移至 `/api/arena/pick`，board 不再内嵌）；board 也带 `cached / cache_age_ms / compute_ms / timing`。
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
- **最后更新**: 2026-09-05

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
