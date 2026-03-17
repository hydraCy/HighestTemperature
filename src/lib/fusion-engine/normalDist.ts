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
  const safeSigma = Math.max(1e-6, sigma);
  const z = (x - mean) / (safeSigma * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

export function normalIntervalProbability(
  low: number,
  high: number,
  mean: number,
  sigma: number
) {
  if (!(high > low)) return 0;
  return Math.max(0, normalCdf(high, mean, sigma) - normalCdf(low, mean, sigma));
}

export function truncatedNormalCdf(
  x: number,
  mean: number,
  sigma: number,
  lower: number,
  upper: number
) {
  const safeSigma = Math.max(1e-6, sigma);

  if (!(upper > lower)) {
    if (x < lower) return 0;
    return 1;
  }

  if (x <= lower) return 0;
  if (x >= upper) return 1;

  const lowerCdf = normalCdf(lower, mean, safeSigma);
  const upperCdf = normalCdf(upper, mean, safeSigma);
  const z = upperCdf - lowerCdf;

  if (z <= 1e-12) {
    if (x < lower) return 0;
    if (x >= upper) return 1;
    return (x - lower) / (upper - lower);
  }

  const xCdf = normalCdf(x, mean, safeSigma);
  return Math.max(0, Math.min(1, (xCdf - lowerCdf) / z));
}

export function truncatedNormalIntervalProbability(
  a: number,
  b: number,
  mean: number,
  sigma: number,
  lower: number,
  upper: number
) {
  if (!(b > a)) return 0;
  if (!(upper > lower)) return 0;

  const left = Math.max(a, lower);
  const right = Math.min(b, upper);

  if (!(right > left)) return 0;

  const low = truncatedNormalCdf(left, mean, sigma, lower, upper);
  const high = truncatedNormalCdf(right, mean, sigma, lower, upper);
  return Math.max(0, high - low);
}
