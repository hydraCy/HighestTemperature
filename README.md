# Polymarket 上海最高温研究与交易决策平台

单用户、只读、交易辅助平台。

核心输出：

- `Decision` (`BUY / WATCH / PASS`)
- `Position`
- `Reason`

## 平台目标

系统不做自动下单，不接钱包，不接私钥。

系统核心逻辑：

`Polymarket rules -> Resolution Station -> Resolution Source -> Final Value`

天气数据仅为辅助估算，页面会明确提示：

`辅助天气数据不是最终结算依据`

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

当前仅支持：`Shanghai`（UI 为单选 Select，默认 Shanghai）。

## 交易引擎结构

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

### 关键公式

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

## 数据库表

`prisma/schema.prisma` 中包含：

- `markets`
- `market_bins`
- `resolution_metadata`
- `weather_assist_snapshots`
- `model_runs`
- `model_bin_outputs`
- `snapshots`
- `notes`
- `settled_results`

## 页面

- `/` 决策终端首页
  - Resolution Standard Card
  - Market Board
  - Model Board
  - Decision / Position / Reason
- `/market/[slug]` 市场详情
  - Bin Edge 表
  - 温度趋势图
  - Edge 图
  - Snapshot 与 Notes

## 刷新机制

Node cron（`npm run jobs`）：

- Market update: 每 5 分钟
- Weather update: 每 10 分钟
- Model run: 每 5 分钟
- Settled sync: 每天 01:10（抓取已过目标日的 Wunderground 结算温度）

并提供：

- 手动刷新：`POST /api/refresh`
- job API：`POST /api/jobs/run`，`job` 可选 `market|weather|model|settled|all`
- CLI 单次任务：`npm run job:once -- settled`

## 本地运行

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

## 环境变量

见 `.env.example`：

- `DATABASE_URL`
- `POLYMARKET_API_BASE`
- `POLYMARKET_EVENT_SLUG`
- `POLYMARKET_TIMEOUT_MS`
- `TOTAL_CAPITAL`
- `MAX_SINGLE_TRADE_PERCENT`
- `WUNDERGROUND_API_KEY`（可选）

## 真实数据说明

平台强制仅使用实时数据（无 mock 回退）：

- Polymarket 市场 API
- Open-Meteo 天气辅助 API
- wttr.in 天气辅助 API（用于交叉验证）
- Wunderground/Weather.com 历史观测（用于前一日/历史市场结算温度）

若 Polymarket 或天气源都失败，任务会直接报错，页面会显示告警，不会悄悄展示假数据。

## 种子数据

Seed 默认写入 Shanghai 市场、resolution metadata、weather assist、model run、snapshot、note、settled result。

## 测试

```bash
npm run test
```

包含：

- bin parsing
- probability normalization
- edge 计算
- timing / weather / data quality 评分
- risk modifier / position sizing
- runTradingDecision 输出结构
