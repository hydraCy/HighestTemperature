import type { StationType } from '@/src/lib/fusion-engine/types';

export type SourceKind = 'settlement' | 'observation' | 'forecast' | 'guidance';
export type SourceHealthStatus = 'healthy' | 'stale' | 'degraded' | 'down';

const BASE_SOURCE_WEIGHT: Record<SourceKind, number> = {
  settlement: 1.4,
  observation: 1.3,
  forecast: 1.0,
  guidance: 0.8
};

const HEALTH_SCORE: Record<SourceHealthStatus, number> = {
  healthy: 1,
  stale: 0.6,
  degraded: 0.4,
  down: 0
};

export function classifySourceKind(sourceName: string): SourceKind {
  const n = sourceName.toLowerCase();
  if (n.includes('wunderground') || n.includes('weather.com')) return 'settlement';
  if (n.includes('aviation') || n.includes('metar') || n.includes('taf')) return 'observation';
  if (n.includes('wttr')) return 'guidance';
  return 'forecast';
}

export function baseSourceWeight(kind: SourceKind) {
  return BASE_SOURCE_WEIGHT[kind];
}

export function stationMatchScore(stationType: StationType) {
  if (stationType === 'exact_station') return 1.0;
  if (stationType === 'city_level') return 0.85;
  if (stationType === 'region_grid') return 0.75;
  if (stationType === 'east_china_grid') return 0.6;
  return 0.85;
}

export function sourceFreshnessScore(forecastAgeHours?: number | null) {
  if (forecastAgeHours == null || !Number.isFinite(forecastAgeHours) || forecastAgeHours < 0) return 0.55;
  if (forecastAgeHours <= 3) return 1.0;
  if (forecastAgeHours <= 6) return 0.9;
  if (forecastAgeHours <= 12) return 0.75;
  if (forecastAgeHours <= 24) return 0.55;
  return 0.3;
}

export function sourceHealthScore(status?: SourceHealthStatus) {
  return HEALTH_SCORE[status ?? 'healthy'];
}

