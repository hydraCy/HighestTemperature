import type { CalibrationCurvePoint } from '@/src/lib/backtest/types';

type CalibrationInputRow = {
  confidence: number;
  hit: boolean;
};

export function buildCalibrationCurve(rows: CalibrationInputRow[]): CalibrationCurvePoint[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    values: [] as CalibrationInputRow[]
  }));

  for (const row of rows) {
    const c = Math.max(0, Math.min(0.999999, row.confidence));
    const idx = Math.floor(c * 10);
    buckets[idx]!.values.push(row);
  }

  return buckets.map((b) => {
    const n = b.values.length;
    const predicted = n
      ? b.values.reduce((acc, x) => acc + x.confidence, 0) / n
      : 0;
    const actual = n
      ? b.values.reduce((acc, x) => acc + (x.hit ? 1 : 0), 0) / n
      : 0;
    return {
      range: `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,
      predicted,
      actual,
      count: n
    };
  });
}

