import type { ProbabilityEngineInput, ProbabilityEngineOutput } from '@/src/lib/probability-engine/types';
import {
  buildIntegerSettlementDistribution,
  mapIntegerDistributionToBins
} from '@/src/lib/trading-engine/settlementMapping';

export function runProbabilityEngine(input: ProbabilityEngineInput): ProbabilityEngineOutput {
  // Probability engine contract:
  // distribution is determined only by mu/sigma and bounds (L/U + optional integer hard bounds).
  // Short-term future temperatures are NOT consumed here directly; they should be translated
  // upstream into constraints before entering this engine.
  const unifiedMode = 'distribution' in input;
  const dist = unifiedMode
    ? input.distribution
    : {
      mu: input.mu,
      sigma: input.sigma,
      minTemp: input.minTemp,
      maxTemp: input.maxTemp,
      minContinuous: input.minContinuous,
      maxContinuous: input.maxContinuous,
      minAllowedInteger: input.minAllowedInteger,
      maxAllowedInteger: input.maxAllowedInteger,
      sigmaBelowMean: input.sigmaBelowMean,
      sigmaAboveMean: input.sigmaAboveMean
    };
  const binLabels = unifiedMode ? input.marketBins.map((b) => b.label) : input.binLabels;

  const integerDistribution = buildIntegerSettlementDistribution({
    mean: dist.mu,
    sigma: dist.sigma,
    minTemp: dist.minTemp,
    maxTemp: dist.maxTemp,
    minContinuous: dist.minContinuous,
    maxContinuous: dist.maxContinuous,
    minAllowedInteger: dist.minAllowedInteger,
    maxAllowedInteger: dist.maxAllowedInteger,
    sigmaBelowMean: dist.sigmaBelowMean,
    sigmaAboveMean: dist.sigmaAboveMean
  });

  const binProbabilities = mapIntegerDistributionToBins(binLabels, integerDistribution);

  const integerProbabilities = Object.fromEntries(
    integerDistribution.map((x) => [String(x.temp), x.probability])
  );
  const binProbsMap = Object.fromEntries(
    binLabels.map((label, i) => [label, binProbabilities[i] ?? 0])
  );

  return {
    integerDistribution,
    binProbabilities,
    debugSummary: {
      model: 'truncated_normal_to_integer_rounding',
      mu: dist.mu,
      sigma: dist.sigma,
      L: Number.isFinite(dist.minContinuous) ? dist.minContinuous : undefined,
      U: Number.isFinite(dist.maxContinuous) ? dist.maxContinuous : undefined,
      integerProbabilities,
      binProbabilities: binProbsMap,
      minAllowedInteger: Number.isFinite(dist.minAllowedInteger) ? dist.minAllowedInteger : undefined,
      maxAllowedInteger: Number.isFinite(dist.maxAllowedInteger) ? dist.maxAllowedInteger : undefined,
      inputMode: unifiedMode ? 'unified' : 'legacy',
      targetDate: unifiedMode ? input.targetDate : undefined,
      snapshotTime: unifiedMode ? input.snapshotTime : undefined,
      snapshotBucket: unifiedMode ? input.snapshotBucket : undefined,
      calibration: unifiedMode ? input.calibration : undefined
    }
  };
}
