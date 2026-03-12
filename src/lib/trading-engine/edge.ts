export function calculateEdge(modelProb: number, marketPrice: number): number {
  return modelProb - marketPrice;
}

export function edgeToScore(edge: number): number {
  if (edge < 0.03) return 10;
  if (edge < 0.08) return 40;
  if (edge < 0.12) return 70;
  if (edge < 0.18) return 85;
  return 95;
}
