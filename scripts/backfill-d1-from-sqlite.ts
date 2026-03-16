import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function esc(v: unknown) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) return `'${v.toISOString().replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const market = await prisma.market.findFirst({
    where: {
      cityName: 'Shanghai',
      OR: [
        { marketSlug: { contains: 'highest-temperature-in-shanghai' } },
        { marketTitle: { contains: 'Highest temperature in Shanghai' } }
      ]
    },
    include: {
      bins: true,
      resolutionMetadata: true,
      weatherSnapshots: { orderBy: { observedAt: 'desc' }, take: 24 },
      modelRuns: { orderBy: { runAt: 'desc' }, take: 10, include: { outputs: true } },
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 20 },
      notes: { orderBy: { createdAt: 'desc' }, take: 50 },
      settledResult: true,
      forecastBiases: { orderBy: { forecastDate: 'desc' }, take: 100 }
    },
    orderBy: [{ isActive: 'desc' }, { targetDate: 'desc' }, { updatedAt: 'desc' }]
  });

  if (!market) {
    throw new Error('No Shanghai market found in local sqlite');
  }

  const lines: string[] = [];
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('BEGIN TRANSACTION;');
  lines.push(`DELETE FROM market_bins WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM resolution_metadata WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM weather_assist_snapshots WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM model_bin_outputs WHERE model_run_id IN (SELECT id FROM model_runs WHERE market_id = ${esc(market.id)});`);
  lines.push(`DELETE FROM model_runs WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM snapshots WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM notes WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM settled_results WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM forecast_source_biases WHERE market_id = ${esc(market.id)};`);
  lines.push(`DELETE FROM markets WHERE id = ${esc(market.id)};`);

  lines.push(
    `INSERT INTO markets (id, city_name, event_id, market_slug, market_title, rules_text, volume, target_date, is_active, created_at, updated_at, raw_json) VALUES (` +
      `${esc(market.id)}, ${esc(market.cityName)}, ${esc(market.eventId)}, ${esc(market.marketSlug)}, ${esc(market.marketTitle)}, ${esc(market.rulesText)}, ${esc(market.volume)}, ${esc(market.targetDate)}, ${esc(market.isActive)}, ${esc(market.createdAt)}, ${esc(market.updatedAt)}, NULL);`
  );

  for (const b of market.bins) {
    lines.push(
      `INSERT INTO market_bins (id, market_id, outcome_label, outcome_index, market_price, no_market_price, best_bid, best_ask, spread, implied_probability, updated_at) VALUES (` +
        `${esc(b.id)}, ${esc(b.marketId)}, ${esc(b.outcomeLabel)}, ${esc(b.outcomeIndex)}, ${esc(b.marketPrice)}, ${esc(b.noMarketPrice)}, ${esc(b.bestBid)}, ${esc(b.bestAsk)}, ${esc(b.spread)}, ${esc(b.impliedProbability)}, ${esc(b.updatedAt)});`
    );
  }

  if (market.resolutionMetadata) {
    const r = market.resolutionMetadata;
    lines.push(
      `INSERT INTO resolution_metadata (id, market_id, station_name, station_code, source_name, source_url, precision_rule, finalized_rule, revision_rule, updated_at) VALUES (` +
        `${esc(r.id)}, ${esc(r.marketId)}, ${esc(r.stationName)}, ${esc(r.stationCode)}, ${esc(r.sourceName)}, ${esc(r.sourceUrl)}, ${esc(r.precisionRule)}, ${esc(r.finalizedRule)}, ${esc(r.revisionRule)}, ${esc(r.updatedAt)});`
    );
  }

  for (const w of market.weatherSnapshots) {
    lines.push(
      `INSERT INTO weather_assist_snapshots (id, market_id, observed_at, temperature_2m, humidity, cloud_cover, precipitation, wind_speed, temp_1h_ago, temp_2h_ago, temp_3h_ago, temp_rise_1h, temp_rise_2h, temp_rise_3h, max_temp_so_far, raw_json) VALUES (` +
        `${esc(w.id)}, ${esc(w.marketId)}, ${esc(w.observedAt)}, ${esc(w.temperature2m)}, ${esc(w.humidity)}, ${esc(w.cloudCover)}, ${esc(w.precipitation)}, ${esc(w.windSpeed)}, ${esc(w.temp1hAgo)}, ${esc(w.temp2hAgo)}, ${esc(w.temp3hAgo)}, ${esc(w.tempRise1h)}, ${esc(w.tempRise2h)}, ${esc(w.tempRise3h)}, ${esc(w.maxTempSoFar)}, NULL);`
    );
  }

  for (const r of market.modelRuns) {
    lines.push(
      `INSERT INTO model_runs (id, market_id, run_at, model_version, best_bin, edge, trade_score, decision, recommended_position, timing_score, weather_score, data_quality_score, explanation, risk_flags_json, raw_features_json) VALUES (` +
        `${esc(r.id)}, ${esc(r.marketId)}, ${esc(r.runAt)}, ${esc(r.modelVersion)}, ${esc(r.bestBin)}, ${esc(r.edge)}, ${esc(r.tradeScore)}, ${esc(r.decision)}, ${esc(r.recommendedPosition)}, ${esc(r.timingScore)}, ${esc(r.weatherScore)}, ${esc(r.dataQualityScore)}, ${esc(r.explanation)}, ${esc(r.riskFlagsJson)}, ${esc(r.rawFeaturesJson)});`
    );
    for (const o of r.outputs) {
      lines.push(
        `INSERT INTO model_bin_outputs (id, model_run_id, outcome_label, model_probability, market_price, edge) VALUES (` +
          `${esc(o.id)}, ${esc(o.modelRunId)}, ${esc(o.outcomeLabel)}, ${esc(o.modelProbability)}, ${esc(o.marketPrice)}, ${esc(o.edge)});`
      );
    }
  }

  for (const s of market.snapshots) {
    lines.push(
      `INSERT INTO snapshots (id, market_id, model_run_id, captured_at, market_prices_json, weather_features_json, model_output_json, trading_output_json, explanation_text, risk_flags_json) VALUES (` +
        `${esc(s.id)}, ${esc(s.marketId)}, ${esc(s.modelRunId)}, ${esc(s.capturedAt)}, '{}', '{}', '{}', '{}', ${esc(s.explanationText)}, '[]');`
    );
  }

  for (const n of market.notes) {
    lines.push(
      `INSERT INTO notes (id, market_id, note_text, created_at) VALUES (` +
        `${esc(n.id)}, ${esc(n.marketId)}, ${esc(n.noteText)}, ${esc(n.createdAt)});`
    );
  }

  if (market.settledResult) {
    const s = market.settledResult;
    lines.push(
      `INSERT INTO settled_results (id, market_id, final_outcome_label, final_value, settled_at, source_url) VALUES (` +
        `${esc(s.id)}, ${esc(s.marketId)}, ${esc(s.finalOutcomeLabel)}, ${esc(s.finalValue)}, ${esc(s.settledAt)}, ${esc(s.sourceUrl)});`
    );
  }

  for (const b of market.forecastBiases) {
    lines.push(
      `INSERT INTO forecast_source_biases (id, market_id, snapshot_id, source_code, source_group, forecast_date, captured_at, predicted_max, final_max, bias, abs_error, created_at) VALUES (` +
        `${esc(b.id)}, ${esc(b.marketId)}, NULL, ${esc(b.sourceCode)}, ${esc(b.sourceGroup)}, ${esc(b.forecastDate)}, ${esc(b.capturedAt)}, ${esc(b.predictedMax)}, ${esc(b.finalMax)}, ${esc(b.bias)}, ${esc(b.absError)}, ${esc(b.createdAt)});`
    );
  }

  lines.push('COMMIT;');
  writeFileSync('migrations/0002_backfill_latest_market.sql', `${lines.join('\n')}\n`);
  console.log('done: migrations/0002_backfill_latest_market.sql');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
