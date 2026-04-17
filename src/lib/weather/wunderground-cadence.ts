export const WUNDERGROUND_UPDATE_MINUTES = [5, 15, 25, 35, 45, 55] as const;

function toMinuteOfHour(date: Date): number {
  const v = date.getMinutes();
  return Number.isFinite(v) ? v : 0;
}

export function minutesUntilNextWundergroundUpdate(from: Date): number {
  const minute = toMinuteOfHour(from);
  for (const slot of WUNDERGROUND_UPDATE_MINUTES) {
    if (minute < slot) return slot - minute;
  }
  return 60 - minute + WUNDERGROUND_UPDATE_MINUTES[0];
}

export function calculateWundergroundFreshnessThresholdMinutes(params: {
  observedAt: Date;
  cadenceGraceMinutes?: number;
  fallbackMaxStaleMinutes: number;
}) {
  const grace = Number.isFinite(params.cadenceGraceMinutes) ? Math.max(0, Number(params.cadenceGraceMinutes)) : 4;
  const cadenceDriven = minutesUntilNextWundergroundUpdate(params.observedAt) + grace;
  if (!Number.isFinite(params.fallbackMaxStaleMinutes) || params.fallbackMaxStaleMinutes <= 0) {
    return cadenceDriven;
  }
  return Math.min(params.fallbackMaxStaleMinutes, cadenceDriven);
}
