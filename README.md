# HashPlay · 链上哈希可验证公平游戏演示平台

## 项目概述
- **名称**: HashPlay
- **定位**: 复刻「哈希竞猜」类玩法的完整机制，但 **只用虚拟积分、无任何支付/充提通道**。核心价值是演示 **Provably Fair（可验证公平）** 机制：每一局结果都能被任何第三方离线复算。
- **免责**: 所有积分为虚拟数值，不可充值、提现，不具货币价值。哈希输出不可预测，历史走势对未来无预测意义。

## 在线地址
- **沙箱预览**: https://3000-il57p9yxvqhgd6vkrww2u-dfc00ec5.sandbox.novita.ai
- **生产环境**: 待部署（Cloudflare Pages）

## 已完成功能
### 两个开奖厅
| 厅 | 周期 | 封盘 | 随机源 | 验证方式 |
|---|---|---|---|---|
| TRON 区块厅 | 30s | 提前 6s | 波场公链真实区块哈希：取「时间戳 ≥ 本局截止时间的第一个区块」的 blockID | Tronscan 查区块即可核对 |
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

## 数据架构
- **存储**: Cloudflare D1 (SQLite)
- **表**: `users`（虚拟账户）/ `rounds`（局：承诺、种子、区块、结果、outcomes JSON）/ `bets`（注单）
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
- [ ] 独立的「离线验证器」静态页（粘贴 seed / bet_ids 即可在浏览器本地复算，不依赖服务端）
- [ ] 每局区块哈希附带 TronGrid 多节点交叉校验（防单节点数据异常）
- [ ] 房间参数后台可配（周期、赔率、限额）
- [ ] WebSocket/SSE 推送替代轮询（需 Durable Objects，BYOK 部署可选）
- [ ] 多语言 / 移动端手势优化
