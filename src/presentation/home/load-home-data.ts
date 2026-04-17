import { getLocationConfig, normalizeLocationKey } from '@/lib/config/locations';
import { resolveUiLang, type UiLang } from '@/src/presentation/home/i18n';

type HomeSearchParams = { lang?: string | string[]; d?: string | string[]; l?: string | string[] };

export function toDateKeyAtTimezone(date: Date, timezone: string) {
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

export function resolveHomePageRequest(sp: HomeSearchParams): {
  lang: UiLang;
  locationKey: ReturnType<typeof normalizeLocationKey>;
  locationConfig: ReturnType<typeof getLocationConfig>;
  selectedDateKey: string;
} {
  const lang = resolveUiLang(sp?.lang);
  const locationKey = normalizeLocationKey(Array.isArray(sp?.l) ? sp.l[0] : sp?.l);
  const locationConfig = getLocationConfig(locationKey);
  const selectedDate = Array.isArray(sp?.d) ? sp.d[0] : sp?.d;
  const selectedDateKey =
    typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? selectedDate
      : toDateKeyAtTimezone(new Date(), locationConfig.timezone);
  return { lang, locationKey, locationConfig, selectedDateKey };
}
