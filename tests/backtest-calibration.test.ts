import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runCalibration } from '@/src/lib/calibration';
import {
  expandBacktestRows,
  loadSnapshotRowsFromPath,
  normalizeSnapshotRows,
  runBacktest
} from '@/src/lib/backtest';
import { buildIntegerSettlementDistribution, mapIntegerDistributionToBins } from '@/src/lib/trading-engine/settlementMapping';

test('acceptance: observedMax=12 and q90 cap=2 should only allow 12/13/14', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 13,
    sigma: 1.4,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 12,
    maxContinuous: 14
  });
  const probs = mapIntegerDistributionToBins(['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C'], dist);
  assert.equal(probs[0], 0);
  assert.equal(probs[4], 0);
  assert.equal(probs[5], 0);
  assert.ok((probs[1] ?? 0) > 0);
  assert.ok((probs[2] ?? 0) > 0);
  assert.ok((probs[3] ?? 0) > 0);
});

test('calibration tables should produce base sigma, source weights and remaining caps', () => {
  const rows = [
    {
      airport: 'ZSPD',
      targetDate: '2026-03-17',
      snapshotTime: '08:00' as const,
      snapshotBucket: '08' as const,
      sources: { ecmwf: 12.2, gfs: 12.5, wunderground: 12.1 },
      observedMaxSoFar: 10.5,
      finalMaxTemp: 12.7
    },
    {
      airport: 'ZSPD',
      targetDate: '2026-03-18',
      snapshotTime: '08:00' as const,
      snapshotBucket: '08' as const,
      sources: { ecmwf: 14.2, gfs: 13.9, weatherAPI: 13.8 },
      observedMaxSoFar: 11.2,
      finalMaxTemp: 14.4
    }
  ];
  const tables = runCalibration(rows);
  assert.ok((tables.baseSigma['08'] ?? 0) > 0);
  const w = tables.sourceWeights['08'] ?? {};
  const sum = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
  assert.ok(sum > 0.99 && sum < 1.01);
  assert.ok((tables.remainingCaps['08']?.q90 ?? 0) >= 0);
  assert.ok((tables.meta.debug.baseSigma['08']?.rawEstimate ?? 0) > 0);
  assert.ok((tables.meta.debug.baseSigma['08']?.smoothedEstimate ?? 0) > 0);
  assert.equal(typeof tables.meta.debug.baseSigma['08']?.usedGlobalFallback, 'boolean');
  assert.ok((tables.meta.debug.sourceWeights['08']?.ecmwf?.smoothedScore ?? 0) > 0);
  assert.ok((tables.meta.debug.remainingCaps['08']?.smoothedEstimate?.q90 ?? 0) >= 0);
});

test('runBacktest should return metrics, calibration curve and legal distribution checks', () => {
  const rows = [
    {
      airport: 'ZSPD',
      targetDate: '2026-03-17',
      snapshotTime: '11:00' as const,
      snapshotBucket: '11' as const,
      sources: { ecmwf: 13.0, gfs: 12.9, metNo: 13.1, weatherAPI: 12.6 },
      observedMaxSoFar: 12.0,
      finalMaxTemp: 13.1
    },
    {
      airport: 'ZSPD',
      targetDate: '2026-03-17',
      snapshotTime: '14:00' as const,
      snapshotBucket: '14' as const,
      sources: { ecmwf: 13.2, gfs: 13.0, metNo: 13.3, wunderground: 13.1 },
      observedMaxSoFar: 12.4,
      finalMaxTemp: 13.1
    }
  ];
  const tables = runCalibration(rows);
  const result = runBacktest(rows, { minTemp: 10, maxTemp: 16, lambda: 1.0 }, tables);
  assert.ok(Number.isFinite(result.metrics.brier));
  assert.ok(Number.isFinite(result.metrics.logloss));
  assert.equal(result.calibrationCurve.length, 10);
  assert.ok(result.distributionChecks.every((x) => x.pass));
  assert.ok(result.summary.rows > 0);
  assert.ok(result.sampleDistributions.length > 0);
  assert.ok(result.summary.sampleCount >= rows.length);
  assert.equal(typeof result.summary.fallbackUsed, 'boolean');
  assert.ok(result.summary.distributionLegality.totalChecks >= 0);
  assert.ok(result.summary.distributionLegality.passedChecks >= 0);
  assert.ok(result.summary.sigmaStats.min >= 0.95);
  assert.ok(result.sampleDistributions.every((x) => Number.isFinite(x.sigmaBase)));
  assert.ok(result.sampleDistributions.every((x) => Number.isFinite(x.spreadSigma)));
  assert.ok(result.sampleDistributions.every((x) => Number.isFinite(x.finalSigma)));
});

test('demo dataset should run end-to-end with loader + calibration + backtest', async () => {
  const filePath = path.resolve(process.cwd(), 'scripts/data/backtest-demo.json');
  const raw = await loadSnapshotRowsFromPath(filePath);
  const rows = normalizeSnapshotRows(raw);
  const tables = runCalibration(rows);
  const result = runBacktest(rows, { minTemp: 8, maxTemp: 20, lambda: 1.0 }, tables);

  assert.ok(rows.length > 0);
  assert.ok(Number.isFinite(result.metrics.brier));
  assert.ok(Number.isFinite(result.metrics.logloss));
  assert.ok(result.sampleDistributions.length > 0);
  assert.ok(Object.values(result.summary.bucketCounts).reduce((a, b) => a + b, 0) === result.summary.sampleCount);
  assert.ok(Array.isArray(result.summary.warnings));
});

test('expanded dataset should exceed 200 rows and produce stable calibration outputs', async () => {
  const filePath = path.resolve(process.cwd(), 'scripts/data/backtest-demo.json');
  const raw = await loadSnapshotRowsFromPath(filePath);
  const normalized = normalizeSnapshotRows(raw);
  const expanded = expandBacktestRows(normalized, 40);
  const tables = runCalibration(expanded, { minSamplesPerBucket: 20, shrinkageK: 15, sigmaFloor: 0.9 });
  const result = runBacktest(expanded, { minTemp: 8, maxTemp: 20, lambda: 1.0 }, tables);

  assert.ok(expanded.length >= 200);
  assert.ok(result.summary.sampleCount >= 200);
  assert.ok(result.summary.sigmaStats.min >= 0.9);
  assert.ok(result.summary.sigmaStats.max >= result.summary.sigmaStats.min);
  assert.ok(['GOOD', 'WARNING', 'BAD'].includes(result.metrics.calibrationError.quality));
  assert.equal(typeof result.metrics.overconfidence.count, 'number');
  assert.equal(typeof result.metrics.overconfidence.hitRate, 'number');
  assert.ok(result.summary.distributionLegality.failedChecks === 0);
  assert.ok(result.summary.p1Count >= 0);
  assert.ok(result.sampleDistributions.every((x) => x.finalSigma >= 0.95));
  assert.ok(result.sampleDistributions.every((x) => x.sourceWeightFallbackUsed === false));
});

test('small-sample calibration should smooth instead of hard fallback collapse', () => {
  const rows = [
    {
      airport: 'ZSPD',
      targetDate: '2026-03-17',
      snapshotTime: '08:00' as const,
      snapshotBucket: '08' as const,
      sources: { ecmwf: 12.2, gfs: 12.4 },
      observedMaxSoFar: 10.5,
      finalMaxTemp: 12.8
    },
    {
      airport: 'ZSPD',
      targetDate: '2026-03-18',
      snapshotTime: '11:00' as const,
      snapshotBucket: '11' as const,
      sources: { ecmwf: 13.1, gfs: 12.8 },
      observedMaxSoFar: 11.0,
      finalMaxTemp: 13.0
    }
  ];
  const tables = runCalibration(rows, { minSamplesPerBucket: 20, shrinkageK: 15, sigmaFloor: 0.9 });
  assert.ok((tables.baseSigma['08'] ?? 0) >= 0.9);
  assert.ok((tables.baseSigma['11'] ?? 0) >= 0.9);
  assert.ok((tables.baseSigma['14'] ?? 0) >= 0.9);
  assert.ok((tables.baseSigma['late'] ?? 0) >= 0.9);
  const lateDbg = tables.meta.debug.baseSigma.late;
  assert.equal(lateDbg.sampleCount, 0);
  assert.equal(lateDbg.usedGlobalFallback, true);
  const w08 = Object.values(tables.sourceWeights['08'] ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  assert.ok(w08 > 0.99 && w08 < 1.01);
});
