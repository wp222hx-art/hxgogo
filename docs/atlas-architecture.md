# 图谱板块架构准备

状态：此文保留初期设计评估，不代表当前实现状态。0.3.1 已实现的共用数据库、版本触发器和自动同步见 [数据同步说明](atlas-sync.md)。初期评估如下：基于当前 0.2.0 工作区；截图对应的视图目录由截图分析结果补充。本文将新板块暂称“图谱工作台”（路径 `/atlas`）。

## 1. 结论

新增独立页面、独立图标入口和独立 API 命名空间，在后端把现有开奖记录转换成统一数据结构。首版直接读取现有 SQLite 的同一份数据，并复用既有同步任务，不另建一套抓取和开奖数据库。

首版可用来源只注册已实际接通的 5 个官方来源；`local:five` 可作为标有“本地五位演示”的可选来源。有号码规则定义不等于有可用数据。快三、3D、排列3、11选5等应在接入实际数据、校验规则与排序含义后才成为“已接入”来源，不能用五位数据改名展示。

现有核心模型和表结构绑定 5 个数字。扩展彩种应通过适配器承接，不能把三位号码补零后写入现有 `draws`，也不能让新图表默认继承现有五位预测逻辑。

## 2. 已核实的接入点

| 文件 / 位置 | 目前职责 | 最小接入方式 |
| --- | --- | --- |
| `src/index.tsx:1–29`、`:1237–1243` | 页面导入与 7 个页面路由 | 引入 `page_atlas.ts` 并注册 `GET /atlas`；API 可挂载独立 Hono 子路由 |
| `src/page_ai.ts:66` | AI 页导航 | 加一个带独立 SVG 图标的“图谱”入口 |
| `src/page_analysis.ts:55`、`src/page_arena.ts:53` | 分析与竞技场导航 | 同入口，避免只在一个页面可达 |
| `src/page_query.ts:43`、`src/page_top3.ts:46`、`src/page_settings.ts:44`、`src/page.ts:26` | 其余页面导航 | 同入口；现有导航重复，可新增小型公共入口函数，首版不必重写所有页头 |
| `desktop/main.cjs:167` | 原生“工作台”菜单 | 新菜单项调用 `showPage('/atlas')` |
| `desktop/main.cjs:190` | 托盘菜单 | 可加“打开图谱”；主导航和原生菜单已足以完成基本入口 |
| `desktop/main.cjs:201` | 桌面截图与运行检查 | 把 `/atlas` 纳入验证，检查默认视图、无数据、切来源、切视图 |
| `desktop/service.ts:9–20`、`:60–67` | CDN 本地化、静态目录、Hono 转发 | 已能服务 `/static/*` 并透传新路由；使用已打包的 ECharts/字体时不需放宽 CSP |
| `desktop/main.cjs:300` | `hashplay://app` 同源代理 | 新页面继续调用相对路径 `/api/atlas/...`；无需新增 IPC 或暴露端口/令牌 |
| `desktop/build.mjs:10–18`、`:26` | 复制 public、内置库、生成 CSS | 平铺 `public/static/atlas.js` 与 `atlas.css` 自动复制；如果 JS 放子目录，要把 Tailwind 扫描从 `*.js` 改为递归 |
| `desktop/tests/desktop.test.mjs:47` | 页面与本地资源验证 | 添加新页面、CSS、JS、图标的 HTTP/离线检查 |
| `src/sync.ts:5`、`:85`、`:196` | 真实来源、同步、读取 | 新适配器读取这些定义及 `loadDraws`；不重复抓取 |
| `src/period.ts` | 六个已知来源的上海周期日历 | 现有来源适配器调用它；未来来源不能套用这些固定间隔和日期序号规则 |

建议新增文件：

- `src/page_atlas.ts`：页面骨架，不放数据采集和指标公式。
- `src/atlas/contracts.ts`：公共数据契约与运行时校验边界。
- `src/atlas/sources.ts`：来源注册表、现有五位来源适配器。
- `src/atlas/routes.ts`：目录、同一批数据快照接口。
- `src/atlas/metrics.ts`：纯统计计算；只在多个图表确实复用时抽公共函数。
- `src/atlas/views.ts`：截图视图目录、分组、所需能力、默认参数、规则说明。
- `public/static/atlas.js`、`atlas.css`、`atlas.svg`：交互、样式和独立入口图标。
- `desktop/tests/atlas.test.mjs`：契约、计算与主要页面行为的必要验证。

## 3. 当前真实 API 与限制

| 现有接口 | 可复用数据 | 注意事项 |
| --- | --- | --- |
| `GET /api/sources` | 6 个已登记来源、名称、代码、间隔、链、同步元数据、数量 | 不是通用彩种目录；来源来自代码白名单 |
| `GET /api/draws?source=...&limit=...` | 最近最多 1000 条五位记录，附五位 outcomes | 最新在前；会按既有节拍尝试同步。不是分页历史 API |
| `GET /api/sync/status?source=...` | 新鲜度、最新期号、预计发布、数据版本 | 不带 `tick=1` 才是纯状态读取 |
| `POST /api/sync?source=...&force=1` | 手动审计同步 | 会写数据库，应只由明确的同步动作调用；新模块不再启动一份计时抓取器 |
| `GET /api/draws/coverage` | 来源周期覆盖率、缺期与补数记录 | 支持的周期仍由现有来源规则决定 |
| `GET /api/analysis/kline` | 数字频率蜡烛、遗漏等 | 固定 0–9 / 五位；“任意位”当前频率的分母是位置次数，不等于每期开奖至少出现一次的概率 |
| `GET /api/analysis/parity` | 单双累计指数及 BOLL/MACD/KDJ | 固定五位位置，带原有信号/历史评估；新图谱只可复用明确的数学变换，不能把未经校准信号当概率 |
| `GET /api/qkltj/raw` | 已登记来源的上游原文 | 仍只允许 5 个官方 code，不是任意 URL 代理 |
| `GET/PUT /api/config` | AI 提供商和分析参数 | 当前没有通用开奖源地址、响应映射、CSV/JSON 导入设置 |

特别需要避免：`public/static/sync.js:43` 的 `poll()` 默认携带 `tick=1`，`src/index.tsx:367` 会同步、记录策略、生成/结算竞技场，并可能触发 AI。新图谱页应使用纯状态读取和后台已有数据，或为公共刷新器明确新增无此副作用的模式，不能直接照搬默认挂载。

当前不存在开放的本地“写入任意开奖”接口、CSV/JSON 导入接口、通用自定义数据源注册接口。后端只监听随机的 `127.0.0.1` 端口，并要求应用私有令牌；其他本机程序也不能直接把这个端口当公共 API 使用。未来需要本机第三方接入时，应单独设计认证与导入入口，不撤掉应用现有保护。

## 4. 建议的 v1 统一数据契约

以下是新增契约草案，不是已有 API 文档。关键原则：`sourceId` 标识数据来源，`gameId` 标识号码规则；二者不能混用。同一规则可以有多个来源，同一供数 API 可以供应多个规则。

~~~ts
type SourceState = 'ready' | 'empty' | 'unconfigured' | 'unsupported' | 'error';

interface NumberSchemaV1 {
  id: string;                  // 例如 digits-5/v1；定义变更必须换版本
  length: number;
  min: number;
  max: number;
  displayWidth: number;         // 11选5可显示01，但数据仍是数字1
  repeats: 'allowed' | 'forbidden';
  positionSemantics: 'fixed' | 'draw-order' | 'none';
  positionLabels: string[];     // fixed/draw-order时长度必须等于length
  providerOrder: 'preserved' | 'ascending' | 'unknown';
}

interface SourceDescriptorV1 {
  sourceId: string;             // 保留现有qkltj:6001等，不自行拼新API代码
  title: string;
  gameId: string;
  adapterId: string;            // existing-five/v1
  state: SourceState;
  reason?: string;              // 未接入/数据为空/解析失败的具体原因
  schema: NumberSchemaV1;
  calendar: {
    kind: 'fixed-interval' | 'scheduled' | 'opaque';
    timezone: string;
    intervalMs: number | null;
    supportsNextPeriod: boolean;
  };
  capabilities: string[];       // 由规则和实际数据保证，不凭彩种名称猜测
}

interface DrawRecordV1 {
  sourceId: string;
  periodId: string;             // 不透明原期号，禁止UI层统一BigInt+1
  numbers: number[];            // 保留源顺序，不自动排序、不补位
  drawTimeMs: number | null;    // 事件/周期时间，不等于抓取时刻
  publishedAtMs: number | null;
  observedAtMs: number | null;  // 老数据没有真实首次观察时间时必须null
  provenance: {
    kind: 'provider' | 'chain-backfill' | 'local';
    block: number | null;
    hash: string | null;
    mismatch: boolean;
  };
}

interface DrawSnapshotV1 {
  schemaVersion: 1;
  source: SourceDescriptorV1;
  revision: string;             // opaque token；包含同步修正与重启边界
  generatedAtMs: number;
  order: 'ascending';
  rows: DrawRecordV1[];
  nextPeriod: { periodId: string; estimatedAtMs: number | null } | null;
  quality: {
    rejectedRows: number;
    missingPeriods: number | null; // 无可靠日历时为null
    freshness: 'fresh' | 'stale' | 'unknown';
  };
}
~~~

现有五位适配方式：

- `numbers` 来自真实 `n1…n5`，先执行整数、范围、长度校验。必要的旧记录 hash 恢复必须标明来源；不能无声替换显式无效的号码。
- `publishedAtMs` 对应现有 `open_ms` 的上游发布/统计时刻；`drawTimeMs` 可用已验证的 `periodTimeMs` 表示周期边界，并在来源说明注明含义。两者都不能冒充用户设备的首次接收时刻。
- 现有表没有每条记录的首次入库时刻，`observedAtMs=null`。不能使用 `sync_meta.last_ok_ms` 反填每条历史记录。
- `dataVersion(source)` 是进程内计数。快照 revision 应带会话/服务启动标识，或未来使用持久化修订号，避免重启后旧令牌碰巧相同。
- API 先按现有顺序取最近 N 条，统一校验后转为时间升序，只转换一次；所有图表使用同一个快照 revision。
- 不将 `hash` 或 `block` 设为跨彩种必填项。

后端适配器建议只负责三件事：

~~~ts
interface DrawSourceAdapterV1 {
  descriptor(sourceId: string): SourceDescriptorV1 | null;
  readSnapshot(db: D1Database, sourceId: string, opts: {
    limit: number;             // 首版20…1000
  }): Promise<DrawSnapshotV1>;
  // 后续确有不同历史存储时，再加不透明游标；首版不承诺不存在的全历史分页
}
~~~

最小新增 HTTP 接口：

- `GET /api/atlas/catalog`：已接入来源、号码规则、视图目录及不可用原因。
- `GET /api/atlas/snapshot?source=...&limit=...`：返回同一批原始记录和质量信息；纯读取，不顺带生成 AI/策略。
- 手动刷新可复用已存在的 `POST /api/sync`，随后重新读取 snapshot。后端自动同步仍由现有任务负责。

每个 view 声明 `id/title/group/requiredCapabilities/parameterSchema/defaultParams`。计算器接受标准快照与经过校验的参数，渲染器接受计算结果；渲染器不认识供应商地址和 API 密钥。未来新 API 只新增适配器和规则，现有图表即可按能力复用。

## 5. 不同号码规则的扩展边界

| 规则族（仅规则示例） | 数据结构能力 | 必须区别处理 |
| --- | --- | --- |
| 已有五位 0–9 | 5 个数字、允许重复、固定万千百十个 | 单位频率与整期出现率不能共用分母 |
| 3D / 排列3 | 3 个 0–9、允许重复、固定百十个 | 来源、期号、开奖日历独立；不假定同一个接口或固定24小时周期 |
| 快三 | 3 个 1–6、允许重复 | 若官方不保证独立骰子位置，关闭定位走势；可做和值/跨度/重复形态 |
| 11选5 | 5 个 1–11、禁止重复 | 未经验证的开奖先后顺序不能当定位顺序；无放回概率不能套用独立0–9模型 |

支持能力应由参数化规则生成，例如数字频率、遗漏、和值、跨度、奇偶、余数分类、重复形态、位置比较。大小划分、和尾、质合、连号等各自需要明确可展示的定义，不把已有五位阈值直接复制到新规则。0和1的质合归属等非数学标准用法要由规则明确说明。

理论基线只在抽样机制和事件定义明确时提供，否则为 null。和值、豹子/对子、无放回抽取等事件不能简单使用“1/分类数量”作为基线。共享区块的数据也不能叠加成独立样本量。

未来接入额外存储时，可加独立通用表保存 `source_id/period_id/schema_id/numbers_json/draw_time/published_at/observed_at/provenance/revision`；保留现有 `draws` 供旧功能读取。首版现有来源适配无需迁移数据库。

未来自定义 JSON/CSV 数据来源配置应包含：来源标识、规则、明确的时间/期号字段映射、号码字段映射、记录数组位置，以及错误样本预览。只能映射数据，不执行用户输入脚本。远端地址和必要认证由后台适配器管理，前端继续只访问同源业务接口。现有保险库只支持 OpenAI/DeepSeek 两种键名，额外供数凭据应扩展独立命名空间，不能借用 AI key 字段。

## 6. 图表实现与验证建议

当前已本地打包 ECharts 5.5、Chart.js 4.4 和 Font Awesome 6.4，分析页已经混用 Chart.js 与 ECharts Canvas。新模块优先统一用现有 ECharts 处理曲线、柱状、热力、蜡烛；密集期号/遗漏点阵可使用可滚动表格或 Canvas。独立 SVG 入口图标可以直接编写，无需引入图片生成或新框架。

首版渲染仅实例化当前打开的视图，不同时创建 77 个图表。切换视图销毁旧实例，窗口变化 resize，旧请求用 AbortController 取消或请求序号丢弃；切来源后必须清空旧图，不能让旧来源较慢的响应覆盖新选择。

图谱说明需显示：实际来源、规则版本、期间、样本数、缺期、统计单位和指标定义。由开奖编码生成的 K 线注明“统计指标”，不能标成真实交易价格或把涨跌图形描述为已验证的下一期优势。

必要验证：

1. 同一快照不同图表显示相同来源、首末期和样本范围。
2. 五位数据保留前导0的显示含义，重复号码不会被全局去重。
3. 缺失、无效、过期、未接入来源有明确状态；不会用其他彩种结果填充。
4. 定位/重复形态等不适配的视图禁用并说明原因。
5. 首版数学计算用短的手算样本核对，覆盖跨日与缺期，不靠截图相似度证明正确。
6. 本地页面、脚本、CSS、SVG、ECharts 无外部资源依赖；新页加载不额外触发 AI。
7. 运行源码测试与桌面截图验证；最终安装包再检查新图标入口与实际图谱数据。
