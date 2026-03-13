import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

export function estimateBinProbabilities(input: {
  bins: string[];
  currentTemp: number;
  maxTempSoFar: number;
  observedMaxTemp?: number;
  tempRise1h: number;
  tempRise2h: number;
  tempRise3h: number;
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
}): number[] {
  const momentum = input.tempRise2h * 0.6 + input.tempRise1h * 0.4;
  const weatherPenalty = input.cloudCover > 70 ? 0.8 : 0.2 + input.precipitationProb * 0.01;
  const projectedFinal = Math.max(input.maxTempSoFar, input.currentTemp + momentum - weatherPenalty + (input.tempRise3h > 0.8 ? 0.2 : 0));
  const projectedFloor = Math.floor(projectedFinal);

  const raw = input.bins.map((label) => {
    const p = parseTemperatureBin(label);
    let center = projectedFinal;
    if (p.min != null && p.max != null) center = (p.min + p.max) / 2;
    else if (p.min != null) center = p.min + 0.8;
    else if (p.max != null) center = p.max - 0.8;

    const diff = Math.abs(projectedFinal - center);
    return Math.exp(-Math.pow(diff / 1.2, 2));
  });

  // Hard impossibility gate for integer-resolution settlement bins:
  // if current/observed/projected floor already exceeds a bin's upper bound,
  // that bin cannot be final winning outcome.
  const hardFloor = Math.max(
    input.currentTemp,
    input.maxTempSoFar,
    input.observedMaxTemp ?? Number.NEGATIVE_INFINITY
  );
  const gated = raw.map((v, idx) => {
    const p = parseTemperatureBin(input.bins[idx]);
    if (p.max != null && hardFloor >= p.max) return 0;
    // Strategy hard gate: if projected anchor has already crossed this bin's upper bound,
    // we no longer consider this bin as a meaningful YES candidate.
    if (p.max != null && projectedFloor >= p.max) return 0;
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
