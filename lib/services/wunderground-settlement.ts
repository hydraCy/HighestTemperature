import { z } from 'zod';
import { fetchJsonWithCurlFallback, fetchTextWithCurlOnly } from '@/lib/utils/http-json';

const historicalObservationSchema = z.object({
  temp: z.number().optional(),
  valid_time_gmt: z.number().optional()
});

const historicalResponseSchema = z.object({
  observations: z.array(historicalObservationSchema).optional()
});

type FetchSettlementInput = {
  targetDate: Date;
  stationCode?: string;
  latitude?: number;
  longitude?: number;
};

const DEFAULT_STATION_CODE = 'ZSPD';
const DEFAULT_LAT = 31.15;
const DEFAULT_LON = 121.803;
const FALLBACK_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';

export async function fetchWundergroundSettledMaxTemp(input: FetchSettlementInput) {
  const stationCode = input.stationCode ?? DEFAULT_STATION_CODE;
  const latitude = input.latitude ?? DEFAULT_LAT;
  const longitude = input.longitude ?? DEFAULT_LON;
  const targetDateKey = toDateKeyShanghai(input.targetDate);
  const ymd = targetDateKey.replaceAll('-', '');

  const apiKeys = await loadApiKeys(targetDateKey, stationCode);
  let lastError: Error | null = null;
  for (const apiKey of apiKeys) {
    try {
      const url = `https://api.weather.com/v1/geocode/${latitude}/${longitude}/observations/historical.json?apiKey=${apiKey}&units=m&startDate=${ymd}&endDate=${ymd}`;
      const json = await fetchJsonWithCurlFallback(url, 12000);
      const parsed = historicalResponseSchema.parse(json);
      const observations = parsed.observations ?? [];
      const filteredTemps = observations
        .filter((o) => {
          if (typeof o.valid_time_gmt !== 'number') return true;
          return toDateKeyShanghai(new Date(o.valid_time_gmt * 1000)) === targetDateKey;
        })
        .map((o) => o.temp)
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      const temps =
        filteredTemps.length > 0
          ? filteredTemps
          : observations.map((o) => o.temp).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      if (!temps.length) {
        throw new Error('历史观测无有效温度');
      }
      return {
        maxTempC: Math.max(...temps),
        observationCount: observations.length,
        sourceUrl: `https://www.wunderground.com/history/daily/cn/shanghai/${stationCode}/date/${targetDateKey}`,
        source: 'wunderground_weather_com'
      } as const;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Wunderground 结算温度抓取失败：${lastError?.message ?? 'unknown error'}`);
}

async function loadApiKeys(targetDateKey: string, stationCode: string) {
  const keys = new Set<string>();
  if (process.env.WUNDERGROUND_API_KEY) keys.add(process.env.WUNDERGROUND_API_KEY);
  keys.add(FALLBACK_API_KEY);

  try {
    const html = await fetchTextWithCurlOnly(
      `https://www.wunderground.com/history/daily/cn/shanghai/${stationCode}/date/${targetDateKey}`,
      12000
    );
    for (const m of html.matchAll(/apiKey=([a-zA-Z0-9]+)/g)) {
      keys.add(m[1]);
    }
  } catch {
    // 页面抓取失败不阻断，继续用现有 key
  }

  return [...keys];
}

function toDateKeyShanghai(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

