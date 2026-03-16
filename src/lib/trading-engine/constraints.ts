export type ConstraintInput = {
  isTargetDateToday: boolean;
  nowHourLocal: number;
  learnedPeakWindowStartHour?: number;
  learnedPeakWindowEndHour?: number;
  observedMaxTemp?: number;
  currentTemp: number;
  futureTemps1To6h: number[];
  cloudCover: number;
  windSpeed: number;
};

export type ConstraintOutput = {
  observedFloorInteger?: number;
  reachabilityFloorInteger?: number;
  lateSessionCeilingInteger?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  maxPotentialRise: number;
};

export function computeConstraintBounds(input: ConstraintInput): ConstraintOutput {
  if (!input.isTargetDateToday) {
    return {
      maxPotentialRise: 2.2
    };
  }

  const observedFloorInteger =
    input.observedMaxTemp != null && Number.isFinite(input.observedMaxTemp)
      ? Math.round(input.observedMaxTemp)
      : undefined;

  const maxFutureTemp = input.futureTemps1To6h.length
    ? Math.max(...input.futureTemps1To6h)
    : Number.NEGATIVE_INFINITY;
  const reachabilityFloorInteger = Number.isFinite(maxFutureTemp)
    ? Math.floor(maxFutureTemp)
    : undefined;

  // C2: reachable upside estimate from short-term forcing.
  let maxPotentialRise = 1.2;
  if (input.cloudCover < 40) maxPotentialRise += 0.4;
  if (input.windSpeed < 18) maxPotentialRise += 0.3;
  if (input.nowHourLocal < 14) maxPotentialRise += 0.5;
  if (input.nowHourLocal > 16) maxPotentialRise -= 0.4;
  maxPotentialRise = Math.max(0, Math.min(3, maxPotentialRise));

  const peakEnd = Number.isFinite(input.learnedPeakWindowEndHour)
    ? Number(input.learnedPeakWindowEndHour)
    : 16.5;
  const lateSession = input.nowHourLocal >= peakEnd;
  const lateSessionCeilingInteger = lateSession
    ? Math.floor(Math.max(input.currentTemp, maxFutureTemp, (input.observedMaxTemp ?? input.currentTemp)) + Math.min(0.5, maxPotentialRise * 0.4))
    : undefined;

  const minAllowedInteger = [observedFloorInteger, reachabilityFloorInteger]
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);

  return {
    observedFloorInteger,
    reachabilityFloorInteger,
    lateSessionCeilingInteger,
    minAllowedInteger: Number.isFinite(minAllowedInteger) ? minAllowedInteger : undefined,
    maxAllowedInteger: lateSessionCeilingInteger,
    maxPotentialRise
  };
}

