import { quantile } from '@/src/lib/calibration/stats';
import type {
  NormalizedSnapshotRow,
  RemainingCapDistributionStats,
  RemainingCapDistributionTable,
  SnapshotBucket
} from '@/src/lib/backtest/types';
import {
  bucketHoursToPeak,
  bucketObservedVsMuGap,
  buildDeltaDistributionKey
} from '@/src/lib/trading-engine/delta-distribution';

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]) {
  if (!values.length) return 0.35;
  const m = mean(values);
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / values.length;
  return Math.max(0.35, Math.sqrt(Math.max(0, v)));
}

function summarize(values: number[]): RemainingCapDistributionStats {
  return {
    q25: quantile(values, 0.25),
    q50: quantile(values, 0.5),
    q75: quantile(values, 0.75),
    q90: quantile(values, 0.9),
    q95: quantile(values, 0.95),
    mean: mean(values),
    std: std(values),
    count: values.length
  };
}

function parseHour(snapshotTime: string) {
  const m = snapshotTime.match(/^(\d{1,2})/);
  const h = m ? Number(m[1]) : NaN;
  return Number.isFinite(h) ? h : 12;
}

function averageRowSources(row: NormalizedSnapshotRow) {
  const vals = Object.values(row.sources).filter((v): v is number => Number.isFinite(v));
  if (!vals.length) return row.currentTemp ?? row.finalMaxTemp;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function peakHourForBucket(snapshotBucket: SnapshotBucket) {
  if (snapshotBucket === '08') return 14.5;
  if (snapshotBucket === '11') return 14.5;
  if (snapshotBucket === '14') return 15.0;
  return 16.0;
}

export function buildRemainingCapDistribution(params: {
  rows: NormalizedSnapshotRow[];
  shrinkageK: number;
}): {
  table: RemainingCapDistributionTable;
  debug: Record<string, {
    sampleCount: number;
    rawEstimate: RemainingCapDistributionStats;
    smoothedEstimate: RemainingCapDistributionStats;
    usedGlobalFallback: boolean;
  }>;
} {
  const { rows, shrinkageK } = params;
  const grouped: Record<string, number[]> = {};
  const groupedBySnapshot: Record<SnapshotBucket, number[]> = {
    '08': [],
    '11': [],
    '14': [],
    late: []
  };
  const global: number[] = [];

  for (const row of rows) {
    if (!Number.isFinite(row.observedMaxSoFar)) continue;
    const observed = Number(row.observedMaxSoFar);
    const delta = Math.max(0, row.finalMaxTemp - observed);
    const mu0 = averageRowSources(row);
    const gap = Math.abs(observed - mu0);
    const hoursToPeak = peakHourForBucket(row.snapshotBucket) - parseHour(row.snapshotTime);
    const key = buildDeltaDistributionKey({
      snapshotBucket: row.snapshotBucket,
      hoursToPeakBucket: bucketHoursToPeak(hoursToPeak),
      observedVsMuGapBucket: bucketObservedVsMuGap(gap)
    });
    grouped[key] ??= [];
    grouped[key].push(delta);
    groupedBySnapshot[row.snapshotBucket].push(delta);
    global.push(delta);
  }

  const globalStats = summarize(global);
  const snapshotStats: Record<SnapshotBucket, RemainingCapDistributionStats> = {
    '08': summarize(groupedBySnapshot['08']),
    '11': summarize(groupedBySnapshot['11']),
    '14': summarize(groupedBySnapshot['14']),
    late: summarize(groupedBySnapshot.late)
  };

  const table: RemainingCapDistributionTable = {};
  const debug: Record<string, {
    sampleCount: number;
    rawEstimate: RemainingCapDistributionStats;
    smoothedEstimate: RemainingCapDistributionStats;
    usedGlobalFallback: boolean;
  }> = {};

  for (const [key, vals] of Object.entries(grouped)) {
    const raw = summarize(vals);
    const n = vals.length;
    const w = n / (n + shrinkageK);
    const snapshotBucket = key.split('|')[0] as SnapshotBucket;
    const sStats = snapshotStats[snapshotBucket] ?? globalStats;
    const smoothed: RemainingCapDistributionStats = {
      q25: w * raw.q25 + (1 - w) * (0.65 * sStats.q25 + 0.35 * globalStats.q25),
      q50: w * raw.q50 + (1 - w) * (0.65 * sStats.q50 + 0.35 * globalStats.q50),
      q75: w * raw.q75 + (1 - w) * (0.65 * sStats.q75 + 0.35 * globalStats.q75),
      q90: w * raw.q90 + (1 - w) * (0.65 * sStats.q90 + 0.35 * globalStats.q90),
      q95: w * raw.q95 + (1 - w) * (0.65 * sStats.q95 + 0.35 * globalStats.q95),
      mean: w * raw.mean + (1 - w) * (0.65 * sStats.mean + 0.35 * globalStats.mean),
      std: Math.max(0.35, w * raw.std + (1 - w) * (0.65 * sStats.std + 0.35 * globalStats.std)),
      count: raw.count
    };
    table[key] = smoothed;
    debug[key] = {
      sampleCount: n,
      rawEstimate: raw,
      smoothedEstimate: smoothed,
      usedGlobalFallback: n === 0
    };
  }

  // Ensure at least snapshot-level fallback keys exist.
  const defaultKeys = (['08', '11', '14', 'late'] as const).flatMap((bucket) => {
    return (['far', 'medium', 'near', 'very_near'] as const).flatMap((h) => {
      return (['low', 'medium', 'high'] as const).map((g) => `${bucket}|${h}|${g}`);
    });
  });
  for (const key of defaultKeys) {
    if (table[key]) continue;
    const snapshotBucket = key.split('|')[0] as SnapshotBucket;
    const fallback = snapshotStats[snapshotBucket].count > 0 ? snapshotStats[snapshotBucket] : globalStats;
    table[key] = { ...fallback };
    debug[key] = {
      sampleCount: 0,
      rawEstimate: { ...fallback, count: 0 },
      smoothedEstimate: { ...fallback, count: 0 },
      usedGlobalFallback: true
    };
  }

  return { table, debug };
}

