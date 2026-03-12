export function calculateWeatherStabilityScore(input: {
  cloudCover: number;
  precipitationProb: number;
  tempRise1h: number;
}): number {
  let score = 90;

  if (input.cloudCover > 70) score -= 20;
  else if (input.cloudCover > 50) score -= 8;

  if (input.precipitationProb > 40) score -= 35;
  else if (input.precipitationProb > 20) score -= 15;

  if (input.tempRise1h <= 0) score -= 20;
  else if (input.tempRise1h < 0.2) score -= 10;

  return Math.max(0, Math.min(100, score));
}
