import { fromJsonString } from '@/lib/utils/json';
import { getD1 } from '@/lib/services/d1-context';

function toDate(v: unknown) {
  const s = typeof v === 'string' ? v : '';
  const d = s ? new Date(s) : new Date();
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function marketStatusOf(market: { targetDate: Date; isActive: boolean }) {
  const now = new Date();
  const minutesToSettlement = Math.floor((market.targetDate.getTime() - now.getTime()) / 60000);
  const isSettled = minutesToSettlement <= 0 || !market.isActive;
  return { now, settlementAt: market.targetDate, minutesToSettlement, isSettled };
}

export async function getDashboardDataD1() {
  const db = await getD1();
  if (!db) return null;

  const market = await db
    .prepare(
      `SELECT * FROM markets
       WHERE city_name = 'Shanghai'
         AND (market_slug LIKE '%highest-temperature-in-shanghai%' OR market_title LIKE '%Highest temperature in Shanghai%')
       ORDER BY is_active DESC, target_date DESC, updated_at DESC
       LIMIT 1`
    )
    .first<Record<string, unknown>>();
  if (!market) return null;

  const marketId = String(market.id);
  const bins = (
    await db.prepare(`SELECT * FROM market_bins WHERE market_id = ? ORDER BY outcome_index ASC`).bind(marketId).all()
  ).results;
  const resolutionMetadata = await db
    .prepare(`SELECT * FROM resolution_metadata WHERE market_id = ? LIMIT 1`)
    .bind(marketId)
    .first<Record<string, unknown>>();
  const weatherSnapshots = (
    await db.prepare(`SELECT * FROM weather_assist_snapshots WHERE market_id = ? ORDER BY observed_at DESC LIMIT 1`).bind(marketId).all()
  ).results;
  const modelRuns = (
    await db.prepare(`SELECT * FROM model_runs WHERE market_id = ? ORDER BY run_at DESC LIMIT 1`).bind(marketId).all()
  ).results;
  const latestRun = modelRuns[0] ?? null;
  const outputs = latestRun
    ? (await db.prepare(`SELECT * FROM model_bin_outputs WHERE model_run_id = ?`).bind(String(latestRun.id)).all()).results
    : [];
  const settledResult = await db
    .prepare(`SELECT * FROM settled_results WHERE market_id = ? LIMIT 1`)
    .bind(marketId)
    .first<Record<string, unknown>>();
  const snapshots = (
    await db.prepare(`SELECT * FROM snapshots WHERE market_id = ? ORDER BY captured_at DESC LIMIT 20`).bind(marketId).all()
  ).results;
  const notes = (
    await db.prepare(`SELECT * FROM notes WHERE market_id = ? ORDER BY created_at DESC LIMIT 20`).bind(marketId).all()
  ).results;
  const forecastBiases = (
    await db
      .prepare(
        `SELECT * FROM forecast_source_biases
         WHERE market_id = ?
         ORDER BY forecast_date DESC, abs_error ASC
         LIMIT 100`
      )
      .bind(marketId)
      .all()
  ).results;
  const biasStats = (
    await db
      .prepare(
        `SELECT source_code as sourceCode, source_group as sourceGroup, COUNT(*) as cnt, AVG(abs_error) as avgAbsError, AVG(bias) as avgBias
         FROM forecast_source_biases
         GROUP BY source_code, source_group
         ORDER BY avgAbsError ASC`
      )
      .all()
  ).results.map((r) => ({
    sourceCode: String(r.sourceCode ?? ''),
    sourceGroup: String(r.sourceGroup ?? ''),
    _count: { sourceCode: Number(r.cnt ?? 0) },
    _avg: { absError: Number(r.avgAbsError ?? 0), bias: Number(r.avgBias ?? 0) }
  }));

  const mappedMarket = {
    id: marketId,
    cityName: String(market.city_name ?? 'Shanghai'),
    eventId: String(market.event_id ?? ''),
    marketSlug: String(market.market_slug ?? ''),
    marketTitle: String(market.market_title ?? ''),
    rulesText: String(market.rules_text ?? ''),
    volume: market.volume == null ? null : Number(market.volume),
    targetDate: toDate(market.target_date),
    isActive: Boolean(Number(market.is_active ?? 1)),
    createdAt: toDate(market.created_at),
    updatedAt: toDate(market.updated_at),
    rawJson: (market.raw_json as string | null) ?? null,
    bins: bins.map((b) => ({
      id: String(b.id),
      marketId: String(b.market_id),
      outcomeLabel: String(b.outcome_label),
      outcomeIndex: Number(b.outcome_index),
      marketPrice: Number(b.market_price),
      noMarketPrice: b.no_market_price == null ? null : Number(b.no_market_price),
      bestBid: b.best_bid == null ? null : Number(b.best_bid),
      bestAsk: b.best_ask == null ? null : Number(b.best_ask),
      spread: b.spread == null ? null : Number(b.spread),
      impliedProbability: Number(b.implied_probability),
      updatedAt: toDate(b.updated_at)
    })),
    resolutionMetadata: resolutionMetadata
      ? {
          id: String(resolutionMetadata.id),
          marketId: String(resolutionMetadata.market_id),
          stationName: String(resolutionMetadata.station_name),
          stationCode: String(resolutionMetadata.station_code),
          sourceName: String(resolutionMetadata.source_name),
          sourceUrl: String(resolutionMetadata.source_url),
          precisionRule: String(resolutionMetadata.precision_rule),
          finalizedRule: String(resolutionMetadata.finalized_rule),
          revisionRule: (resolutionMetadata.revision_rule as string | null) ?? null,
          updatedAt: toDate(resolutionMetadata.updated_at)
        }
      : null,
    weatherSnapshots: weatherSnapshots.map((w) => ({
      id: String(w.id),
      marketId: String(w.market_id),
      observedAt: toDate(w.observed_at),
      temperature2m: Number(w.temperature_2m),
      humidity: w.humidity == null ? null : Number(w.humidity),
      cloudCover: w.cloud_cover == null ? null : Number(w.cloud_cover),
      precipitation: w.precipitation == null ? null : Number(w.precipitation),
      windSpeed: w.wind_speed == null ? null : Number(w.wind_speed),
      temp1hAgo: w.temp_1h_ago == null ? null : Number(w.temp_1h_ago),
      temp2hAgo: w.temp_2h_ago == null ? null : Number(w.temp_2h_ago),
      temp3hAgo: w.temp_3h_ago == null ? null : Number(w.temp_3h_ago),
      tempRise1h: w.temp_rise_1h == null ? null : Number(w.temp_rise_1h),
      tempRise2h: w.temp_rise_2h == null ? null : Number(w.temp_rise_2h),
      tempRise3h: w.temp_rise_3h == null ? null : Number(w.temp_rise_3h),
      maxTempSoFar: Number(w.max_temp_so_far),
      rawJson: (w.raw_json as string | null) ?? null
    })),
    modelRuns: latestRun
      ? [
          {
            id: String(latestRun.id),
            marketId: String(latestRun.market_id),
            runAt: toDate(latestRun.run_at),
            modelVersion: String(latestRun.model_version),
            bestBin: String(latestRun.best_bin),
            edge: Number(latestRun.edge),
            tradeScore: Number(latestRun.trade_score),
            decision: String(latestRun.decision),
            recommendedPosition: Number(latestRun.recommended_position),
            timingScore: Number(latestRun.timing_score),
            weatherScore: Number(latestRun.weather_score),
            dataQualityScore: Number(latestRun.data_quality_score),
            explanation: String(latestRun.explanation),
            riskFlagsJson: String(latestRun.risk_flags_json ?? '[]'),
            rawFeaturesJson: String(latestRun.raw_features_json ?? '{}'),
            outputs: outputs.map((o) => ({
              id: String(o.id),
              modelRunId: String(o.model_run_id),
              outcomeLabel: String(o.outcome_label),
              modelProbability: Number(o.model_probability),
              marketPrice: Number(o.market_price),
              edge: Number(o.edge)
            }))
          }
        ]
      : [],
    settledResult: settledResult
      ? {
          id: String(settledResult.id),
          marketId: String(settledResult.market_id),
          finalOutcomeLabel: String(settledResult.final_outcome_label),
          finalValue: Number(settledResult.final_value),
          settledAt: toDate(settledResult.settled_at),
          sourceUrl: String(settledResult.source_url)
        }
      : null,
    snapshots: snapshots.map((s) => ({
      id: String(s.id),
      marketId: String(s.market_id),
      modelRunId: (s.model_run_id as string | null) ?? null,
      capturedAt: toDate(s.captured_at),
      marketPricesJson: String(s.market_prices_json ?? '{}'),
      weatherFeaturesJson: String(s.weather_features_json ?? '{}'),
      modelOutputJson: String(s.model_output_json ?? '{}'),
      tradingOutputJson: String(s.trading_output_json ?? '{}'),
      explanationText: String(s.explanation_text ?? ''),
      riskFlagsJson: String(s.risk_flags_json ?? '[]')
    })),
    notes: notes.map((n) => ({
      id: String(n.id),
      marketId: String(n.market_id),
      noteText: String(n.note_text),
      createdAt: toDate(n.created_at)
    })),
    forecastBiases: forecastBiases.map((b) => ({
      id: String(b.id),
      marketId: String(b.market_id),
      snapshotId: (b.snapshot_id as string | null) ?? null,
      sourceCode: String(b.source_code),
      sourceGroup: String(b.source_group),
      forecastDate: toDate(b.forecast_date),
      capturedAt: toDate(b.captured_at),
      predictedMax: Number(b.predicted_max),
      finalMax: Number(b.final_max),
      bias: Number(b.bias),
      absError: Number(b.abs_error),
      createdAt: toDate(b.created_at)
    }))
  };

  const latestWeather = mappedMarket.weatherSnapshots[0] ?? null;
  const latestRunMapped = mappedMarket.modelRuns[0] ?? null;
  const marketStatus = marketStatusOf({ targetDate: mappedMarket.targetDate, isActive: mappedMarket.isActive });

  return {
    market: mappedMarket,
    marketStatus,
    latestRun: latestRunMapped,
    latestWeather,
    marketSource: fromJsonString<{ source?: string }>(mappedMarket.rawJson, {}).source ?? 'unknown',
    weatherSource: fromJsonString<{ source?: string }>(latestWeather?.rawJson, {}).source ?? 'unknown',
    latestDecision: latestRunMapped
      ? {
          reasonMeta: fromJsonString<{ reasonZh?: string; reasonEn?: string; recommendedSide?: string }>(
            latestRunMapped.rawFeaturesJson,
            {}
          ),
          decision: latestRunMapped.decision,
          recommendedBin: latestRunMapped.bestBin,
          recommendedSide:
            fromJsonString<{ recommendedSide?: string }>(latestRunMapped.rawFeaturesJson, {}).recommendedSide ?? 'YES',
          edge: latestRunMapped.edge,
          tradeScore: latestRunMapped.tradeScore,
          positionSize: latestRunMapped.recommendedPosition,
          timingScore: latestRunMapped.timingScore,
          weatherScore: latestRunMapped.weatherScore,
          dataQualityScore: latestRunMapped.dataQualityScore,
          riskFlags: fromJsonString<string[]>(latestRunMapped.riskFlagsJson, []),
          reason: latestRunMapped.explanation,
          reasonZh: fromJsonString<{ reasonZh?: string }>(latestRunMapped.rawFeaturesJson, {}).reasonZh ?? latestRunMapped.explanation,
          reasonEn: fromJsonString<{ reasonEn?: string }>(latestRunMapped.rawFeaturesJson, {}).reasonEn ?? latestRunMapped.explanation
        }
      : null,
    biasStats,
    snapshots: mappedMarket.snapshots,
    notes: mappedMarket.notes
  };
}

export async function getMarketDetailD1(slug: string) {
  const dashboard = await getDashboardDataD1();
  if (!dashboard) return null;
  return {
    ...dashboard,
    latestMarketSlug: dashboard.market.marketSlug,
    isLatestMarket: dashboard.market.marketSlug === slug,
    settled: dashboard.market.settledResult
  };
}
