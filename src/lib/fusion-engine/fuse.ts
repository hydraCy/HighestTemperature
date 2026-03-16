import {
  calibrationQualityScore,
  applyBiasCalibration,
  calibrationMap,
  getCalibration,
  sourceSigmaFromMae
} from '@/src/lib/fusion-engine/calibration';
import { buildFusionExplanation } from '@/src/lib/fusion-engine/explain';
import { matchScore } from '@/src/lib/fusion-engine/matchScore';
import { normalIntervalProbability } from '@/src/lib/fusion-engine/normalDist';
import { regimeScoreForSource } from '@/src/lib/fusion-engine/regimeScore';
import { scenarioLabel, scenarioScoreForSource } from '@/src/lib/fusion-engine/scenarioScore';
import type {
  FusionInput,
  FusionOutput,
  OutcomeProbability,
  SourceBreakdown
} from '@/src/lib/fusion-engine/types';

function normalizeWeights(weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const equal = 1 / Math.max(1, weights.length);
    return weights.map(() => equal);
  }
  return weights.map((w) => w / sum);
}

function normalizeOutcomeProbabilities(items: OutcomeProbability[]) {
  const sum = items.reduce((acc, i) => acc + i.probability, 0);
  if (sum <= 0) {
    const equal = 1 / Math.max(1, items.length);
    return items.map((i) => ({ ...i, probability: equal }));
  }
  return items.map((i) => ({ ...i, probability: i.probability / sum }));
}

function buildOutcomeProbabilities(mean: number, sigma: number, low = 10, high = 25) {
  const rows: OutcomeProbability[] = [];
  for (let k = low; k <= high; k += 1) {
    const p = normalIntervalProbability(k - 0.5, k + 0.5, mean, sigma);
    rows.push({ label: `${k}°C`, probability: p });
  }
  return normalizeOutcomeProbabilities(rows);
}

export function runFusionEngine(input: FusionInput): FusionOutput {
  if (!input.sources.length) {
    throw new Error('Fusion engine requires at least one weather source input');
  }

  const calibMap = calibrationMap(input.calibrations);

  const scenario = scenarioLabel(input.scenarioContext);
  const preAdjusted = input.sources.map((src) => {
    const cal = getCalibration(src.sourceName, calibMap);
    return {
      sourceName: src.sourceName,
      stationType: src.stationType,
      explicitResolutionStation: src.explicitResolutionStation,
      rawPredictedMaxTemp: src.rawPredictedMaxTemp,
      adjustedPredictedMaxTemp: applyBiasCalibration(src.rawPredictedMaxTemp, cal.bias),
      mae: cal.mae,
      calibration: cal
    };
  });

  const adjustedMean = preAdjusted.reduce((acc, x) => acc + x.adjustedPredictedMaxTemp, 0) / preAdjusted.length;

  const scored = preAdjusted.map((row) => {
    const mScore = matchScore(row.stationType);
    const stationPenaltyScore = row.sourceName === 'wunderground_daily'
      ? 1
      : row.explicitResolutionStation
        ? 1
        : 0.72;
    const aScore = calibrationQualityScore(row.calibration);
    const sScore = scenarioScoreForSource(
      input.scenarioContext,
      row.adjustedPredictedMaxTemp,
      adjustedMean
    );
    const rScore = regimeScoreForSource(row.sourceName, row.stationType, {
      ...input.scenarioContext,
      scenarioTag: input.scenarioContext.scenarioTag ?? scenario
    });
    const rawWeight = mScore * stationPenaltyScore * aScore * sScore * rScore;
    return {
      ...row,
      matchScore: mScore,
      stationPenaltyScore,
      accuracyScore: aScore,
      scenarioScore: sScore,
      regimeScore: rScore,
      rawWeight,
      sourceSigma: sourceSigmaFromMae(row.mae)
    };
  });

  const normWeights = normalizeWeights(scored.map((x) => x.rawWeight));

  const sourceBreakdown: SourceBreakdown[] = scored.map((s, i) => ({
    sourceName: s.sourceName,
    rawPredictedMaxTemp: s.rawPredictedMaxTemp,
    adjustedPredictedMaxTemp: s.adjustedPredictedMaxTemp,
    matchScore: Number(s.matchScore.toFixed(4)),
    stationPenaltyScore: Number(s.stationPenaltyScore.toFixed(4)),
    accuracyScore: Number(s.accuracyScore.toFixed(4)),
    scenarioScore: Number(s.scenarioScore.toFixed(4)),
    regimeScore: Number(s.regimeScore.toFixed(4)),
    finalWeight: Number(normWeights[i].toFixed(6))
  }));

  const fusedTemp = scored.reduce((acc, s, i) => acc + s.adjustedPredictedMaxTemp * normWeights[i], 0);
  const fusedSigma = scored.reduce((acc, s, i) => acc + s.sourceSigma * normWeights[i], 0);
  const outcomeProbabilities = buildOutcomeProbabilities(fusedTemp, fusedSigma, 10, 25);

  const output: FusionOutput = {
    fusedTemp: Number(fusedTemp.toFixed(3)),
    fusedSigma: Number(fusedSigma.toFixed(3)),
    outcomeProbabilities,
    sourceBreakdown,
    explanation: ''
  };

  output.explanation = buildFusionExplanation(output, scenario);
  return output;
}
