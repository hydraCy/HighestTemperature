export type SourceDailyMaxLite = {
  fusedContinuous?: number | null;
  fusedAnchor?: number | null;
  fused?: number | null;
} | null | undefined;

export function selectModelPanelForecast(sourceDailyMax: SourceDailyMaxLite) {
  const continuous =
    (typeof sourceDailyMax?.fusedContinuous === 'number' && Number.isFinite(sourceDailyMax.fusedContinuous))
      ? sourceDailyMax.fusedContinuous
      : null;
  const integer =
    (typeof sourceDailyMax?.fusedAnchor === 'number' && Number.isFinite(sourceDailyMax.fusedAnchor))
      ? Math.round(sourceDailyMax.fusedAnchor)
      : null;
  return { integer, continuous };
}

