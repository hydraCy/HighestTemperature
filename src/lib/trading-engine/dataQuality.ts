export function calculateDataQualityScore(input: {
  resolutionReady: boolean;
  weatherReady: boolean;
  marketReady: boolean;
  modelReady: boolean;
}): number {
  if (!input.resolutionReady) return 0;

  let score = 100;
  if (!input.weatherReady) score = Math.min(score, 40);
  if (!input.marketReady) score -= 25;
  if (!input.modelReady) score -= 25;

  return Math.max(0, Math.min(100, score));
}
