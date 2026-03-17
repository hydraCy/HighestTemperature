import fs from 'node:fs';
import path from 'node:path';
import type {
  BaseSigmaTable,
  RemainingCapTable,
  SnapshotBucket,
  SourceWeightTable
} from '@/src/lib/backtest/types';

export type ModelConfigFile = {
  lambda?: number;
  baseSigmaTable?: BaseSigmaTable;
  sourceWeightsTable?: SourceWeightTable;
  remainingCapTable?: RemainingCapTable;
};

export type ModelConfigResolved = {
  lambda: number;
  baseSigma?: number;
  sourceWeights?: Record<string, number>;
  remainingCapQ90?: number;
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
  } | null;
  modelConfig?: ModelConfigFile | null;
  defaultLambda?: number;
}) : ModelConfigResolved {
  const { bucket, calibrationTables, modelConfig, defaultLambda = 1.0 } = params;

  const calibBase = calibrationTables?.baseSigma?.[bucket];
  const calibWeights = calibrationTables?.sourceWeights?.[bucket] as Record<string, number> | undefined;
  const calibCap = calibrationTables?.remainingCaps?.[bucket]?.q90;

  if (
    Number.isFinite(calibBase) ||
    (calibWeights && Object.keys(calibWeights).length > 0) ||
    Number.isFinite(calibCap)
  ) {
    return {
      lambda: Number.isFinite(modelConfig?.lambda) ? Number(modelConfig?.lambda) : defaultLambda,
      baseSigma: Number.isFinite(calibBase) ? Number(calibBase) : undefined,
      sourceWeights: calibWeights,
      remainingCapQ90: Number.isFinite(calibCap) ? Number(calibCap) : undefined,
      source: 'calibration'
    };
  }

  const cfgBase = modelConfig?.baseSigmaTable?.[bucket];
  const cfgWeights = modelConfig?.sourceWeightsTable?.[bucket] as Record<string, number> | undefined;
  const cfgCap = modelConfig?.remainingCapTable?.[bucket]?.q90;
  if (
    Number.isFinite(cfgBase) ||
    (cfgWeights && Object.keys(cfgWeights).length > 0) ||
    Number.isFinite(cfgCap) ||
    Number.isFinite(modelConfig?.lambda)
  ) {
    return {
      lambda: Number.isFinite(modelConfig?.lambda) ? Number(modelConfig?.lambda) : defaultLambda,
      baseSigma: Number.isFinite(cfgBase) ? Number(cfgBase) : undefined,
      sourceWeights: cfgWeights,
      remainingCapQ90: Number.isFinite(cfgCap) ? Number(cfgCap) : undefined,
      source: 'model_config'
    };
  }

  return {
    lambda: defaultLambda,
    source: 'default'
  };
}

