# Polymarket Shanghai Temperature Research & Trading Decision Platform
# Polymarket 上海最高温研究与交易决策平台

A single-user, read-only research and trading-assist platform for Polymarket Shanghai daily max temperature markets.
一个面向 Polymarket 上海日最高温市场的单用户、只读研究与交易辅助平台。

- No auto-trading / 不自动下单
- No wallet/private key integration / 不接入钱包与私钥
- Core output / 核心输出: `Decision` / `Position` / `Reason`

---

## 1) Positioning / 平台定位

**EN**
This project is not a generic weather app. It is a decision terminal built around Polymarket resolution rules.

Core principle:
`Polymarket Rules -> Resolution Station -> Resolution Source -> Final Value`

Current scope:
- City: `Shanghai`
- Station: `Shanghai Pudong International Airport Station (ZSPD)`
- Resolution reference: Wunderground (as defined by Polymarket rules)

**ZH**
本项目不是通用天气网站，而是围绕 Polymarket 结算规则构建的交易决策终端。

核心原则：
`Polymarket 规则 -> 结算站点 -> 结算来源 -> 最终值`

当前范围：
- 城市：`Shanghai`
- 站点：`Shanghai Pudong International Airport Station (ZSPD)`
- 结算口径：以 Polymarket 规则指定的 Wunderground 为准

---

## 2) Features / 功能概览

**EN**
- Real-time Polymarket market fetch (Shanghai max temperature)
- Auto target-date rollover:
  - Use same-day market if still active
  - Switch to next-day market when closed/near settlement window
- Multi-source weather fusion (strict success/failure separation)
- Probability distribution, Edge, risk flags, score, decision
- Nowcasting panel (current + next 1–3h)
- Snapshot and replay support
- Source bias stats for calibration
- Bilingual UI (`?lang=zh` / `?lang=en`)

**ZH**
- 实时抓取 Polymarket 上海最高温盘口
- 自动目标日期切换：
  - 当天盘口可交易时优先当天
  - 当天进入结算窗口/关闭后切换到次日
- 多源天气融合（严格区分成功/失败，不伪造数据）
- 概率分布、Edge、风险标签、评分与决策
- 短临 Nowcasting 面板（当前 + 未来 1~3 小时）
- 快照记录与复盘
- 数据源偏差统计（用于校准）
- 中英双语界面（`?lang=zh` / `?lang=en`）

---

## 3) Tech Stack / 技术栈

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

## 4) Trading Engine / 交易引擎

Path / 路径: `/src/lib/trading-engine`

Main modules / 核心模块:
- `tradingEngine.ts` (entry / 主入口 `runTradingDecision`)
- `edge.ts`
- `timingScore.ts`
- `weatherScore.ts`
- `dataQuality.ts`
- `riskEngine.ts`
- `positionSizer.ts`
- `model.ts`

Formula / 公式:
- `Edge = ModelProbability - MarketPrice`
- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

Decision mapping / 决策映射:
- `< 60 -> PASS`
- `60 ~ 75 -> WATCH`
- `> 75 -> BUY`

---

## 5) Data Sources / 数据源

### Market / 市场
- Polymarket Gamma API

### Weather Assist / 辅助天气源
- Wunderground/Weather.com (station anchor / 站点锚定)
- Open-Meteo
- wttr
- met.no
- WeatherAPI (optional / 可选)
- QWeather (optional / 可选)
- AviationWeather (METAR/TAF for short-term risk / 短临风控)

**EN**
Assist weather sources are not the final settlement source.
If a source fails, status and reason are shown; no fake fallback data is injected.

**ZH**
辅助天气源不是最终结算依据。
外部源失败时会显示状态与原因，不会注入假数据。

---

## 6) Pages / 页面

- `/` Home terminal / 首页决策终端
- `/three-pm` 3PM scanner / 3PM 扫盘页
- `/market/[slug]` Market detail / 市场详情页

---

## 7) Database / 数据库

Schema file / 结构文件: `/prisma/schema.prisma`

Core tables / 主要表:
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

## 8) Local Setup / 本地启动

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

**EN**
`npm run dev` runs one initial `job:once -- all` before starting Next.js.

**ZH**
`npm run dev` 会在启动前自动执行一次 `job:once -- all`。

---

## 9) Useful Commands / 常用命令

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

## 10) Environment Variables / 环境变量

Copy `.env.example` and configure as needed.
复制 `.env.example` 后按需配置。

Important keys / 重点变量:
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

## 11) Port Notes / 端口说明

- Default / 默认: `3000`
- If occupied / 被占用时: fallback to `3001`
- Always use terminal `Local:` URL
- 以终端输出的 `Local:` 地址为准

---

## 12) Scheduling / 调度

`npm run jobs` (node-cron):
- Market / 市场: every 5 min
- Weather / 天气: every 10 min
- Model / 模型: every 5 min
- Settled sync / 结算同步: daily 01:10

Manual APIs / 手动接口:
- `POST /api/refresh`
- `POST /api/jobs/run` (`job=market|weather|model|settled|all`)

---

## 13) Final Output / 最终输出

- `Decision`: `BUY / WATCH / PASS`
- `Position`: suggested size / 建议仓位
- `Reason`: explanation in Chinese/English UI context / 原因解释

---

## 14) Disclaimer / 免责声明

**EN**
This project is for research and decision support only, not investment advice.

**ZH**
本项目仅用于研究与决策辅助，不构成投资建议。
