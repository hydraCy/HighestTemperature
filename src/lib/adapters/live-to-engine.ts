import type { ProbabilityEngineInputUnified } from '@/src/lib/probability-engine';
import { resolveModelParamsForBucket, type ModelConfigFile } from '@/src/lib/model-config';
import type { SnapshotBucket } from '@/src/lib/backtest/types';

type LiveSourceDailyMax = {
  wundergroundDaily?: number | null;
  openMeteo?: number | null;
  wttr?: number | null;
  metNo?: number | null;
  weatherApi?: number | null;
  qWeather?: number | null;
  nwsHourly?: number | null;
  spread?: number | null;
  fusedContinuous?: number | null;
  fused?: number | null;
};

function toBucket(snapshotTime: string): SnapshotBucket {
  const m = snapshotTime.match(/^(\d{1,2}):/);
  const hour = m ? Number(m[1]) : NaN;
  if (Number.isFinite(hour)) {
    if (hour < 10) return '08';
    if (hour < 13) return '11';
    if (hour < 16) return '14';
    return 'late';
  }
  if (snapshotTime.startsWith('08')) return '08';
  if (snapshotTime.startsWith('11')) return '11';
  if (snapshotTime.startsWith('14')) return '14';
  return 'late';
}

function weightedMean(points: Array<{ value: number; weight: number }>): number {
  const sumW = points.reduce((acc, x) => acc + x.weight, 0) || 1;
  return points.reduce((acc, x) => acc + x.value * x.weight, 0) / sumW;
}

function weightedSpreadSigma(points: Array<{ value: number; weight: number }>, mu: number): number {
  const sumW = points.reduce((acc, x) => acc + x.weight, 0) || 1;
  const variance = points.reduce((acc, x) => acc + x.weight * (x.value - mu) ** 2, 0) / sumW;
  return Math.sqrt(Math.max(0, variance));
}

export function liveToProbabilityInput(params: {
  targetDateKey: string;
  snapshotTime: string;
  marketBins: Array<{ label: string; marketPrice?: number; noMarketPrice?: number; bestBid?: number }>;
  sourceDailyMax?: LiveSourceDailyMax | null;
  observedMaxSoFar?: number;
  currentTemp?: number;
  cloudCover?: number;
  windSpeed?: number;
  rainProb?: number;
  constraints?: {
    minContinuous?: number;
    maxContinuous?: number;
    minAllowedInteger?: number;
    maxAllowedInteger?: number;
  };
  fallbackMean?: number;
  fallbackSigma?: number;
  modelConfig?: ModelConfigFile | null;
}) : {
  engineInput: ProbabilityEngineInputUnified;
  debug: {
    mu: number;
    spreadSigmaRaw: number;
    spreadSigma: number;
    sigmaBase: number;
    lambda: number;
    finalSigma: number;
    sourceWeightFallbackUsed: boolean;
    configSource: 'calibration' | 'model_config' | 'default';
  };
} {
  const bucket = toBucket(params.snapshotTime);
  const resolved = resolveModelParamsForBucket({
    bucket,
    modelConfig: params.modelConfig,
    defaultLambda: 1.0
  });
  const sourceDailyMax = params.sourceDailyMax ?? {};
  const sourceMap: Record<string, number> = {
    wunderground: Number(sourceDailyMax.wundergroundDaily),
    openMeteo: Number(sourceDailyMax.openMeteo),
    wttr: Number(sourceDailyMax.wttr),
    metNo: Number(sourceDailyMax.metNo),
    weatherAPI: Number(sourceDailyMax.weatherApi),
    qWeather: Number(sourceDailyMax.qWeather),
    nwsHourly: Number(sourceDailyMax.nwsHourly)
  };
  const points = Object.entries(sourceMap)
    .filter(([, v]) => Number.isFinite(v))
    .map(([source, value]) => ({
      source,
      value,
      weight: resolved.sourceWeights?.[source] ?? 0
    }));
  const hasWeighted = points.some((p) => p.weight > 0);
  const weightedPoints = hasWeighted
    ? points.filter((p) => p.weight > 0)
    : points.map((p) => ({ ...p, weight: 1 }));
  const fallbackFused = Number(sourceDailyMax.fusedContinuous ?? sourceDailyMax.fused ?? params.fallbackMean ?? params.currentTemp ?? 0);
  const mu = weightedPoints.length
    ? weightedMean(weightedPoints.map((x) => ({ value: x.value, weight: x.weight })))
    : fallbackFused;
  const spreadSigmaRaw = weightedPoints.length >= 2
    ? weightedSpreadSigma(weightedPoints.map((x) => ({ value: x.value, weight: x.weight })), mu)
    : Math.max(0.2, Number(sourceDailyMax.spread ?? 0.5) * 0.3);
  // Realtime spread can spike with noisy/sparse sources. Use conservative compression
  // to avoid over-wide sigma and fat right tails.
  const spreadSigmaClamped = Math.max(0.2, Math.min(2.6, spreadSigmaRaw));
  const spreadSigma = 0.65 * spreadSigmaClamped + 0.35 * Math.min(1.0, spreadSigmaClamped);
  const heuristicBaseSigma = Number.isFinite(sourceDailyMax.spread)
    ? Math.max(0.75, Math.min(1.6, 0.78 + Number(sourceDailyMax.spread) * 0.17))
    : Number(params.fallbackSigma ?? 1.05);
  const sigmaBase = Number.isFinite(resolved.baseSigma) ? Number(resolved.baseSigma) : heuristicBaseSigma;
  const lambda = Number.isFinite(resolved.lambda) ? Number(resolved.lambda) : 1.0;
  const sigmaCalibrated = Math.sqrt(sigmaBase ** 2 + lambda * spreadSigma ** 2);
  const sigmaDynamicFloor = 0.85 + spreadSigma * 0.12;
  const sigmaCap = 1.65;
  const finalSigma = Math.max(0.95, sigmaDynamicFloor, Math.min(sigmaCap, sigmaCalibrated));

  const engineInput: ProbabilityEngineInputUnified = {
    targetDate: params.targetDateKey,
    snapshotTime: params.snapshotTime,
    snapshotBucket: bucket,
    sources: sourceMap,
    observedMaxSoFar: params.observedMaxSoFar,
    currentTemp: params.currentTemp,
    cloudCover: params.cloudCover,
    windSpeed: params.windSpeed,
    rainProb: params.rainProb,
    marketBins: params.marketBins,
    calibration: {
      lambda,
      baseSigma: sigmaBase,
      spreadSigma,
      source: resolved.source
    },
    distribution: {
      mu,
      sigma: finalSigma,
      minTemp: 0,
      maxTemp: 45,
      minContinuous: params.constraints?.minContinuous,
      maxContinuous: params.constraints?.maxContinuous,
      minAllowedInteger: params.constraints?.minAllowedInteger,
      maxAllowedInteger: params.constraints?.maxAllowedInteger
    }
  };

  return {
    engineInput,
    debug: {
      mu,
      spreadSigmaRaw,
      spreadSigma,
      sigmaBase,
      lambda,
      finalSigma,
      sourceWeightFallbackUsed: !hasWeighted,
      configSource: resolved.source
    }
  };
}
