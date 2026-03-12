import type { ScenarioContext } from '@/src/lib/fusion-engine/types';

export function isStableSunnyScenario(s: ScenarioContext) {
  return s.cloudCover < 40 && s.precipitationProb < 20 && s.tempRise1h > 0;
}

export function baseScenarioScore(s: ScenarioContext) {
  let score = 1;
  if (s.cloudCover > 70) score *= 0.85;
  if (s.precipitationProb > 40) score *= 0.75;
  if (s.tempRise1h <= 0) score *= 0.8;
  return score;
}

export function scenarioScoreForSource(
  scenario: ScenarioContext,
  adjustedPredictedMaxTemp: number,
  sourceMeanAdjustedTemp: number
) {
  let score = baseScenarioScore(scenario);
  if (isStableSunnyScenario(scenario)) {
    const highTilt = adjustedPredictedMaxTemp - sourceMeanAdjustedTemp;
    if (highTilt > 0.8) score *= 1.1;
    else if (highTilt > 0.2) score *= 1.05;
  }
  return score;
}

export function scenarioLabel(s: ScenarioContext) {
  if (isStableSunnyScenario(s)) return 'stable_sunny';
  if (s.cloudCover > 70 || s.precipitationProb > 40 || s.tempRise1h <= 0) return 'suppressed_heating';
  return 'neutral';
}
