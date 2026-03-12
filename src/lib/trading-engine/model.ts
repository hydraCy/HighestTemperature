import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

export function estimateBinProbabilities(input: {
  bins: string[];
  currentTemp: number;
  maxTempSoFar: number;
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

  const raw = input.bins.map((label) => {
    const p = parseTemperatureBin(label);
    let center = projectedFinal;
    if (p.min != null && p.max != null) center = (p.min + p.max) / 2;
    else if (p.min != null) center = p.min + 0.8;
    else if (p.max != null) center = p.max - 0.8;

    const diff = Math.abs(projectedFinal - center);
    return Math.exp(-Math.pow(diff / 1.2, 2));
  });

  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((x) => x / sum);
}
