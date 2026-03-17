import type { NormalizedSnapshotRow, SnapshotBucket } from '@/src/lib/backtest/types';
import type { ProbabilityEngineInputUnified } from '@/src/lib/probability-engine';
import { resolveModelParamsForBucket, type ModelConfigFile } from '@/src/lib/model-config';

type AdapterTables = {
  baseSigma?: Record<string, number>;
  sourceWeights?: Record<string, Record<string, number>>;
  remainingCaps?: Record<string, { q90?: number }>;
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
  const resolved = resolveModelParamsForBucket({
    bucket: row.snapshotBucket,
    calibrationTables: calibrationTables ?? undefined,
    modelConfig,
    defaultLambda: 1.0
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
  const L = Number.isFinite(row.observedMaxSoFar) ? row.observedMaxSoFar : undefined;
  const U = Number.isFinite(row.observedMaxSoFar) && Number.isFinite(resolved.remainingCapQ90)
    ? (row.observedMaxSoFar as number) + Number(resolved.remainingCapQ90)
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
      maxContinuous: U
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

