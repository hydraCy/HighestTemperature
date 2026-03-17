import type { DistributionCheck } from '@/src/lib/backtest/types';

export function checkDistributionLegality(params: {
  targetDate: string;
  snapshotTime: '08:00' | '11:00' | '14:00' | '15:30';
  bucket: '08' | '11' | '14' | 'late';
  integerProbabilities: { temp: number; probability: number }[];
  minContinuous?: number;
  maxContinuous?: number;
  epsilon?: number;
}): DistributionCheck {
  const epsilon = params.epsilon ?? 1e-8;
  let lowerImpossibleMass = 0;
  let upperImpossibleMass = 0;

  const minInteger = Number.isFinite(params.minContinuous)
    ? Math.floor((params.minContinuous as number) + 0.5)
    : Number.NEGATIVE_INFINITY;
  const maxInteger = Number.isFinite(params.maxContinuous)
    ? Math.floor((params.maxContinuous as number) + 0.5)
    : Number.POSITIVE_INFINITY;

  for (const row of params.integerProbabilities) {
    if (row.temp < minInteger) lowerImpossibleMass += row.probability;
    if (row.temp > maxInteger) upperImpossibleMass += row.probability;
  }

  return {
    targetDate: params.targetDate,
    snapshotTime: params.snapshotTime,
    bucket: params.bucket,
    minContinuous: params.minContinuous,
    maxContinuous: params.maxContinuous,
    lowerImpossibleMass,
    upperImpossibleMass,
    pass: lowerImpossibleMass <= epsilon && upperImpossibleMass <= epsilon
  };
}

