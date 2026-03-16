export type RegimeInput = {
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
  windDirection?: number | null;
  tempRise1h: number;
  tafRisk?: {
    precipLike?: boolean;
    convectiveLike?: boolean;
    lowCeilingLike?: boolean;
  } | null;
};

export type RegimeOutput = {
  marineIntrusionRisk: number;
  cloudSuppressionRisk: number;
  convectiveRisk: number;
  stableHeatingDay: boolean;
  latePeakChance: number;
  scenarioTag: 'stable_sunny' | 'suppressed_heating' | 'neutral';
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function classifyWeatherRegime(input: RegimeInput): RegimeOutput {
  const cloudSuppressionRisk = clamp01((input.cloudCover - 45) / 45);
  const precipCore = clamp01((input.precipitationProb - 20) / 60);
  const convectiveRisk = clamp01(
    Math.max(
      precipCore,
      input.tafRisk?.convectiveLike ? 0.85 : 0,
      input.tafRisk?.precipLike ? 0.65 : 0
    )
  );
  const onshoreWind = input.windDirection != null && input.windDirection >= 70 && input.windDirection <= 160;
  const marineIntrusionRisk = clamp01((onshoreWind ? 0.5 : 0.1) + clamp01((input.windSpeed - 14) / 20) * 0.6);
  const stableHeatingDay =
    input.cloudCover < 35 &&
    input.precipitationProb < 20 &&
    input.tempRise1h > 0.2 &&
    convectiveRisk < 0.25;
  const latePeakChance = clamp01(
    (stableHeatingDay ? 0.55 : 0.25) +
    (onshoreWind ? -0.15 : 0.05) +
    (input.tempRise1h > 0.4 ? 0.15 : 0)
  );

  const scenarioTag: RegimeOutput['scenarioTag'] = stableHeatingDay
    ? 'stable_sunny'
    : (cloudSuppressionRisk > 0.55 || convectiveRisk > 0.45 || input.tempRise1h <= 0)
      ? 'suppressed_heating'
      : 'neutral';

  return {
    marineIntrusionRisk,
    cloudSuppressionRisk,
    convectiveRisk,
    stableHeatingDay,
    latePeakChance,
    scenarioTag
  };
}

