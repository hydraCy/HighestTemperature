export function calculatePositionSize(input: {
  totalCapital: number;
  maxSingleTradePercent: number;
  edge: number;
  sideProbability?: number;
  entryPrice?: number;
  riskModifier: number;
  kellyFraction?: number;
  maxSingleRiskPercent?: number;
  dailyRiskPercent?: number;
}): number {
  const p = Math.max(0, Math.min(1, input.sideProbability ?? 0));
  const q = Math.max(0, Math.min(1, input.entryPrice ?? 1));
  if (q <= 0 || q >= 1) return 0;

  // Binary market Kelly for contract priced at q: f* = (p - q) / (1 - q)
  const kellyFull = Math.max(0, (p - q) / (1 - q));
  const kellyFraction = Math.max(0, Math.min(1, input.kellyFraction ?? 0.25));
  const kellyStake = input.totalCapital * kellyFull * kellyFraction;

  const maxSingle = Math.max(0, input.maxSingleTradePercent);
  const maxSingleRisk = Math.max(0, input.maxSingleRiskPercent ?? 0.02);
  const dailyRisk = Math.max(0, input.dailyRiskPercent ?? 0.05);
  const hardCapPercent = Math.min(maxSingle, maxSingleRisk, dailyRisk);
  const hardCap = input.totalCapital * hardCapPercent;

  const sized = Math.min(hardCap, kellyStake) * input.riskModifier;
  if (input.edge <= 0) return 0;
  return Number(sized.toFixed(2));
}
