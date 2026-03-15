# Polymarket Shanghai Temperature Research & Trading Decision Platform

[English](./README.md) | [简体中文](./README.zh-CN.md)

A single-user, read-only research and trading-assist platform for Polymarket Shanghai daily max temperature markets.

- No auto-trading
- No wallet/private key integration
- Core output: `Decision` / `Position` / `Reason`

---

## 1) Positioning

This project is not a generic weather app. It is a decision terminal built around Polymarket resolution rules.

Core principle:

`Polymarket Rules -> Resolution Station -> Resolution Source -> Final Value`

Current scope:
- City: `Shanghai`
- Station: `Shanghai Pudong International Airport Station (ZSPD)`
- Resolution reference: Wunderground (as defined by Polymarket rules)

---

## 2) Features

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

---

## 3) Tech Stack

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

## 4) Trading Engine

Path: `/src/lib/trading-engine`

Main modules:
- `tradingEngine.ts` (entry: `runTradingDecision`)
- `edge.ts`
- `timingScore.ts`
- `weatherScore.ts`
- `dataQuality.ts`
- `riskEngine.ts`
- `positionSizer.ts`
- `model.ts`

Formula:
- `Edge = ModelProbability - MarketPrice`
- `TradeScore = 0.35*EdgeScore + 0.25*TimingScore + 0.20*WeatherScore + 0.20*DataQualityScore`

Decision mapping:
- `< 60 -> PASS`
- `60 ~ 75 -> WATCH`
- `> 75 -> BUY`

---

## 5) Data Sources

### Market
- Polymarket Gamma API

### Weather Assist
- Wunderground/Weather.com (station anchor)
- Open-Meteo
- wttr
- met.no
- WeatherAPI (optional)
- QWeather (optional)
- AviationWeather (METAR/TAF for short-term risk)

Notes:
- Assist weather sources are not the final settlement source.
- If a source fails, status and reason are shown; no fake fallback data is injected.

---

## 6) Pages

- `/` Home terminal
- `/three-pm` 3PM scanner
- `/market/[slug]` Market detail

---

## 7) Database

Schema file: `/prisma/schema.prisma`

Core tables:
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

## 8) Local Setup

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

`npm run dev` runs one initial `job:once -- all` before starting Next.js.

---

## 9) Useful Commands

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

## 10) Environment Variables

Copy `.env.example` and configure as needed.

Important keys:
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

## 11) Port Notes

- Default: `3000`
- If occupied: fallback to `3001`
- Always use terminal `Local:` URL

---

## 12) Scheduling

`npm run jobs` (node-cron):
- Market: every 5 min
- Weather: every 10 min
- Model: every 5 min
- Settled sync: daily 01:10

Manual APIs:
- `POST /api/refresh`
- `POST /api/jobs/run` (`job=market|weather|model|settled|all`)

---

## 13) Final Output

- `Decision`: `BUY / WATCH / PASS`
- `Position`: suggested size
- `Reason`: explanation

---

## 14) Disclaimer

This project is for research and decision support only, not investment advice.
