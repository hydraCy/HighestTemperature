import type {
  HoursToPeakBucket,
  ObservedVsMuGapBucket,
  RemainingCapDistributionStats,
  SnapshotBucket
} from '@/src/lib/backtest/types';

export function bucketHoursToPeak(hoursToPeak: number): HoursToPeakBucket {
  if (!Number.isFinite(hoursToPeak)) return 'far';
  if (hoursToPeak > 6) return 'far';
  if (hoursToPeak > 3) return 'medium';
  if (hoursToPeak > 1) return 'near';
  return 'very_near';
}

export function bucketObservedVsMuGap(gap: number): ObservedVsMuGapBucket {
  if (!Number.isFinite(gap)) return 'medium';
  if (gap <= 0.8) return 'low';
  if (gap <= 2.0) return 'medium';
  return 'high';
}

export function buildDeltaDistributionKey(params: {
  snapshotBucket: SnapshotBucket;
  hoursToPeakBucket: HoursToPeakBucket;
  observedVsMuGapBucket: ObservedVsMuGapBucket;
}) {
  return `${params.snapshotBucket}|${params.hoursToPeakBucket}|${params.observedVsMuGapBucket}`;
}

export function fallbackStdFromQuantiles(q50: number, q90: number) {
  const spread = Math.max(0, q90 - q50);
  // z(0.90)=1.2816
  return Math.max(0.35, spread / 1.2816);
}

export function isValidDeltaStats(v: unknown): v is RemainingCapDistributionStats {
  if (!v || typeof v !== 'object') return false;
  const x = v as RemainingCapDistributionStats;
  return Number.isFinite(x.q50)
    && Number.isFinite(x.q90)
    && Number.isFinite(x.q95)
    && Number.isFinite(x.mean)
    && Number.isFinite(x.std);
}

