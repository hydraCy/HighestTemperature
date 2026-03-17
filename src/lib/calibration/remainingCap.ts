import { quantile } from '@/src/lib/calibration/stats';
import type { NormalizedSnapshotRow, RemainingCapTable, SnapshotBucket } from '@/src/lib/backtest/types';

export function calibrateRemainingCaps(rows: NormalizedSnapshotRow[]): RemainingCapTable {
  const grouped: Record<SnapshotBucket, number[]> = {
    '08': [],
    '11': [],
    '14': [],
    'late': []
  };

  for (const row of rows) {
    if (typeof row.observedMaxSoFar !== 'number' || !Number.isFinite(row.observedMaxSoFar)) continue;
    const remain = row.finalMaxTemp - row.observedMaxSoFar;
    grouped[row.snapshotBucket].push(Math.max(0, remain));
  }

  const out: RemainingCapTable = {};
  for (const bucket of Object.keys(grouped) as SnapshotBucket[]) {
    const values = grouped[bucket];
    if (!values.length) continue;
    out[bucket] = {
      q50: quantile(values, 0.5),
      q75: quantile(values, 0.75),
      q90: quantile(values, 0.9),
      q95: quantile(values, 0.95)
    };
  }
  return out;
}

