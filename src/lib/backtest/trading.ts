export type TradeDecision = 'BUY' | 'WATCH' | 'PASS';

export function calculateEdge(probability: number, marketPrice: number): number {
  return probability - marketPrice;
}

export function classifyEdgeDecision(
  edge: number,
  sigma: number,
  sigmaThreshold: number
): TradeDecision {
  if (edge > 0.08 && sigma < sigmaThreshold) return 'BUY';
  if (edge > 0.04) return 'WATCH';
  return 'PASS';
}

