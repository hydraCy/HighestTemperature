import fs from 'node:fs';
import path from 'node:path';
import type {
  BaseSigmaTable,
  HoursToPeakBucket,
  ObservedVsMuGapBucket,
  RemainingCapDistributionTable,
  RemainingCapTable,
  SnapshotBucket,
  SourceWeightTable
} from '@/src/lib/backtest/types';
import {
  buildDeltaDistributionKey,
  fallbackStdFromQuantiles,
  isValidDeltaStats
} from '@/src/lib/trading-engine/delta-distribution';

export type ModelConfigFile = {
  lambda?: number;
  baseSigmaTable?: BaseSigmaTable;
  sourceWeightsTable?: SourceWeightTable;
  remainingCapTable?: RemainingCapTable;
  remainingCapDistributionTable?: RemainingCapDistributionTable;
};

export type ModelConfigResolved = {
  lambda: number;
  baseSigma?: number;
  sourceWeights?: Record<string, number>;
  remainingCapQ75?: number;
  remainingCapQ90?: number;
  remainingCapDistribution?: {
    key: string;
    q25: number;
    q50: number;
    q75: number;
    q90: number;
    q95: number;
    mean: number;
    std: number;
    count: number;
  };
  source: 'calibration' | 'model_config' | 'default';
};

let cachedPath = '';
let cachedConfig: ModelConfigFile | null = null;

function defaultModelConfigPath() {
  return process.env.MODEL_CONFIG_PATH
    ? path.resolve(process.cwd(), process.env.MODEL_CONFIG_PATH)
    : path.resolve(process.cwd(), 'config/model-config.json');
}

export function loadModelConfig(filePath?: string): ModelConfigFile | null {
  const resolvedPath = filePath ? path.resolve(process.cwd(), filePath) : defaultModelConfigPath();
  if (cachedPath === resolvedPath) return cachedConfig;
  cachedPath = resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    cachedConfig = null;
    return cachedConfig;
  }
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const json = JSON.parse(raw) as ModelConfigFile;
    cachedConfig = json;
    return cachedConfig;
  } catch {
    cachedConfig = null;
    return cachedConfig;
  }
}

export function resolveModelParamsForBucket(params: {
  bucket: SnapshotBucket;
  calibrationTables?: {
    baseSigma?: BaseSigmaTable;
    sourceWeights?: SourceWeightTable;
    remainingCaps?: RemainingCapTable;
    remainingCapDistributions?: RemainingCapDistributionTable;
  } | null;
  modelConfig?: ModelConfigFile | null;
  defaultLambda?: number;
  context?: {
    snapshotBucket: SnapshotBucket;
    hoursToPeakBucket: HoursToPeakBucket;
    observedVsMuGapBucket: ObservedVsMuGapBucket;
  };
}) : ModelConfigResolved {
  const { bucket, calibrationTables, modelConfig, defaultLambda = 1.0 } = params;
  const distributionKey = params.context
    ? buildDeltaDistributionKey({
      snapshotBucket: params.context.snapshotBucket,
      hoursToPeakBucket: params.context.hoursToPeakBucket,
      observedVsMuGapBucket: params.context.observedVsMuGapBucket
    })
    : undefined;

  const calibBase = calibrationTables?.baseSigma?.[bucket];
  const calibWeights = calibrationTables?.sourceWeights?.[bucket] as Record<string, number> | undefined;
  const calibCapQ75 = calibrationTables?.remainingCaps?.[bucket]?.q75;
  const calibCap = calibrationTables?.remainingCaps?.[bucket]?.q90;
  const calibCapQ50 = calibrationTables?.remainingCaps?.[bucket]?.q50;
  const calibCapQ95 = calibrationTables?.remainingCaps?.[bucket]?.q95;
  const calibDist = distributionKey ? calibrationTables?.remainingCapDistributions?.[distributionKey] : undefined;
  const calibDistSynth =
    Number.isFinite(calibCapQ50) && Number.isFinite(calibCap) && Number.isFinite(calibCapQ95)
      ? {
        key: distributionKey ?? `${bucket}|derived`,
        q25: Number(calibCapQ50) * 0.75,
        q50: Number(calibCapQ50),
        q75: Number.isFinite(calibCapQ75) ? Number(calibCapQ75) : (Number(calibCapQ50) + Number(calibCap)) / 2,
        q90: Number(calibCap),
        q95: Number(calibCapQ95),
        mean: Number(calibCapQ50),
        std: fallbackStdFromQuantiles(Number(calibCapQ50), Number(calibCap)),
        count: 0
      }
      : undefined;

  if (
    Number.isFinite(calibBase) ||
    (calibWeights && Object.keys(calibWeights).length > 0) ||
    Number.isFinite(calibCap) ||
    isValidDeltaStats(calibDist)
  ) {
    return {
      lambda: Number.isFinite(modelConfig?.lambda) ? Number(modelConfig?.lambda) : defaultLambda,
      baseSigma: Number.isFinite(calibBase) ? Number(calibBase) : undefined,
      sourceWeights: calibWeights,
      remainingCapQ75: Number.isFinite(calibCapQ75) ? Number(calibCapQ75) : undefined,
      remainingCapQ90: Number.isFinite(calibCap) ? Number(calibCap) : undefined,
      remainingCapDistribution: isValidDeltaStats(calibDist)
        ? {
          key: distributionKey ?? '',
          q25: calibDist.q25,
          q50: calibDist.q50,
          q75: calibDist.q75,
          q90: calibDist.q90,
          q95: calibDist.q95,
          mean: calibDist.mean,
          std: calibDist.std,
          count: calibDist.count
        }
        : calibDistSynth,
      source: 'calibration'
    };
  }

  const cfgBase = modelConfig?.baseSigmaTable?.[bucket];
  const cfgWeights = modelConfig?.sourceWeightsTable?.[bucket] as Record<string, number> | undefined;
  const cfgCapQ75 = modelConfig?.remainingCapTable?.[bucket]?.q75;
  const cfgCap = modelConfig?.remainingCapTable?.[bucket]?.q90;
  const cfgCapQ50 = modelConfig?.remainingCapTable?.[bucket]?.q50;
  const cfgCapQ95 = modelConfig?.remainingCapTable?.[bucket]?.q95;
  const cfgDist = distributionKey ? modelConfig?.remainingCapDistributionTable?.[distributionKey] : undefined;
  const cfgDistSynth =
    Number.isFinite(cfgCapQ50) && Number.isFinite(cfgCap) && Number.isFinite(cfgCapQ95)
      ? {
        key: distributionKey ?? `${bucket}|derived`,
        q25: Number(cfgCapQ50) * 0.75,
        q50: Number(cfgCapQ50),
        q75: Number.isFinite(cfgCapQ75) ? Number(cfgCapQ75) : (Number(cfgCapQ50) + Number(cfgCap)) / 2,
        q90: Number(cfgCap),
        q95: Number(cfgCapQ95),
        mean: Number(cfgCapQ50),
        std: fallbackStdFromQuantiles(Number(cfgCapQ50), Number(cfgCap)),
        count: 0
      }
      : undefined;
  if (
    Number.isFinite(cfgBase) ||
    (cfgWeights && Object.keys(cfgWeights).length > 0) ||
    Number.isFinite(cfgCap) ||
    isValidDeltaStats(cfgDist) ||
    Number.isFinite(modelConfig?.lambda)
  ) {
    return {
      lambda: Number.isFinite(modelConfig?.lambda) ? Number(modelConfig?.lambda) : defaultLambda,
      baseSigma: Number.isFinite(cfgBase) ? Number(cfgBase) : undefined,
      sourceWeights: cfgWeights,
      remainingCapQ75: Number.isFinite(cfgCapQ75) ? Number(cfgCapQ75) : undefined,
      remainingCapQ90: Number.isFinite(cfgCap) ? Number(cfgCap) : undefined,
      remainingCapDistribution: isValidDeltaStats(cfgDist)
        ? {
          key: distributionKey ?? '',
          q25: cfgDist.q25,
          q50: cfgDist.q50,
          q75: cfgDist.q75,
          q90: cfgDist.q90,
          q95: cfgDist.q95,
          mean: cfgDist.mean,
          std: cfgDist.std,
          count: cfgDist.count
        }
        : cfgDistSynth,
      source: 'model_config'
    };
  }

  return {
    lambda: defaultLambda,
    source: 'default'
  };
}
