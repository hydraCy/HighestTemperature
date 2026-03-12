# Polymarket 上海最高温研究与交易决策平台

单用户、只读、交易辅助平台（不自动下单、不接钱包、不接私钥）。

核心输出：

- `Decision` (`BUY / WATCH / PASS`)
- `Position`
- `Reason`（中英双语）

## 当前版本重点

- 自动抓取上海最高温盘口（优先“当日仍在交易”的盘口；若当日已关闭再切次日）
- 盘口、模型、EV、仓位建议一体化展示
- Wunderground 口径结算抓取（历史/前一日）
- 前一日多源预测偏差记录（用于持续优化）
- 页面支持中英切换：`中文 / EN`

## 核心原则

系统目标不是“做天气站”，而是辅助判断：

`Polymarket rules -> Resolution Station -> Resolution Source -> Final Value`

页面明确提示：辅助天气数据不是最终结算依据。

## 技术栈

- Next.js App Router
- TypeScript
- TailwindCSS
- shadcn/ui
- Prisma + SQLite
- Recharts
- Zod
- date-fns

## 单城市策略

当前只支持：`Shanghai`。

## 自动盘口选择（重要）

默认行为（已修正为交易日优先）：

- 先尝试匹配“今天”上海最高温盘口（按 `Asia/Shanghai`）
- 若今天盘口仍可交易，则市场+天气+模型全部使用今天目标日
- 只有当今天盘口关闭/不可交易时，才自动切换到明天盘口
- 若 slug 直连失败，再回退到 events/markets 列表搜索

可选覆盖：

- 设置 `POLYMARKET_EVENT_SLUG` 可手工固定某个事件
- 不设置则保持自动交易日模式（推荐）

## 实时决策模式

当前默认是 `realtime`：

- 每次进入页面都会基于最新盘口+天气重新计算决策
- 每次点击刷新都会重新计算决策
- 不做日内锁定，不复用旧决策

## 交易引擎

路径：`/src/lib/trading-engine`

- `types.ts`
- `edge.ts`
- `timingScore.ts`
- `weatherScore.ts`
- `dataQuality.ts`
- `riskEngine.ts`
- `positionSizer.ts`
- `model.ts`
- `tradingEngine.ts` (`runTradingDecision`)

关键公式：

- `Edge = ModelProbability - MarketPrice`
- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

决策映射：

- `<60 -> PASS`
- `60-75 -> WATCH`
- `>75 -> BUY`

仓位：

- `MaxTradeSize = totalCapital * maxSingleTradePercent`
- `BasePosition = MaxTradeSize * EdgeMultiplier`
- `PositionSize = BasePosition * RiskModifier`

## 双语能力

- 顶部语言切换：`中文 / EN`
- 首页与详情页文案双语
- 风险标签双语
- 模型解释双语（`reasonZh / reasonEn`）

URL 方式：

- 中文：`/?lang=zh`
- 英文：`/?lang=en`

## 数据库表

`prisma/schema.prisma`：

- `markets`
- `market_bins`
- `resolution_metadata`
- `weather_assist_snapshots`
- `model_runs`
- `model_bin_outputs`
- `snapshots`
- `notes`
- `settled_results`
- `forecast_source_biases`（前一日各源 vs 结算偏差）

## 页面

- `/` 首页（终端主视图）
  - Resolution Standard Card
  - Market Board
  - Model Board
  - Decision / Position / Reason
  - 全部盘口（Bin）
- `/market/[slug]` 市场详情
  - Bin Edge 表
  - 温度趋势图
  - Edge 图
  - Snapshot 与 Notes
  - 前一日各源偏差表（免费源/付费源）

## 刷新与任务

Node cron（`npm run jobs`）：

- Market update: 每 5 分钟
- Weather update: 每 10 分钟
- Model run: 每 5 分钟
- Settled sync: 每天 01:10（抓取已过目标日的 Wunderground 结算温度）

手动：

- `POST /api/refresh`
- `POST /api/jobs/run`，`job` 可选 `market|weather|model|settled|all`
- `npm run job:once -- all`
- `npm run job:once -- market`
- `npm run job:once -- settled`

## 本地运行

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

## 端口说明（3000 / 3001）

- 默认 `npm run dev` 使用 `3000`
- 若 `3000` 被占用，Next.js 会自动切到 `3001`
- 终端启动日志会显示最终地址（以日志为准）

## 环境变量

见 `.env.example`：

- `DATABASE_URL`
- `POLYMARKET_API_BASE`
- `POLYMARKET_EVENT_SLUG`（可选，手动覆盖用）
- `POLYMARKET_TIMEOUT_MS`
- `TOTAL_CAPITAL`
- `MAX_SINGLE_TRADE_PERCENT`
- `WUNDERGROUND_API_KEY`（可选）
- `MIN_EDGE_TO_TRADE`
- `MIN_UPSIDE_TO_TRADE`
- `TRADING_COST_PER_TRADE`
- `DECISION_POLICY`

## 真实数据说明

平台默认使用真实数据（无 mock 回退）：

- Polymarket 市场 API
- 免费源：Open-Meteo / wttr.in / met.no
- 付费源：WeatherAPI / QWeather（可选增强）
- Wunderground / Weather.com 历史观测（结算温度）

如果外部源失败：

- 任务会报错或降级提示
- 页面显示告警
- 不会悄悄展示伪造盘口数据
- 严格模式下，只要“必需天气源”里有任一缺失，会强制 `PASS`（仓位=0）

`WEATHER_STRICT_SOURCES` 默认值：

- `open_meteo,wttr,met_no`（免 key 可跑）
- 如你希望更严格，可加付费源：
- `open_meteo,wttr,met_no,weatherapi,qweather`

## 站点绑定（重要）

辅助天气源与结算口径都固定绑定到：

- `Shanghai Pudong International Airport Station`
- `ZSPD`
- 坐标：`31.1443, 121.8083`

这用于确保“研究对象”尽量贴近 Polymarket 规则指定站点。

## 测试

```bash
npm run test
```

覆盖：

- bin parsing
- probability normalization
- edge 计算
- timing / weather / data quality 评分
- risk modifier / position sizing
- runTradingDecision 输出结构
