import { getLocationConfig, normalizeLocationKey, type SupportedLocationKey } from '@/lib/config/locations';

export type PipelineRequest = {
  locationKey?: SupportedLocationKey;
  targetDate?: string; // YYYY-MM-DD
};

export type ResolvedPipelineRequest = {
  locationKey: SupportedLocationKey;
  targetDate: string; // YYYY-MM-DD
  timezone: string;
  isTargetDateToday: boolean;
  isFutureDate: boolean;
  dayOffset: number;
};

function toDateKeyByTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

function parseDateKeyToNoon(dateKey: string, timezone: string) {
  const tzOffset = timezone === 'Asia/Hong_Kong' ? '+08:00' : '+08:00';
  const d = new Date(`${dateKey}T12:00:00${tzOffset}`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isDateKey(input: string | null | undefined): input is string {
  return Boolean(input && /^\d{4}-\d{2}-\d{2}$/.test(input));
}

export function resolvePipelineRequest(input?: PipelineRequest): ResolvedPipelineRequest {
  const locationKey = normalizeLocationKey(input?.locationKey);
  const location = getLocationConfig(locationKey);
  const today = toDateKeyByTimezone(new Date(), location.timezone);
  const targetDate = isDateKey(input?.targetDate ?? null) ? input!.targetDate! : today;
  const todayDate = parseDateKeyToNoon(today, location.timezone);
  const target = parseDateKeyToNoon(targetDate, location.timezone);
  const dayOffset =
    todayDate && target ? Math.round((target.getTime() - todayDate.getTime()) / 86400000) : 0;
  return {
    locationKey,
    targetDate,
    timezone: location.timezone,
    isTargetDateToday: dayOffset === 0,
    isFutureDate: dayOffset > 0,
    dayOffset
  };
}

export function normalizeDateKey(input: string | null | undefined) {
  return isDateKey(input) ? input : undefined;
}

