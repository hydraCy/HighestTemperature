export function edgeToMultiplier(edge: number): number {
  if (edge < 0.03) return 0;
  if (edge < 0.08) return 0.25;
  if (edge < 0.12) return 0.5;
  if (edge < 0.18) return 0.75;
  return 1;
}

export function calculatePositionSize(input: {
  totalCapital: number;
  maxSingleTradePercent: number;
  edge: number;
  riskModifier: number;
}): number {
  const maxTradeSize = input.totalCapital * input.maxSingleTradePercent;
  const base = maxTradeSize * edgeToMultiplier(input.edge);
  return Number((base * input.riskModifier).toFixed(2));
}
