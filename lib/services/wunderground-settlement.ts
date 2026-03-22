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
const FALLBACK_API_KEY = '5c241d89f91274015a577e3e17d43370';
const SOURCE_DIAGNOSTICS_ENABLED = process.env.SOURCE_DIAGNOSTICS === '1';

function maskUrlSecrets(url: string) {
  return url.replace(/([?&]apiKey=)[^&]+/gi, '$1***');
}

function classifySourceFailure(message: string) {
  const m = message.toLowerCase();
  if (m.includes('401') || m.includes('unauthorized') || m.includes('forbidden')) return 'auth_error';
  if (m.includes('http ')) return 'http_error';
  if (m.includes('parse') || m.includes('zod')) return 'parse_error';
  if (m.includes('no data') || m.includes('无有效温度')) return 'empty_payload';
  if (m.includes('missing') || m.includes('未配置')) return 'config_missing';
  return 'http_error';
}

function sourceDiagLog(source: string, payload: Record<string, unknown>) {
  if (!SOURCE_DIAGNOSTICS_ENABLED) return;
  console.info(`[source-diagnostics:${source}] ${JSON.stringify(payload)}`);
}

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
      sourceDiagLog('wunderground_settlement', {
        phase: 'request',
        method: 'GET',
        url: maskUrlSecrets(url),
        params: { units: 'm', startDate: ymd, endDate: ymd },
        headers: { accept: 'application/json', userAgent: 'Mozilla/5.0 (ShanghaiDecisionBot)' }
      });
      const json = await fetchJsonWithCurlFallback(url, 12000);
      sourceDiagLog('wunderground_settlement', {
        phase: 'response',
        url: maskUrlSecrets(url),
        httpStatus: 200,
        parserKeys: json && typeof json === 'object' ? Object.keys(json as Record<string, unknown>).slice(0, 10) : [],
        bodyPreview: JSON.stringify(json).slice(0, 500)
      });
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
      sourceDiagLog('wunderground_settlement', {
        phase: 'error',
        error: lastError.message,
        failureCategory: classifySourceFailure(lastError.message)
      });
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
