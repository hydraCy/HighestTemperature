import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { normalIntervalProbability } from '@/src/lib/fusion-engine/normalDist';
import { normalizeProbabilities } from '@/lib/utils/probability';

type IntegerProbability = {
  temp: number;
  probability: number;
};

export function buildIntegerSettlementDistribution(params: {
  mean: number;
  sigma: number;
  minTemp?: number;
  maxTemp?: number;
  minAllowedInteger?: number;
}): IntegerProbability[] {
  const minTemp = Number.isFinite(params.minTemp) ? Math.floor(Number(params.minTemp)) : 0;
  const maxTemp = Number.isFinite(params.maxTemp) ? Math.ceil(Number(params.maxTemp)) : 45;
  const sigma = Math.max(0.6, params.sigma);
  const hardMin = Number.isFinite(params.minAllowedInteger)
    ? Math.floor(Number(params.minAllowedInteger))
    : Number.NEGATIVE_INFINITY;
  const rows: IntegerProbability[] = [];
  for (let k = minTemp; k <= maxTemp; k += 1) {
    rows.push({
      temp: k,
      probability: k < hardMin ? 0 : normalIntervalProbability(k - 0.5, k + 0.5, params.mean, sigma)
    });
  }
  const normalized = normalizeProbabilities(rows.map((r) => r.probability));
  return rows.map((r, i) => ({ ...r, probability: normalized[i] ?? 0 }));
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
