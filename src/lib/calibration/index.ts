import { mad, quantile, rmse } from '@/src/lib/calibration/stats';
import type {
  CalibrationConfig,
  CalibrationTables,
  NormalizedSnapshotRow,
  SnapshotBucket,
  WeatherSourceName
} from '@/src/lib/backtest/types';

const BUCKETS: SnapshotBucket[] = ['08', '11', '14', 'late'];
const SOURCES: WeatherSourceName[] = ['ecmwf', 'gfs', 'icon', 'wunderground', 'weatherAPI', 'metNo'];

function robustSigmaFromErrors(errors: number[], sigmaFloor: number): number {
  if (!errors.length) return sigmaFloor;
  const sigma = 1.4826 * mad(errors);
  return Math.max(sigmaFloor, sigma);
}

function avgSources(row: NormalizedSnapshotRow): number | null {
  const vals = Object.values(row.sources).filter((v): v is number => Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function shrinkWeight(n: number, k: number) {
  return n / (n + k);
}

export function runCalibration(
  rows: NormalizedSnapshotRow[],
  config: CalibrationConfig = {}
): CalibrationTables {
  const minSamplesPerBucket = config.minSamplesPerBucket ?? 20;
  const shrinkageK = config.shrinkageK ?? 15;
  const sigmaFloor = config.sigmaFloor ?? 0.9;

  const bucketErrors: Record<SnapshotBucket, number[]> = { '08': [], '11': [], '14': [], late: [] };
  const globalErrors: number[] = [];
  const remainsByBucket: Record<SnapshotBucket, number[]> = { '08': [], '11': [], '14': [], late: [] };
  const globalRemains: number[] = [];
  const sourceErrorsByBucket: Record<SnapshotBucket, Partial<Record<WeatherSourceName, number[]>>> = {
    '08': {},
    '11': {},
    '14': {},
    late: {}
  };
  const sourceErrorsGlobal: Partial<Record<WeatherSourceName, number[]>> = {};
  const sourceSampleCount: Record<SnapshotBucket, Partial<Record<WeatherSourceName, number>>> = {
    '08': {},
    '11': {},
    '14': {},
    late: {}
  };
  const bucketSampleCount: Record<SnapshotBucket, number> = { '08': 0, '11': 0, '14': 0, late: 0 };

  for (const b of BUCKETS) {
    for (const s of SOURCES) {
      sourceErrorsByBucket[b][s] = [];
      sourceSampleCount[b][s] = 0;
      sourceErrorsGlobal[s] ??= [];
    }
  }

  for (const row of rows) {
    bucketSampleCount[row.snapshotBucket] += 1;
    const mu0 = avgSources(row);
    if (mu0 != null) {
      const e = row.finalMaxTemp - mu0;
      bucketErrors[row.snapshotBucket].push(e);
      globalErrors.push(e);
    }
    if (Number.isFinite(row.observedMaxSoFar)) {
      const remain = Math.max(0, row.finalMaxTemp - (row.observedMaxSoFar as number));
      remainsByBucket[row.snapshotBucket].push(remain);
      globalRemains.push(remain);
    }
    for (const s of SOURCES) {
      const v = row.sources[s];
      if (!Number.isFinite(v)) continue;
      const err = (v as number) - row.finalMaxTemp;
      sourceErrorsByBucket[row.snapshotBucket][s]!.push(err);
      sourceErrorsGlobal[s]!.push(err);
      sourceSampleCount[row.snapshotBucket][s] = (sourceSampleCount[row.snapshotBucket][s] ?? 0) + 1;
    }
  }

  const globalSigma = robustSigmaFromErrors(globalErrors, sigmaFloor);
  const baseSigma: CalibrationTables['baseSigma'] = {};
  const baseSigmaDebug: CalibrationTables['meta']['debug']['baseSigma'] = {
    '08': { sampleCount: 0, rawEstimate: sigmaFloor, smoothedEstimate: sigmaFloor, usedGlobalFallback: true },
    '11': { sampleCount: 0, rawEstimate: sigmaFloor, smoothedEstimate: sigmaFloor, usedGlobalFallback: true },
    '14': { sampleCount: 0, rawEstimate: sigmaFloor, smoothedEstimate: sigmaFloor, usedGlobalFallback: true },
    late: { sampleCount: 0, rawEstimate: sigmaFloor, smoothedEstimate: sigmaFloor, usedGlobalFallback: true }
  };
  for (const b of BUCKETS) {
    const n = bucketErrors[b].length;
    const bucketSigma = robustSigmaFromErrors(bucketErrors[b], sigmaFloor);
    const w = shrinkWeight(n, shrinkageK);
    const smoothed = Math.max(sigmaFloor, w * bucketSigma + (1 - w) * globalSigma);
    baseSigma[b] = smoothed;
    baseSigmaDebug[b] = {
      sampleCount: n,
      rawEstimate: bucketSigma,
      smoothedEstimate: smoothed,
      usedGlobalFallback: n === 0
    };
  }

  const globalSourceScore: Partial<Record<WeatherSourceName, number>> = {};
  for (const s of SOURCES) {
    const r = Math.max(0.15, rmse(sourceErrorsGlobal[s] ?? []));
    globalSourceScore[s] = 1 / (r * r);
  }
  const sourceWeights: CalibrationTables['sourceWeights'] = {};
  const sourceWeightsDebug: CalibrationTables['meta']['debug']['sourceWeights'] = {
    '08': {} as Record<WeatherSourceName, {
      sampleCount: number;
      rawScore: number;
      globalScore: number;
      smoothedScore: number;
      normalizedWeight: number;
      usedGlobalFallback: boolean;
    }>,
    '11': {} as Record<WeatherSourceName, {
      sampleCount: number;
      rawScore: number;
      globalScore: number;
      smoothedScore: number;
      normalizedWeight: number;
      usedGlobalFallback: boolean;
    }>,
    '14': {} as Record<WeatherSourceName, {
      sampleCount: number;
      rawScore: number;
      globalScore: number;
      smoothedScore: number;
      normalizedWeight: number;
      usedGlobalFallback: boolean;
    }>,
    late: {} as Record<WeatherSourceName, {
      sampleCount: number;
      rawScore: number;
      globalScore: number;
      smoothedScore: number;
      normalizedWeight: number;
      usedGlobalFallback: boolean;
    }>
  };
  for (const b of BUCKETS) {
    const score: Partial<Record<WeatherSourceName, number>> = {};
    let sum = 0;
    for (const s of SOURCES) {
      const errs = sourceErrorsByBucket[b][s] ?? [];
      const n = errs.length;
      const rBucket = Math.max(0.15, rmse(errs));
      const bucketScore = 1 / (rBucket * rBucket);
      const globalScore = globalSourceScore[s] ?? 0;
      const w = shrinkWeight(n, shrinkageK);
      const smoothed = w * bucketScore + (1 - w) * globalScore;
      score[s] = smoothed;
      sum += smoothed;
      sourceWeightsDebug[b][s] = {
        sampleCount: n,
        rawScore: bucketScore,
        globalScore,
        smoothedScore: smoothed,
        normalizedWeight: 0,
        usedGlobalFallback: n === 0
      };
    }
    if (sum <= 0) {
      sourceWeights[b] = {};
      continue;
    }
    const normalized: Partial<Record<WeatherSourceName, number>> = {};
    for (const s of SOURCES) {
      const w = (score[s] ?? 0) / sum;
      normalized[s] = w;
      sourceWeightsDebug[b][s].normalizedWeight = w;
    }
    sourceWeights[b] = normalized;
  }

  const globalCaps = {
    q50: quantile(globalRemains, 0.5),
    q75: quantile(globalRemains, 0.75),
    q90: quantile(globalRemains, 0.9),
    q95: quantile(globalRemains, 0.95)
  };
  const remainingCaps: CalibrationTables['remainingCaps'] = {};
  const remainingCapsDebug: CalibrationTables['meta']['debug']['remainingCaps'] = {
    '08': {
      sampleCount: 0,
      rawEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      smoothedEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      usedGlobalFallback: true
    },
    '11': {
      sampleCount: 0,
      rawEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      smoothedEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      usedGlobalFallback: true
    },
    '14': {
      sampleCount: 0,
      rawEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      smoothedEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      usedGlobalFallback: true
    },
    late: {
      sampleCount: 0,
      rawEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      smoothedEstimate: { q50: 0, q75: 0, q90: 0, q95: 0 },
      usedGlobalFallback: true
    }
  };
  for (const b of BUCKETS) {
    const vals = remainsByBucket[b];
    const n = vals.length;
    const bucketCaps = {
      q50: quantile(vals, 0.5),
      q75: quantile(vals, 0.75),
      q90: quantile(vals, 0.9),
      q95: quantile(vals, 0.95)
    };
    const w = shrinkWeight(n, shrinkageK);
    const smoothedCaps = {
      q50: w * bucketCaps.q50 + (1 - w) * globalCaps.q50,
      q75: w * bucketCaps.q75 + (1 - w) * globalCaps.q75,
      q90: w * bucketCaps.q90 + (1 - w) * globalCaps.q90,
      q95: w * bucketCaps.q95 + (1 - w) * globalCaps.q95
    };
    remainingCaps[b] = smoothedCaps;
    remainingCapsDebug[b] = {
      sampleCount: n,
      rawEstimate: bucketCaps,
      smoothedEstimate: smoothedCaps,
      usedGlobalFallback: n === 0
    };
  }

  return {
    baseSigma,
    sourceWeights,
    remainingCaps,
    meta: {
      bucketSampleCount,
      sourceSampleCount,
      minSamplesPerBucket,
      shrinkageK,
      usedSmoothing: true,
      debug: {
        baseSigma: baseSigmaDebug,
        sourceWeights: sourceWeightsDebug,
        remainingCaps: remainingCapsDebug
      }
    }
  };
}
