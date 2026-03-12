export function calculateTimingScore(localHour: number, localMinute: number): number {
  const h = localHour + localMinute / 60;
  if (h < 11) return 20;
  if (h < 13) return 50;
  if (h < 15.5) return 90;
  if (h < 17) return 70;
  return 20;
}
