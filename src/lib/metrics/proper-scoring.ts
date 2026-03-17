const EPS = 1e-12;

export function brierScoreMulticlass(
  predicted: number[][],
  actualIndex: number[]
): number {
  if (!predicted.length) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    const row = predicted[i];
    const y = actualIndex[i];
    if (!row || y == null || y < 0 || y >= row.length) continue;
    let rowScore = 0;
    for (let j = 0; j < row.length; j += 1) {
      const o = j === y ? 1 : 0;
      const p = row[j] ?? 0;
      rowScore += (p - o) * (p - o);
    }
    sum += rowScore;
    count += 1;
  }
  return count ? sum / count : 0;
}

export function logLossMulticlass(
  predicted: number[][],
  actualIndex: number[]
): number {
  if (!predicted.length) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < predicted.length; i += 1) {
    const row = predicted[i];
    const y = actualIndex[i];
    if (!row || y == null || y < 0 || y >= row.length) continue;
    const p = Math.max(EPS, Math.min(1 - EPS, row[y] ?? 0));
    sum += -Math.log(p);
    count += 1;
  }
  return count ? sum / count : 0;
}

