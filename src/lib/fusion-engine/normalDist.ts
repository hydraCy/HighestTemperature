export function erf(x: number) {
  // Abramowitz and Stegun formula 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number, mean: number, sigma: number) {
  const safeSigma = sigma > 0 ? sigma : 1e-6;
  const z = (x - mean) / (safeSigma * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

export function normalIntervalProbability(
  low: number,
  high: number,
  mean: number,
  sigma: number
) {
  return Math.max(0, normalCdf(high, mean, sigma) - normalCdf(low, mean, sigma));
}
