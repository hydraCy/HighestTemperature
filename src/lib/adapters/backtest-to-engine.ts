import type { NormalizedSnapshotRow, SnapshotBucket } from '@/src/lib/backtest/types';
import type { ProbabilityEngineInputUnified } from '@/src/lib/probability-engine';
import { resolveModelParamsForBucket, type ModelConfigFile } from '@/src/lib/model-config';
import {
  bucketHoursToPeak,
  bucketObservedVsMuGap
} from '@/src/lib/trading-engine/delta-distribution';

type AdapterTables = {
  baseSigma?: Record<string, number>;
  sourceWeights?: Record<string, Record<string, number>>;
  remainingCaps?: Record<string, { q90?: number }>;
  remainingCapDistributions?: Record<string, {
    q25: number;
    q50: number;
    q75: number;
    q90: number;
    q95: number;
    mean: number;
    std: number;
    count: number;
  }>;
};

function weightedMean(points: Array<{ value: number; weight: number }>): number {
  const sumW = points.reduce((acc, x) => acc + x.weight, 0) || 1;
  return points.reduce((acc, x) => acc + x.value * x.weight, 0) / sumW;
}

function weightedSpreadSigma(points: Array<{ value: number; weight: number }>, mu: number): number {
  const sumW = points.reduce((acc, x) => acc + x.weight, 0) || 1;
  const variance = points.reduce((acc, x) => acc + x.weight * (x.value - mu) ** 2, 0) / sumW;
  return Math.sqrt(Math.max(0, variance));
}

export function backtestRowToProbabilityInput(params: {
  row: NormalizedSnapshotRow;
  binLabels: string[];
  modelConfig?: ModelConfigFile | null;
  calibrationTables?: AdapterTables | null;
  minTemp?: number;
  maxTemp?: number;
}) : {
  engineInput: ProbabilityEngineInputUnified;
  debug: {
    sourceWeightFallbackUsed: boolean;
    mu: number;
    spreadSigma: number;
    sigmaBase: number;
    lambda: number;
    finalSigma: number;
    L?: number;
    U?: number;
    configSource: 'calibration' | 'model_config' | 'default';
  };
} {
  const { row, binLabels, modelConfig, calibrationTables } = params;
  const snapshotHour = Number((row.snapshotTime.split(':')[0] ?? '12'));
  const peakHour = row.snapshotBucket === 'late' ? 16 : 14.5;
  const hoursToPeak = peakHour - snapshotHour;
  const observed = Number.isFinite(row.observedMaxSoFar) ? Number(row.observedMaxSoFar) : undefined;
  const quickMu = averageSources(row);
  const observedVsMuGap = observed != null ? Math.abs(observed - quickMu) : 0;
  const resolved = resolveModelParamsForBucket({
    bucket: row.snapshotBucket,
    calibrationTables: calibrationTables ?? undefined,
    modelConfig,
    defaultLambda: 1.0,
    context: {
      snapshotBucket: row.snapshotBucket,
      hoursToPeakBucket: bucketHoursToPeak(hoursToPeak),
      observedVsMuGapBucket: bucketObservedVsMuGap(observedVsMuGap)
    }
  });

  const bucketWeights = resolved.sourceWeights ?? {};
  const points = Object.entries(row.sources)
    .filter(([, v]) => Number.isFinite(v))
    .map(([source, value]) => ({
      source,
      value: value as number,
      weight: (bucketWeights[source] ?? 0)
    }));
  const hasWeighted = points.some((p) => p.weight > 0);
  const weightedPoints = hasWeighted
    ? points.filter((p) => p.weight > 0)
    : points.map((p) => ({ ...p, weight: 1 }));
  const mu = weightedMean(weightedPoints.map((x) => ({ value: x.value, weight: x.weight })));
  const spreadSigma = weightedSpreadSigma(
    weightedPoints.map((x) => ({ value: x.value, weight: x.weight })),
    mu
  );
  const sigmaBase = Number.isFinite(resolved.baseSigma) ? Number(resolved.baseSigma) : 1.0;
  const lambda = Number.isFinite(resolved.lambda) ? Number(resolved.lambda) : 1.0;
  const sigmaCalibrated = Math.sqrt(sigmaBase ** 2 + lambda * spreadSigma ** 2);
  const sigmaDynamicFloor = 0.8 + spreadSigma * 0.2;
  const finalSigma = Math.max(0.95, sigmaDynamicFloor, Math.min(3.0, sigmaCalibrated));
  const L = observed;
  const U = observed != null && Number.isFinite(resolved.remainingCapQ90)
    ? observed + Number(resolved.remainingCapQ90)
    : undefined;
  const deltaConstraint = observed != null && resolved.remainingCapDistribution
    ? {
      observedMax: observed,
      deltaMean: Math.max(0.01, resolved.remainingCapDistribution.q50),
      deltaStd: Math.max(0.35, resolved.remainingCapDistribution.std),
      deltaUpper: Math.max(0.2, resolved.remainingCapDistribution.q95),
      source: 'distribution' as const
    }
    : undefined;

  const engineInput: ProbabilityEngineInputUnified = {
    targetDate: row.targetDate,
    snapshotTime: row.snapshotTime,
    snapshotBucket: row.snapshotBucket as SnapshotBucket,
    sources: row.sources,
    observedMaxSoFar: row.observedMaxSoFar,
    currentTemp: row.currentTemp,
    cloudCover: row.cloudCover,
    windSpeed: row.windSpeed,
    rainProb: row.rainProb,
    marketBins: binLabels.map((label) => ({ label })),
    calibration: {
      lambda,
      baseSigma: sigmaBase,
      spreadSigma,
      source: resolved.source
    },
    distribution: {
      mu,
      sigma: finalSigma,
      minTemp: params.minTemp ?? 0,
      maxTemp: params.maxTemp ?? 45,
      minContinuous: L,
      maxContinuous: U,
      deltaConstraint
    }
  };

  return {
    engineInput,
    debug: {
      sourceWeightFallbackUsed: !hasWeighted,
      mu,
      spreadSigma,
      sigmaBase,
      lambda,
      finalSigma,
      L,
      U,
      configSource: resolved.source
    }
  };
}

function averageSources(row: NormalizedSnapshotRow) {
  const vals = Object.values(row.sources).filter((v): v is number => Number.isFinite(v));
  if (!vals.length) return row.currentTemp ?? row.finalMaxTemp;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
