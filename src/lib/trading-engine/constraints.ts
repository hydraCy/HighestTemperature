export type ConstraintInput = {
  isTargetDateToday: boolean;
  nowHourLocal: number;
  snapshotBucket?: '08' | '11' | '14' | 'late';
  learnedPeakWindowStartHour?: number;
  learnedPeakWindowEndHour?: number;
  observedMaxTemp?: number;
  currentTemp: number;
  // NOTE:
  // futureTemps1To6h is used ONLY to compute constraint bounds (maxFutureTemp/reachability/upper bound).
  // It must NOT be used to shape the probability distribution (mu/sigma).
  futureTemps1To6h: number[];
  cloudCover: number;
  windSpeed: number;
  peakHourLocal?: number;
  observedVsMuGap?: number;
  deltaDistribution?: {
    key?: string;
    q25?: number;
    q50?: number;
    q75?: number;
    q90?: number;
    q95?: number;
    mean?: number;
    std?: number;
    count?: number;
  };
};

export type ConstraintOutput = {
  observedFloorInteger?: number;
  reachabilityFloorInteger?: number;
  lateSessionCeilingInteger?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  minContinuous?: number;
  maxContinuous?: number;
  maxPotentialRise: number;
  debugSummary: {
    continuousLowerSource: 'observed_max' | 'none';
    continuousUpperSource: 'observed_plus_rise_cap' | 'late_session_tightened' | 'none';
    continuousBoundPriority: string;
    reachabilityFloorAppliedInV1: false;
    maxFutureTemp?: number;
    hoursToPeak?: number;
    hoursToPeakBucket?: 'far' | 'medium' | 'near' | 'very_near';
    observedVsMuGap?: number;
    observedVsMuGapBucket?: 'low' | 'medium' | 'high';
    deltaDistributionKey?: string;
    deltaMean?: number;
    deltaStd?: number;
    deltaQ50?: number;
    deltaQ75?: number;
    deltaQ90?: number;
    deltaQ95?: number;
    remainingCapSource?: 'distribution' | 'distribution_fallback' | 'heuristic_realtime_v1';
    upperSupportLow?: number;
    upperSupportHigh?: number;
    remainingCapFinal?: number;
    riseComponents?: {
      base: number;
      cloudAdj: number;
      windAdj: number;
      timeAdj: number;
      futureAdj: number;
      distributionAdj?: number;
      total: number;
    };
  };
};

export function computeConstraintBounds(input: ConstraintInput): ConstraintOutput {
  if (!input.isTargetDateToday) {
    return {
      maxPotentialRise: 2.2,
      debugSummary: {
        continuousLowerSource: 'none',
        continuousUpperSource: 'none',
        continuousBoundPriority:
          'non_today: no observed floor and no continuous upper cap in v1',
        reachabilityFloorAppliedInV1: false,
        maxFutureTemp: Number.isFinite(input.futureTemps1To6h[0]) ? Math.max(...input.futureTemps1To6h) : undefined
      }
    };
  }

  const observedFloorInteger =
    input.observedMaxTemp != null && Number.isFinite(input.observedMaxTemp)
      ? Math.round(input.observedMaxTemp)
      : undefined;
  const observedFloorContinuous =
    input.observedMaxTemp != null && Number.isFinite(input.observedMaxTemp)
      ? input.observedMaxTemp
      : undefined;

  // Future 1-6h temperatures only contribute to bounding logic (constraints).
  // They do not participate in distribution parameter estimation.
  const maxFutureTemp = input.futureTemps1To6h.length
    ? Math.max(...input.futureTemps1To6h)
    : Number.NEGATIVE_INFINITY;
  const reachabilityFloorInteger = Number.isFinite(maxFutureTemp)
    ? Math.floor(maxFutureTemp)
    : undefined;
  // reachabilityFloorInteger is currently for diagnostics/UI only.
  // We intentionally do not use it as a hard lower bound yet.

  // C2: reachable upside estimate from short-term forcing.
  // Keep this conservative in realtime to avoid overly fat right tails.
  const baseRise = 1.0;
  const cloudAdj = input.cloudCover < 40 ? 0.25 : input.cloudCover > 70 ? -0.25 : 0;
  const windAdj = input.windSpeed < 18 ? 0.2 : input.windSpeed > 28 ? -0.2 : 0;
  const timeAdj = input.nowHourLocal < 11
    ? 0.25
    : input.nowHourLocal < 14
      ? 0.15
      : input.nowHourLocal > 18
        ? -0.25
        : input.nowHourLocal > 16
          ? -0.35
          : 0;
  const futureAdj = Number.isFinite(maxFutureTemp) && maxFutureTemp <= input.currentTemp + 0.3 ? -0.2 : 0;
  const baseCap = Math.max(0, Math.min(3, baseRise + cloudAdj + windAdj + timeAdj + futureAdj));
  const delta = input.deltaDistribution;
  const deltaQ50 = Number.isFinite(delta?.q50) ? Number(delta?.q50) : undefined;
  const deltaQ75 = Number.isFinite(delta?.q75) ? Number(delta?.q75) : undefined;
  const deltaQ90 = Number.isFinite(delta?.q90) ? Number(delta?.q90) : undefined;
  const deltaQ95 = Number.isFinite(delta?.q95) ? Number(delta?.q95) : undefined;
  const deltaMean = Number.isFinite(delta?.mean) ? Number(delta?.mean) : undefined;
  const deltaStd = Number.isFinite(delta?.std) ? Number(delta?.std) : undefined;
  const capFromDistribution = deltaQ90;
  let maxPotentialRise = capFromDistribution != null
    ? Math.max(baseCap, capFromDistribution)
    : baseCap;
  maxPotentialRise = Math.max(0, Math.min(3, maxPotentialRise));
  const distributionAdj = capFromDistribution != null ? Math.max(0, capFromDistribution - baseCap) : 0;

  const peakHour = Number.isFinite(input.peakHourLocal) ? Number(input.peakHourLocal) : 14.5;
  const hoursToPeak = peakHour - input.nowHourLocal;
  const hoursToPeakBucket = hoursToPeak > 6 ? 'far' : hoursToPeak > 3 ? 'medium' : hoursToPeak > 1 ? 'near' : 'very_near';
  const observedVsMuGap = Number.isFinite(input.observedVsMuGap) ? Number(input.observedVsMuGap) : undefined;
  const observedVsMuGapBucket =
    observedVsMuGap == null
      ? undefined
      : observedVsMuGap <= 0.8
        ? 'low'
        : observedVsMuGap <= 2.0
          ? 'medium'
          : 'high';

  const peakEnd = Number.isFinite(input.learnedPeakWindowEndHour)
    ? Number(input.learnedPeakWindowEndHour)
    : 16.5;
  const lateSession = input.nowHourLocal >= peakEnd;
  const lateSessionCeilingInteger = lateSession
    ? Math.floor(Math.max(input.currentTemp, maxFutureTemp, (input.observedMaxTemp ?? input.currentTemp)) + Math.min(0.5, maxPotentialRise * 0.4))
    : undefined;
  const generalContinuousUpperBound =
    observedFloorContinuous != null
      ? observedFloorContinuous + maxPotentialRise
      : undefined;
  const lateSessionContinuousUpperBound =
    lateSessionCeilingInteger != null
      ? lateSessionCeilingInteger + 0.499
      : undefined;
  const continuousUpperBound =
    generalContinuousUpperBound != null && lateSessionContinuousUpperBound != null
      ? Math.min(generalContinuousUpperBound, lateSessionContinuousUpperBound)
      : (generalContinuousUpperBound ?? lateSessionContinuousUpperBound);
  const generalCeilingInteger =
    continuousUpperBound != null
      ? Math.floor(continuousUpperBound + 0.5)
      : undefined;
  const finalMaxAllowedInteger =
    lateSessionCeilingInteger != null && generalCeilingInteger != null
      ? Math.min(lateSessionCeilingInteger, generalCeilingInteger)
      : (lateSessionCeilingInteger ?? generalCeilingInteger);

  // Hard floor should come from observed max only.
  // Reachability from short-term forecast is noisy and should not hard-zero bins.
  const minAllowedInteger = observedFloorInteger;

  return {
    observedFloorInteger,
    reachabilityFloorInteger,
    lateSessionCeilingInteger,
    minAllowedInteger: Number.isFinite(minAllowedInteger) ? minAllowedInteger : undefined,
    maxAllowedInteger: finalMaxAllowedInteger,
    minContinuous: observedFloorContinuous,
    maxContinuous: continuousUpperBound,
    maxPotentialRise,
    debugSummary: {
      continuousLowerSource: observedFloorContinuous != null ? 'observed_max' : 'none',
      continuousUpperSource:
        continuousUpperBound == null
          ? 'none'
          : lateSessionContinuousUpperBound != null &&
              generalContinuousUpperBound != null &&
              lateSessionContinuousUpperBound < generalContinuousUpperBound
            ? 'late_session_tightened'
            : 'observed_plus_rise_cap',
      continuousBoundPriority:
        'L from observed max (continuous). U from observed+riseCap; if late-session ceiling is tighter, apply tighter U.',
      reachabilityFloorAppliedInV1: false,
      maxFutureTemp: Number.isFinite(maxFutureTemp) ? maxFutureTemp : undefined,
      hoursToPeak,
      hoursToPeakBucket,
      observedVsMuGap,
      observedVsMuGapBucket,
      deltaDistributionKey: delta?.key,
      deltaMean,
      deltaStd,
      deltaQ50,
      deltaQ75,
      deltaQ90,
      deltaQ95,
      remainingCapSource:
        capFromDistribution != null
          ? 'distribution'
          : delta != null
            ? 'distribution_fallback'
            : 'heuristic_realtime_v1',
      upperSupportLow:
        observedFloorContinuous != null && deltaQ50 != null
          ? observedFloorContinuous + deltaQ50
          : undefined,
      upperSupportHigh:
        observedFloorContinuous != null && deltaQ90 != null
          ? observedFloorContinuous + deltaQ90
          : undefined,
      remainingCapFinal: maxPotentialRise,
      riseComponents: {
        base: baseRise,
        cloudAdj,
        windAdj,
        timeAdj,
        futureAdj,
        distributionAdj: distributionAdj > 0 ? distributionAdj : undefined,
        total: maxPotentialRise
      }
    }
  };
}
