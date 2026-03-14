import type { HistoricalCalibration } from '@/src/lib/fusion-engine/types';

const DEFAULT_CALIBRATION: Omit<HistoricalCalibration, 'sourceName'> = {
  sampleSize: 0,
  bias: 0,
  mae: 1.5,
  exactHitRate: 0,
  within1CHitRate: 0
};

export function calibrationMap(items: HistoricalCalibration[]) {
  return new Map(items.map((x) => [x.sourceName, x]));
}

export function getCalibration(
  sourceName: string,
  map: Map<string, HistoricalCalibration>
): HistoricalCalibration {
  return map.get(sourceName) ?? { sourceName, ...DEFAULT_CALIBRATION };
}

export function applyBiasCalibration(rawPredictedMaxTemp: number, bias: number) {
  return rawPredictedMaxTemp - bias;
}

export function accuracyScoreFromMae(mae: number) {
  const safeMae = Number.isFinite(mae) && mae >= 0 ? mae : DEFAULT_CALIBRATION.mae;
  return 1 / (safeMae + 0.25);
}

export function calibrationQualityScore(cal: HistoricalCalibration) {
  const maeScore = accuracyScoreFromMae(cal.mae);
  const hit = Number.isFinite(cal.within1CHitRate) ? Math.max(0, Math.min(1, cal.within1CHitRate)) : 0.5;
  const sample = Number.isFinite(cal.sampleSize) ? Math.max(0, cal.sampleSize) : 0;
  const sampleFactor = sample / (sample + 12);
  return maeScore * (0.7 + 0.3 * hit) * Math.max(0.25, sampleFactor);
}

export function sourceSigmaFromMae(mae: number) {
  const safeMae = Number.isFinite(mae) && mae >= 0 ? mae : DEFAULT_CALIBRATION.mae;
  return Math.max(0.6, safeMae * 1.25);
}
