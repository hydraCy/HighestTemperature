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

type WeightedSourcePoint = {
  source: string;
  value: number;
  weight: number;
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

function toFiniteNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function sanitizeWeightedPoints(points: WeightedSourcePoint[]): {
  points: WeightedSourcePoint[];
  removed: Array<{ source: string; value: number; reason: string }>;
} {
  if (points.length <= 2) return { points, removed: [] };
  const values = points.map((p) => p.value);
  const med = median(values);
  const absDev = values.map((v) => Math.abs(v - med));
  const mad = median(absDev);
  const robustScale = Math.max(0.6, 1.4826 * mad);

  const cleaned: WeightedSourcePoint[] = [];
  const removed: Array<{ source: string; value: number; reason: string }> = [];

  for (const p of points) {
    const dev = Math.abs(p.value - med);
    // Some upstream sources encode missing as 0. When peer median is clearly warm,
    // treat this as missing-like outlier instead of a real temperature observation.
    if (p.value <= 0 && med >= 8) {
      removed.push({ source: p.source, value: p.value, reason: 'zero_value_suspected_missing' });
      continue;
    }
    // Hard drop impossible scale mismatch points (e.g. unexpected unit / parse issue).
    if (dev >= 6) {
      removed.push({ source: p.source, value: p.value, reason: 'hard_outlier_gte_6c_from_median' });
      continue;
    }
    // Soft downweight moderate outliers to avoid a single source dominating spread.
    const zRobust = dev / robustScale;
    const downweight = zRobust > 2.2 ? 0.35 : zRobust > 1.6 ? 0.6 : 1;
    cleaned.push({ ...p, weight: p.weight * downweight });
  }

  // Keep at least 2 points if possible.
  // If aggressive filtering leaves too few points, prefer positive-valued sources first
  // (missing-like zeros should not re-enter spread computation).
  if (cleaned.length < 2) {
    const positive = points.filter((p) => p.value > 0);
    if (positive.length >= 2) return { points: positive, removed };
    return { points, removed };
  }
  return { points: cleaned, removed };
}

export function liveToProbabilityInput(params: {
  locationKey?: 'shanghai' | 'hongkong';
  targetDateKey: string;
  isTargetDateToday?: boolean;
  isFutureDate?: boolean;
  dayOffset?: number;
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
    deltaConstraint?: {
      observedMax: number;
      deltaMean: number;
      deltaStd: number;
      deltaUpper: number;
      source?: 'distribution' | 'distribution_fallback' | 'none';
    };
  };
  fallbackMean?: number;
  fallbackSigma?: number;
  modelConfig?: ModelConfigFile | null;
}) : {
  engineInput: ProbabilityEngineInputUnified;
  debug: {
    mu: number;
    spreadSigmaRaw: number;
    spreadSigmaEffective: number;
    sigmaBase: number;
    lambda: number;
    finalSigma: number;
    sigmaNarrowFloor: number;
    constraintIntervalWidth?: number;
    sourceWeightFallbackUsed: boolean;
    configSource: 'calibration' | 'model_config' | 'default';
    sourcePoints: Array<{
      source: string;
      value: number;
      weight: number;
      diff: number;
      weightedSqContribution: number;
    }>;
    removedSources: Array<{ source: string; value: number; reason: string }>;
  };
} {
  const bucket = toBucket(params.snapshotTime);
  const resolved = resolveModelParamsForBucket({
    bucket,
    modelConfig: params.modelConfig,
    defaultLambda: 1.0
  });
  const sourceDailyMax = params.sourceDailyMax ?? {};
  const sourceMapRaw: Partial<Record<string, number>> = {
    wunderground: toFiniteNumber(sourceDailyMax.wundergroundDaily),
    openMeteo: toFiniteNumber(sourceDailyMax.openMeteo),
    wttr: toFiniteNumber(sourceDailyMax.wttr),
    metNo: toFiniteNumber(sourceDailyMax.metNo),
    weatherAPI: toFiniteNumber(sourceDailyMax.weatherApi),
    qWeather: toFiniteNumber(sourceDailyMax.qWeather),
    nwsHourly: toFiniteNumber(sourceDailyMax.nwsHourly)
  };
  const sourceMap: Record<string, number> = Object.fromEntries(
    Object.entries(sourceMapRaw).filter(([, v]) => Number.isFinite(v))
  ) as Record<string, number>;

  const points = Object.entries(sourceMap)
    .filter(([, v]) => Number.isFinite(v))
    .map(([source, value]) => ({
      source,
      value,
      weight: resolved.sourceWeights?.[source] ?? 0
    }));
  const hasWeighted = points.some((p) => p.weight > 0);
  const weightedPointsRaw = hasWeighted
    ? points.filter((p) => p.weight > 0)
    : points.map((p) => ({ ...p, weight: 1 }));
  const sanitized = sanitizeWeightedPoints(weightedPointsRaw);
  const weightedPoints = sanitized.points;
  const fallbackFused = Number(sourceDailyMax.fusedContinuous ?? sourceDailyMax.fused ?? params.fallbackMean ?? params.currentTemp ?? 0);
  const mu = weightedPoints.length
    ? weightedMean(weightedPoints.map((x) => ({ value: x.value, weight: x.weight })))
    : fallbackFused;
  const spreadSigmaRaw = weightedPoints.length >= 2
    ? weightedSpreadSigma(weightedPoints.map((x) => ({ value: x.value, weight: x.weight })), mu)
    : Math.max(0.25, Math.min(1.2, Number(sourceDailyMax.spread ?? 0.6) * 0.22));
  // futureTemps is used only for constraint bounding, not for shaping the distribution.
  // Realtime source spread is stabilized at the raw stage so final sigma is not dominated by hard cap.
  const spreadSigmaWinsor = Math.max(0.25, Math.min(2.2, spreadSigmaRaw));
  const spreadSigmaEffective = 0.72 * spreadSigmaWinsor + 0.28 * Math.min(0.95, spreadSigmaWinsor);
  const heuristicBaseSigma = Number.isFinite(sourceDailyMax.spread)
    ? Math.max(0.75, Math.min(1.6, 0.78 + Number(sourceDailyMax.spread) * 0.17))
    : Number(params.fallbackSigma ?? 1.05);
  const sigmaBase = Number.isFinite(resolved.baseSigma) ? Number(resolved.baseSigma) : heuristicBaseSigma;
  const lambda = Number.isFinite(resolved.lambda) ? Number(resolved.lambda) : 1.0;
  const sigmaCalibrated = Math.sqrt(sigmaBase ** 2 + lambda * spreadSigmaEffective ** 2);
  const sigmaDynamicFloor = 0.9 + spreadSigmaEffective * 0.1;
  const l = params.constraints?.minContinuous;
  const u = params.constraints?.maxContinuous;
  const intervalWidth =
    Number.isFinite(l) && Number.isFinite(u) && Number(u) > Number(l)
      ? Number(u) - Number(l)
      : undefined;
  // Narrow truncation intervals can yield overly sharp post-truncation probabilities.
  // Keep a modest uncertainty floor in narrow-window cases without changing model structure.
  const sigmaNarrowFloor =
    intervalWidth == null
      ? 0.95
      : intervalWidth <= 0.7
        ? 1.12
        : intervalWidth <= 1.0
          ? 1.06
          : intervalWidth <= 1.3
            ? 1.0
            : 0.95;
  const sigmaCap = 1.65;
  const finalSigma = Math.max(0.95, sigmaDynamicFloor, sigmaNarrowFloor, Math.min(sigmaCap, sigmaCalibrated));

  const sumW = weightedPoints.reduce((acc, p) => acc + p.weight, 0) || 1;
  const sourcePointsDebug = weightedPoints.map((p) => {
    const diff = p.value - mu;
    const weightedSqContribution = (p.weight * diff * diff) / sumW;
    return {
      source: p.source,
      value: p.value,
      weight: p.weight,
      diff,
      weightedSqContribution
    };
  });

  const engineInput: ProbabilityEngineInputUnified = {
    locationKey: params.locationKey ?? 'shanghai',
    targetDate: params.targetDateKey,
    isTargetDateToday: Boolean(params.isTargetDateToday),
    isFutureDate: Boolean(params.isFutureDate),
    dayOffset: Number.isFinite(params.dayOffset) ? Number(params.dayOffset) : 0,
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
      spreadSigma: spreadSigmaEffective,
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
      maxAllowedInteger: params.constraints?.maxAllowedInteger,
      deltaConstraint: params.constraints?.deltaConstraint
    }
  };

  return {
    engineInput,
    debug: {
      mu,
      spreadSigmaRaw,
      spreadSigmaEffective,
      sigmaBase,
      lambda,
      finalSigma,
      sigmaNarrowFloor,
      constraintIntervalWidth: intervalWidth,
      sourceWeightFallbackUsed: !hasWeighted,
      configSource: resolved.source,
      sourcePoints: sourcePointsDebug,
      removedSources: sanitized.removed
    }
  };
}
