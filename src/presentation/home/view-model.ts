export function buildRiskSet(riskFlags?: string[] | null) {
  return new Set(riskFlags ?? []);
}
