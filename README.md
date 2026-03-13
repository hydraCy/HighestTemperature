# Polymarket Shanghai Highest Temperature Research & Trading Decision Platform

A single-user, read-only decision assistant for Polymarket Shanghai daily-high-temperature markets.

This system does **not** auto-trade, does **not** connect wallets, and does **not** use private keys.

Core outputs:

- `Decision` (`BUY / WATCH / PASS`)
- `Position`
- `Reason`

## Current Scope

- City scope: `Shanghai` only
- Resolution standard: `Shanghai Pudong International Airport Station (ZSPD)`
- Resolution source: Wunderground rules/path as specified by Polymarket market rules

## Core Principle

This platform is not a generic weather app. It is a market-resolution research tool:

`Polymarket rules -> Resolution Station -> Resolution Source -> Final Value`

Auxiliary weather feeds are used for estimation only and are clearly labeled as non-final settlement data.

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma + SQLite
- Recharts
- Zod
- date-fns

## Key Features

- Real-time Polymarket market board for Shanghai highest-temperature events
- Automatic market selection with trading-day priority:
  - Prefer today's Shanghai market if still tradable
  - Switch to tomorrow only when today's market is closed/inactive
- Multi-source weather assist integration
- Model probability + market price + EV output
- Position sizing and risk-adjusted decision output
- Snapshot logging for replay/review
- Historical source-bias tracking (forecast vs settled value)
- Bilingual UI support (`?lang=zh` / `?lang=en`)

## Real-Time Decision Mode

Default behavior is `realtime`:

- Every page visit recalculates with latest market + weather data
- Every manual refresh recalculates decision immediately
- No daily lock-in or reused stale decision

## Trading Engine

Path: `/src/lib/trading-engine`

- `types.ts`
- `edge.ts`
- `timingScore.ts`
- `weatherScore.ts`
- `dataQuality.ts`
- `riskEngine.ts`
- `positionSizer.ts`
- `model.ts`
- `tradingEngine.ts` (`runTradingDecision`)

Main formulas:

- `Edge = ModelProbability - MarketPrice`
- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

Decision mapping:

- `<60 -> PASS`
- `60-75 -> WATCH`
- `>75 -> BUY`

Position sizing:

- `MaxTradeSize = totalCapital * maxSingleTradePercent`
- `BasePosition = MaxTradeSize * EdgeMultiplier`
- `PositionSize = BasePosition * RiskModifier`

## Database Models

Defined in `prisma/schema.prisma`:

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

## Main Pages

- `/`
  - Resolution Standard Card
  - Market Board
  - Model Board
  - Decision / Position / Reason
  - Full bin table
- `/market/[slug]`
  - Bin edges
  - Temperature/edge charts
  - Snapshots and notes
  - Source bias table

## Jobs and Refresh

Node cron (`npm run jobs`):

- Market update: every 5 minutes
- Weather update: every 10 minutes
- Model run: every 5 minutes
- Settled sync: daily at 01:10

Manual:

- `POST /api/refresh`
- `POST /api/jobs/run` with `job=market|weather|model|settled|all`
- `npm run job:once -- all`
- `npm run job:once -- market`
- `npm run job:once -- settled`

## Local Setup

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

`npm run db:seed` now only clears historical rows and does not insert any demo/mock data.

## Port Behavior (3000 / 3001)

- `npm run dev` defaults to `3000`
- If `3000` is occupied, Next.js automatically falls back to `3001`
- Always use the URL shown in terminal logs

## Environment Variables

See `.env.example`:

- `DATABASE_URL`
- `POLYMARKET_API_BASE`
- `POLYMARKET_EVENT_SLUG` (optional manual override)
- `POLYMARKET_TIMEOUT_MS`
- `TOTAL_CAPITAL`
- `MAX_SINGLE_TRADE_PERCENT`
- `MIN_EDGE_TO_TRADE`
- `MIN_UPSIDE_TO_TRADE`
- `MIN_SIDE_PROB_TO_TRADE`
- `TRADING_COST_PER_TRADE`
- `SKIP_NEAR_CERTAIN_PRICE`
- `DECISION_POLICY`
- `WEATHER_STRICT_SOURCES`
- `BIAS_LOOKBACK_DAYS`
- `BIAS_MIN_TOTAL_SAMPLES`
- `BIAS_MIN_SOURCE_SAMPLES`
- `WEATHERAPI_KEY` (optional)
- `WEATHERAPI_API_BASE` (optional)
- `QWEATHER_API_KEY` (optional)
- `QWEATHER_API_BASE` (optional)

## Real Data Policy

The platform is configured for real data (no fake fallback for core decision outputs):

- Polymarket market APIs
- Wunderground/Weather.com real-time observations + 1-3h nowcasting (ZSPD) as primary short-term decision input
- Learned peak-temperature window from latest 30-day ZSPD history (used by timing score)
- Free weather sources: Open-Meteo / wttr.in / met.no
- Optional paid weather sources: WeatherAPI / QWeather
- Wunderground/Weather.com historical observations for settlement sync

If external sources fail:

- jobs may error or degrade with explicit warnings
- UI shows source-level status and error reasons
- strict source mode can force `PASS` with `position=0`

Default strict weather source requirement:

- `WEATHER_STRICT_SOURCES=open_meteo,wttr,met_no`

## Station Binding

Both weather assist and resolution context are fixed to:

- `Shanghai Pudong International Airport Station`
- `ZSPD`
- Coordinates: `31.1443, 121.8083`

## Tests

```bash
npm run test
```

Includes core coverage for:

- bin parsing
- probability normalization
- edge calculation
- timing/weather/data quality scoring
- risk modifier and position sizing
- `runTradingDecision` output shape

## Source Bias Report (30d)

Run:

```bash
npm run compare:openmeteo-wu
```

This script now reports rolling 30-day bias stats for all configured sources (`open_meteo`, `wttr`, `met_no`, `weatherapi`, `qweather`) using stored settlement comparisons, including:

- sample size
- mean bias
- MAE / RMSE
- exact-hit / within-1C hit rates
- bias factor and reliability score
