# HashPlay · 链上哈希可验证公平游戏演示平台

## 项目概述
- **名称**: HashPlay
- **定位**: 复刻「哈希竞猜」类玩法的完整机制，但 **只用虚拟积分、无任何支付/充提通道**。核心价值是演示 **Provably Fair（可验证公平）** 机制：每一局结果都能被任何第三方离线复算。
- **免责**: 所有积分为虚拟数值，不可充值、提现，不具货币价值。哈希输出不可预测，历史走势对未来无预测意义。

## 在线地址
- **沙箱预览**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai
- **量化分析中心**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai/analysis
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
- **多维图表**（Chart.js）: 全市场倾向卡片、集成概率 vs 基线、20 机制回测横向条形图、五位×数字频率热力图、当前遗漏热力图、总和分布 vs 理论卷积曲线、滚动 30 期大/单比率、24 小时时段分布、形态/龙虎 vs 理论、各市场最长连开
- **方法论声明**: 页面明示哈希为密码学随机数，回测命中率长期收敛于基线，分析仅为统计展示

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

## 数据架构
- **存储**: Cloudflare D1 (SQLite)
- **表**: `users` / `rounds` / `bets` / `draws`（统一格式开奖库：source+expect 主键，n1~n5）/ `sync_meta`（同步节流）
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
- **技术栈**: Hono + TypeScript + TailwindCSS(CDN) + D1
- **最后更新**: 2026-09-02

## 未实现 / 下一步建议
- [ ] 用户下注行为多维分析（按玩法/时段/筹码分布/跟随倾向 vs 命中）
- [ ] 机制参数可调（窗口长度、阈值）与自定义组合回测
- [ ] 独立的「离线验证器」静态页（粘贴 seed / bet_ids 即可在浏览器本地复算，不依赖服务端）
- [ ] 每局区块哈希附带 TronGrid 多节点交叉校验（防单节点数据异常）
- [ ] 房间参数后台可配（周期、赔率、限额）
- [ ] WebSocket/SSE 推送替代轮询（需 Durable Objects，BYOK 部署可选）
- [ ] 多语言 / 移动端手势优化
