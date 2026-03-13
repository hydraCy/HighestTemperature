export function calculateTimingScore(
  localHour: number,
  localMinute: number,
  learnedWindow?: { startHour?: number; endHour?: number }
): number {
  const h = localHour + localMinute / 60;
  const start = learnedWindow?.startHour ?? 13.5;
  const end = learnedWindow?.endHour ?? 16.0;
  if (h < start - 2.5) return 20;
  if (h < start) return 50;
  if (h <= end - 0.5) return 90;
  if (h <= end + 1) return 70;
  return 20;
}
