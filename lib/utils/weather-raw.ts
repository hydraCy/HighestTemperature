import { fromJsonString } from '@/lib/utils/json';

type WeatherRawAny = {
  raw?: Record<string, unknown>;
  fetchedAtIso?: string;
  nowcasting?: { observedAt?: string };
} & Record<string, unknown>;

export function parseWeatherRaw(rawJson: string | null | undefined) {
  const parsed = fromJsonString<WeatherRawAny>(rawJson, {});
  const raw =
    parsed?.raw && typeof parsed.raw === 'object'
      ? (parsed.raw as Record<string, unknown>)
      : (parsed as Record<string, unknown>);

  const fetchedAtIso =
    (raw.fetchedAtIso as string | undefined) ??
    (parsed.fetchedAtIso as string | undefined) ??
    null;
  const observedAt =
    ((raw.nowcasting as { observedAt?: string } | undefined)?.observedAt as string | undefined) ??
    ((parsed.nowcasting as { observedAt?: string } | undefined)?.observedAt as string | undefined) ??
    null;

  return { parsed, raw, fetchedAtIso, observedAt };
}
