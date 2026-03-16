# Polymarket 上海最高温研究与交易决策平台

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个面向 Polymarket 上海日最高温市场的单用户、只读研究与交易辅助平台。

- 不自动下单
- 不接入钱包与私钥
- 核心输出：`Decision` / `Position` / `Reason`

---

## 1）平台定位

本项目不是通用天气网站，而是围绕 Polymarket 结算规则构建的交易决策终端。

核心原则：

`Polymarket 规则 -> 结算站点 -> 结算来源 -> 最终值`

当前范围：
- 城市：`Shanghai`
- 站点：`Shanghai Pudong International Airport Station (ZSPD)`
- 结算口径：以 Polymarket 规则指定的 Wunderground 为准

---

## 2）功能概览

- 实时抓取 Polymarket 上海最高温盘口
- 自动目标日期切换：
  - 当天盘口可交易时优先当天
  - 当天进入结算窗口/关闭后切换到次日
- 多源天气融合（严格区分成功/失败，不伪造数据）
- 天气源策略层：`sourceKind` / 站点匹配 / 新鲜度 / 健康度
- 概率分布、Edge、风险标签、评分与决策
- 短临 Nowcasting 面板（当前 + 未来 1~6 小时）
- 快照记录与复盘
- 数据源偏差统计（用于校准）
- 中英双语界面（`?lang=zh` / `?lang=en`）

---

## 3）技术栈

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma + SQLite
- Recharts
- Zod
- date-fns
- node-cron

---

## 4）交易引擎

路径：`/src/lib/trading-engine`

核心模块：
- `tradingEngine.ts`（入口：`runTradingDecision`）
- `edge.ts`
- `timingScore.ts`
- `weatherScore.ts`
- `dataQuality.ts`
- `riskEngine.ts`
- `positionSizer.ts`
- `model.ts`

公式：
- `Edge = ModelProbability - MarketPrice`
- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

决策映射：
- `tradableEV > 0.06 -> BUY`
- `0.02 ~ 0.06 -> WATCH`
- `< 0.02 -> PASS`

---

## 5）数据源

### 市场
- Polymarket Gamma API

### 辅助天气源
- Wunderground/Weather.com（站点锚定）
- Open-Meteo
- wttr
- met.no
- WeatherAPI（可选）
- QWeather（可选）
- AviationWeather（METAR/TAF 短临风控）

说明：
- 辅助天气源不是最终结算依据。
- 外部源失败时会显示状态与原因，不会注入假数据。
- Open-Meteo 强制使用模型参数：`models=ecmwf_ifs04`。
- 权重公式：
  - `rawWeight = baseSourceWeight × matchScore × stationPenalty × accuracyScore × scenarioScore × regimeScore × freshnessScore × healthScore`

---

## 6）页面

- `/` 首页决策终端
- `/three-pm` 3PM 扫盘页
- `/market/[slug]` 市场详情页

---

## 7）数据库

结构文件：`/prisma/schema.prisma`

主要表：
- `markets`
- `market_bins`
- `resolution_metadata`
- `weather_assist_snapshots`
- `model_runs`
- `model_bin_outputs`
- `snapshots`
- `notes`
- `settled_results`
- `forecast_source_biases`

---

## 8）本地启动

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

`npm run dev` 会在启动前自动执行一次 `job:once -- all`。

---

## 9）常用命令

```bash
npm run dev
npm run typecheck
npm run test

npm run job:once -- all
npm run job:once -- market
npm run job:once -- weather
npm run job:once -- model
npm run job:once -- settled

npm run jobs
npm run compare:openmeteo-wu
```

---

## 10）环境变量

复制 `.env.example` 后按需配置。

重点变量：
- `DATABASE_URL`
- `POLYMARKET_API_BASE`
- `POLYMARKET_EVENT_SLUG`
- `MARKET_ROLLOVER_WINDOW_MINUTES`
- `TOTAL_CAPITAL`
- `MAX_SINGLE_TRADE_PERCENT`
- `WEATHER_STRICT_SOURCES`
- `ENABLE_NWS_HOURLY`
- `FUSION_EXCLUDED_SOURCES`
- `WEATHERAPI_KEY`
- `QWEATHER_API_KEY`
- `AVIATIONWEATHER_API_BASE`

---

## 11）端口说明

- 默认：`3000`
- 若被占用：自动切到 `3001`
- 以终端输出的 `Local:` 地址为准

---

## 12）调度

`npm run jobs`（node-cron）：
- 市场：每 5 分钟
- 天气：每 10 分钟
- 模型：每 5 分钟
- 结算同步：每天 01:10

手动接口：
- `POST /api/refresh`
- `POST /api/jobs/run`（`job=market|weather|model|settled|all`）

---

## 13）最终输出

- `Decision`：`BUY / WATCH / PASS`
- `Position`：建议仓位
- `Reason`：原因解释

---

## 14）免责声明

本项目仅用于研究与决策辅助，不构成投资建议。
