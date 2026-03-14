import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

export function estimateBinProbabilities(input: {
  bins: string[];
  currentTemp: number;
  maxTempSoFar: number;
  observedMaxTemp?: number;
  forecastAnchorTemp?: number;
  isTargetDateToday?: boolean;
  futureTemp1h?: number;
  futureTemp2h?: number;
  futureTemp3h?: number;
  tempRise1h: number;
  tempRise2h: number;
  tempRise3h: number;
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
  sigma?: number;
}): number[] {
  const width = Number.isFinite(input.sigma) ? Math.max(0.7, Number(input.sigma)) : 1.2;
  const momentum = input.tempRise2h * 0.6 + input.tempRise1h * 0.4;
  const weatherPenalty = input.cloudCover > 70 ? 0.8 : 0.2 + input.precipitationProb * 0.01;
  const forecastAnchor = Number.isFinite(input.forecastAnchorTemp)
    ? Number(input.forecastAnchorTemp)
    : input.maxTempSoFar;
  const projectedFinalRaw = Math.max(
    forecastAnchor,
    input.maxTempSoFar,
    input.currentTemp + momentum - weatherPenalty + (input.tempRise3h > 0.8 ? 0.2 : 0),
  );
  const futureTemps = [input.futureTemp1h, input.futureTemp2h, input.futureTemp3h].filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );
  const futureCap = futureTemps.length
    ? Math.max(input.maxTempSoFar, input.currentTemp, ...futureTemps) + 0.4
    : Number.POSITIVE_INFINITY;
  const projectedFinal = Math.min(projectedFinalRaw, futureCap);

  const raw = input.bins.map((label) => {
    const p = parseTemperatureBin(label);
    let center = projectedFinal;
    if (p.min != null && p.max != null) center = (p.min + p.max) / 2;
    else if (p.min != null) center = p.min + 0.8;
    else if (p.max != null) center = p.max - 0.8;

    const diff = Math.abs(projectedFinal - center);
    return Math.exp(-Math.pow(diff / width, 2));
  });

  // Hard impossibility gate for integer-resolution settlement bins:
  // only observed/realized temperatures can invalidate lower bins.
  const hardFloor = Math.max(
    input.maxTempSoFar,
    input.observedMaxTemp ?? Number.NEGATIVE_INFINITY,
    input.isTargetDateToday ? input.currentTemp : Number.NEGATIVE_INFINITY,
  );
  const gated = raw.map((v, idx) => {
    const p = parseTemperatureBin(input.bins[idx]);
    if (p.max != null && hardFloor >= p.max) return 0;
    return v;
  });

  let sum = gated.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // Fallback: assign all mass to bin containing hardFloor.
    const fallback: number[] = input.bins.map((label) => {
      const p = parseTemperatureBin(label);
      if (p.min != null && p.max != null) return hardFloor >= p.min && hardFloor < p.max ? 1 : 0;
      if (p.min != null && p.max == null) return hardFloor >= p.min ? 1 : 0;
      if (p.min == null && p.max != null) return hardFloor < p.max ? 1 : 0;
      return 0;
    });
    sum = fallback.reduce((a, b) => a + b, 0) || 1;
    return fallback.map((x) => x / sum);
  }
  return gated.map((x) => x / sum);
}
