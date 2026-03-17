import { mad, mean } from '@/src/lib/calibration/stats';
import type { BaseSigmaTable, NormalizedSnapshotRow, SnapshotBucket } from '@/src/lib/backtest/types';

function averageValidSources(row: NormalizedSnapshotRow): number | null {
  const vals = Object.values(row.sources).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!vals.length) return null;
  return mean(vals);
}

export function calibrateBaseSigma(rows: NormalizedSnapshotRow[]): BaseSigmaTable {
  const grouped: Record<SnapshotBucket, number[]> = {
    '08': [],
    '11': [],
    '14': [],
    'late': []
  };
  for (const row of rows) {
    const mu = averageValidSources(row);
    if (mu == null) continue;
    grouped[row.snapshotBucket].push(row.finalMaxTemp - mu);
  }

  const out: BaseSigmaTable = {};
  for (const bucket of Object.keys(grouped) as SnapshotBucket[]) {
    const errors = grouped[bucket];
    if (!errors.length) continue;
    // Robust sigma estimate from MAD.
    const sigma = 1.4826 * mad(errors);
    out[bucket] = Math.max(0.4, sigma);
  }
  return out;
}

