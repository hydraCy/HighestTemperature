import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { truncatedNormalIntervalProbability } from '@/src/lib/fusion-engine/normalDist';
import { normalizeProbabilities } from '@/lib/utils/probability';

type IntegerProbability = {
  temp: number;
  probability: number;
};

export type SettlementDistributionDebugSummary = {
  mean: number;
  sigma: number;
  sigmaBelowMean: number;
  sigmaAboveMean: number;
  minContinuous?: number;
  maxContinuous?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  rawMassSum: number;
  normalized: boolean;
  activeIntegers: number[];
  zeroedByHardIntegerBounds: number[];
  model: 'truncated_normal_to_integer_rounding';
};

export function buildIntegerSettlementDistribution(params: {
  mean: number;
  sigma: number;
  minTemp?: number;
  maxTemp?: number;
  minContinuous?: number;
  maxContinuous?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  sigmaBelowMean?: number;
  sigmaAboveMean?: number;
}): IntegerProbability[] {
  const minTemp = Number.isFinite(params.minTemp) ? Math.floor(Number(params.minTemp)) : 0;
  const maxTemp = Number.isFinite(params.maxTemp) ? Math.ceil(Number(params.maxTemp)) : 45;
  const sigma = Math.max(0.6, params.sigma);
  const sigmaBelow = Math.max(0.4, Number.isFinite(params.sigmaBelowMean) ? Number(params.sigmaBelowMean) : sigma);
  const sigmaAbove = Math.max(0.4, Number.isFinite(params.sigmaAboveMean) ? Number(params.sigmaAboveMean) : sigma);
  const lower = Number.isFinite(params.minContinuous) ? Number(params.minContinuous) : Number.NEGATIVE_INFINITY;
  const upper = Number.isFinite(params.maxContinuous) ? Number(params.maxContinuous) : Number.POSITIVE_INFINITY;
  const hardMin = Number.isFinite(params.minAllowedInteger)
    ? Math.floor(Number(params.minAllowedInteger))
    : Number.NEGATIVE_INFINITY;
  const hardMax = Number.isFinite(params.maxAllowedInteger)
    ? Math.floor(Number(params.maxAllowedInteger))
    : Number.POSITIVE_INFINITY;
  const rows: IntegerProbability[] = [];
  for (let k = minTemp; k <= maxTemp; k += 1) {
    if (k < hardMin || k > hardMax) {
      rows.push({ temp: k, probability: 0 });
      continue;
    }
    const localSigma = k < params.mean ? sigmaBelow : sigmaAbove;
    rows.push({
      temp: k,
      probability: truncatedNormalIntervalProbability(
        k - 0.5,
        k + 0.5,
        params.mean,
        localSigma,
        lower,
        upper
      )
    });
  }
  // This distribution is built from a truncated continuous density:
  // 1) compute per-integer settlement interval mass in continuous space
  // 2) normalize to a discrete PMF across all integer buckets
  const raw = rows.map((r) => (Number.isFinite(r.probability) && r.probability > 0 ? r.probability : 0));
  const sum = raw.reduce((acc, v) => acc + v, 0);

  if (sum <= 1e-12) {
    // Safety fallback for extremely narrow/degenerate bounds:
    // place all mass on the nearest feasible integer to mean.
    const feasible = rows.filter((r) => r.temp >= hardMin && r.temp <= hardMax);
    if (!feasible.length) {
      return rows.map((r) => ({ ...r, probability: 0 }));
    }
    const target = [...feasible].sort((a, b) => Math.abs(a.temp - params.mean) - Math.abs(b.temp - params.mean))[0]?.temp;
    return rows.map((r) => ({ ...r, probability: r.temp === target ? 1 : 0 }));
  }

  const normalized = normalizeProbabilities(raw);
  return rows.map((r, i) => ({ ...r, probability: normalized[i] ?? 0 }));
}

export function buildSettlementDistributionDebugSummary(params: {
  mean: number;
  sigma: number;
  sigmaBelowMean: number;
  sigmaAboveMean: number;
  minContinuous?: number;
  maxContinuous?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  integerDistribution: IntegerProbability[];
}): SettlementDistributionDebugSummary {
  const hardMin = Number.isFinite(params.minAllowedInteger)
    ? Math.floor(Number(params.minAllowedInteger))
    : Number.NEGATIVE_INFINITY;
  const hardMax = Number.isFinite(params.maxAllowedInteger)
    ? Math.floor(Number(params.maxAllowedInteger))
    : Number.POSITIVE_INFINITY;
  const rawMassSum = params.integerDistribution.reduce((acc, r) => acc + (Number.isFinite(r.probability) ? r.probability : 0), 0);
  return {
    mean: params.mean,
    sigma: params.sigma,
    sigmaBelowMean: params.sigmaBelowMean,
    sigmaAboveMean: params.sigmaAboveMean,
    minContinuous: params.minContinuous,
    maxContinuous: params.maxContinuous,
    minAllowedInteger: Number.isFinite(params.minAllowedInteger) ? params.minAllowedInteger : undefined,
    maxAllowedInteger: Number.isFinite(params.maxAllowedInteger) ? params.maxAllowedInteger : undefined,
    rawMassSum,
    normalized: Math.abs(rawMassSum - 1) < 1e-6,
    activeIntegers: params.integerDistribution.filter((r) => r.probability > 0).map((r) => r.temp),
    zeroedByHardIntegerBounds: params.integerDistribution
      .filter((r) => r.temp < hardMin || r.temp > hardMax)
      .map((r) => r.temp),
    model: 'truncated_normal_to_integer_rounding'
  };
}

function binContainsInteger(label: string, integerTemp: number) {
  const p = parseTemperatureBin(label);
  if (p.min != null && p.max != null) return integerTemp >= p.min && integerTemp < p.max;
  if (p.min != null && p.max == null) return integerTemp >= p.min;
  if (p.min == null && p.max != null) return integerTemp < p.max;
  return false;
}

export function mapIntegerDistributionToBins(
  bins: string[],
  integerDistribution: IntegerProbability[]
) {
  const raw = bins.map((label) => {
    let prob = 0;
    for (const row of integerDistribution) {
      if (binContainsInteger(label, row.temp)) prob += row.probability;
    }
    return prob;
  });
  return normalizeProbabilities(raw);
}

export function pickMostLikelyInteger(integerDistribution: IntegerProbability[]) {
  return [...integerDistribution].sort((a, b) => b.probability - a.probability)[0]?.temp ?? 0;
}
