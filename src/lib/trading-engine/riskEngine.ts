export function buildRiskFlags(input: {
  cloudCover: number;
  precipitationProb: number;
  tempRise1h: number;
}): string[] {
  const flags: string[] = [];

  if (input.precipitationProb > 40) flags.push('precipitation_risk');
  if (input.cloudCover > 70) flags.push('cloud_risk');
  if (input.tempRise1h <= 0) flags.push('warming_stalled');

  return flags;
}

export function calculateRiskModifier(input: {
  cloudCover: number;
  precipitationProb: number;
  tempRise1h: number;
}): number {
  if (input.precipitationProb > 40) return 0.4;
  if (input.cloudCover > 70) return 0.7;
  if (input.tempRise1h <= 0) return 0.5;
  return 1.0;
}
