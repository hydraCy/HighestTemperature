export type LuInvariantSummary = {
  isValid: boolean;
  issues: string[];
};

export function evaluateLuInvariants(params: {
  lower?: number;
  upper?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
}): LuInvariantSummary {
  const issues: string[] = [];
  const { lower, upper, minAllowedInteger, maxAllowedInteger } = params;

  if (Number.isFinite(lower) && Number.isFinite(upper) && (lower as number) > (upper as number)) {
    issues.push('continuous_bounds_inverted');
  }

  if (
    Number.isFinite(minAllowedInteger) &&
    Number.isFinite(maxAllowedInteger) &&
    (minAllowedInteger as number) > (maxAllowedInteger as number)
  ) {
    issues.push('integer_bounds_inverted');
  }

  return { isValid: issues.length === 0, issues };
}
