import { rmse } from '@/src/lib/calibration/stats';
import type {
  NormalizedSnapshotRow,
  SnapshotBucket,
  SourceWeightTable,
  WeatherSourceName
} from '@/src/lib/backtest/types';

const SOURCES: WeatherSourceName[] = ['ecmwf', 'gfs', 'icon', 'wunderground', 'weatherAPI', 'metNo'];

export function calibrateSourceWeights(rows: NormalizedSnapshotRow[]): SourceWeightTable {
  const grouped: Record<SnapshotBucket, Partial<Record<WeatherSourceName, number[]>>> = {
    '08': {},
    '11': {},
    '14': {},
    'late': {}
  };

  for (const bucket of ['08', '11', '14', 'late'] as SnapshotBucket[]) {
    for (const source of SOURCES) grouped[bucket][source] = [];
  }

  for (const row of rows) {
    for (const source of SOURCES) {
      const v = row.sources[source];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      grouped[row.snapshotBucket][source]!.push(v - row.finalMaxTemp);
    }
  }

  const result: SourceWeightTable = {};
  for (const bucket of ['08', '11', '14', 'late'] as SnapshotBucket[]) {
    const invRmse2: Partial<Record<WeatherSourceName, number>> = {};
    let sum = 0;
    for (const source of SOURCES) {
      const errors = grouped[bucket][source] ?? [];
      if (!errors.length) continue;
      const r = Math.max(0.15, rmse(errors));
      const w = 1 / (r * r);
      invRmse2[source] = w;
      sum += w;
    }
    if (sum <= 0) continue;
    const normalized: Partial<Record<WeatherSourceName, number>> = {};
    for (const source of Object.keys(invRmse2) as WeatherSourceName[]) {
      normalized[source] = (invRmse2[source] ?? 0) / sum;
    }
    result[bucket] = normalized;
  }
  return result;
}

