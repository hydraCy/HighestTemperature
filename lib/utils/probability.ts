export function normalizeProbabilities(values: number[]): number[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = safe.reduce((acc, v) => acc + v, 0);
  if (sum <= 0) {
    const equal = 1 / Math.max(values.length, 1);
    return values.map(() => equal);
  }
  return safe.map((v) => v / sum);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
