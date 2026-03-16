export function calculateDataQualityScore(input: {
  resolutionReady: boolean;
  weatherReady: boolean;
  marketReady: boolean;
  modelReady: boolean;
  rulesParsed?: boolean;
  hasCompleteSources?: boolean;
  weatherFreshnessHours?: number | null;
  avgSourceHealthScore?: number | null;
}): number {
  if (!input.resolutionReady) return 0;

  let score = 100;
  if (input.rulesParsed === false) score = Math.min(score, 70);
  if (!input.weatherReady) score = Math.min(score, 40);
  if (!input.marketReady) score -= 25;
  if (!input.modelReady) score -= 25;
  if (input.hasCompleteSources === false) score -= 20;
  if (input.weatherFreshnessHours != null && Number.isFinite(input.weatherFreshnessHours)) {
    if (input.weatherFreshnessHours > 24) score -= 30;
    else if (input.weatherFreshnessHours > 12) score -= 18;
    else if (input.weatherFreshnessHours > 6) score -= 10;
    else if (input.weatherFreshnessHours > 3) score -= 5;
  }
  if (input.avgSourceHealthScore != null && Number.isFinite(input.avgSourceHealthScore)) {
    score *= Math.max(0.4, Math.min(1, input.avgSourceHealthScore));
  }

  return Math.max(0, Math.min(100, score));
}
