import { z } from 'zod';
import { fetchJsonWithCurlFallback, fetchTextWithCurlOnly } from '@/lib/utils/http-json';

const FALLBACK_API_KEY = '5c241d89f91274015a577e3e17d43370';
const SOURCE_DIAGNOSTICS_ENABLED = process.env.SOURCE_DIAGNOSTICS === '1';
const WU_FUTURE_HOURS_WINDOW = 12;

function maskUrlSecrets(url: string) {
  return url.replace(/([?&]apiKey=)[^&]+/gi, '$1***');
}

function classifySourceFailure(message: string) {
  const m = message.toLowerCase();
  if (m.includes('401') || m.includes('unauthorized') || m.includes('forbidden')) return 'auth_error';
  if (m.includes('http ')) return 'http_error';
  if (m.includes('parse') || m.includes('zod')) return 'parse_error';
  if (m.includes('no data') || m.includes('empty')) return 'empty_payload';
  if (m.includes('missing') || m.includes('未配置')) return 'config_missing';
  return 'http_error';
}

function sourceDiagLog(source: string, payload: Record<string, unknown>) {
  if (!SOURCE_DIAGNOSTICS_ENABLED) return;
  console.info(`[source-diagnostics:${source}] ${JSON.stringify(payload)}`);
}

const wuCurrentSchema = z.object({
  validTimeLocal: z.string().optional(),
  validTimeUtc: z.number().optional(),
  temperature: z.number().optional(),
  relativeHumidity: z.number().optional(),
  windSpeed: z.number().optional(),
  windDirection: z.number().optional(),
  cloudCover: z.number().optional(),
  precip1Hour: z.number().optional(),
  precipHour: z.number().optional(),
  precipTotal: z.number().optional(),
  iconCode: z.number().optional()
});

const wuHourlySchema = z.object({
  validTimeLocal: z.array(z.string()).optional(),
  validTimeUtc: z.array(z.number()).optional(),
  temperature: z.array(z.number().nullable().optional()).optional(),
  cloudCover: z.array(z.number().nullable().optional()).optional(),
  precipChance: z.array(z.number().nullable().optional()).optional(),
  qpf: z.array(z.number().nullable().optional()).optional(),
  windSpeed: z.array(z.number().nullable().optional()).optional(),
  windDirection: z.array(z.number().nullable().optional()).optional()
});

const wuHistoricalSchema = z.object({
  observations: z
    .array(
      z.object({
        temp: z.number().optional(),
        valid_time_gmt: z.number().optional()
      })
    )
    .optional()
});

type FetchWuNowcastingInput = {
  stationCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type FetchWuDailyForecastInput = {
  stationCode?: string;
  latitude: number;
  longitude: number;
  targetDate: Date;
  timezone?: string;
};

export type LearnedPeakWindow = {
  startHour: number;
  endHour: number;
  medianHour: number;
  sampleDays: number;
  method: 'wunderground_30d_history';
};

export type WundergroundNowcasting = {
  observedAt: Date;
  currentTemp: number | null;
  todayMaxTemp: number | null;
  cloudCover: number | null;
  precipitationProb: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
  futureHours: Array<{
    hourOffset: number;
    temp: number | null;
    cloudCover: number | null;
    precipitationProb: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    at: Date | null;
  }>;
};

function toDateKey(date: Date, timezone = 'Asia/Shanghai') {
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

function clamp(value: number | null | undefined, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const ratio = idx - lo;
  return sorted[lo] * (1 - ratio) + sorted[hi] * ratio;
}

function pickArrayNumber(arr: Array<number | null | undefined> | undefined, idx: number) {
  const v = arr?.[idx];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseDate(value: string | undefined, fallbackUtc?: number) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof fallbackUtc === 'number' && Number.isFinite(fallbackUtc)) {
    const d = new Date(fallbackUtc * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function normalizePrecipProbFromCurrent(current: z.infer<typeof wuCurrentSchema>) {
  const p1 = current.precip1Hour ?? current.precipHour ?? current.precipTotal;
  if (typeof p1 !== 'number' || !Number.isFinite(p1)) return null;
  if (p1 <= 0) return 0;
  if (p1 >= 2) return 70;
  if (p1 >= 1) return 50;
  return 30;
}

async function loadApiKeys(stationCode: string, timezone: string) {
  const keys = new Set<string>();
  if (process.env.WUNDERGROUND_API_KEY) keys.add(process.env.WUNDERGROUND_API_KEY);
  keys.add(FALLBACK_API_KEY);
  const todayKey = toDateKey(new Date(), timezone);
  try {
    const html = await fetchTextWithCurlOnly(
      `https://www.wunderground.com/history/daily/cn/shanghai/${stationCode}/date/${todayKey}`,
      12000
    );
    for (const m of html.matchAll(/apiKey=([a-zA-Z0-9]+)/g)) {
      keys.add(m[1]);
    }
  } catch {
    // keep existing keys
  }
  return [...keys];
}

function extractDailyForecastMaxTemp(payload: unknown, targetKey: string): number | null {
  const data = payload as {
    validTimeLocal?: string[];
    temperatureMax?: Array<number | null>;
    calendarDayTemperatureMax?: Array<number | null>;
  };
  const timeList = Array.isArray(data.validTimeLocal) ? data.validTimeLocal : [];
  const maxList = Array.isArray(data.temperatureMax) ? data.temperatureMax : [];
  const calendarList = Array.isArray(data.calendarDayTemperatureMax) ? data.calendarDayTemperatureMax : [];

  for (let i = 0; i < timeList.length; i += 1) {
    const key = toDateKey(new Date(timeList[i]), 'Asia/Shanghai');
    if (key !== targetKey) continue;
    const temp = typeof maxList[i] === 'number' && Number.isFinite(maxList[i]) ? maxList[i] : null;
    if (temp != null) return temp;
    const cal = typeof calendarList[i] === 'number' && Number.isFinite(calendarList[i]) ? calendarList[i] : null;
    if (cal != null) return cal;
  }

  const fallback = [...maxList, ...calendarList].find((v) => typeof v === 'number' && Number.isFinite(v));
  return typeof fallback === 'number' ? fallback : null;
}

export async function fetchWundergroundDailyMaxForecast(input: FetchWuDailyForecastInput): Promise<number | null> {
  const stationCode = input.stationCode ?? 'ZSPD';
  const timezone = input.timezone ?? 'Asia/Shanghai';
  const targetKey = toDateKey(input.targetDate, timezone);
  const keys = await loadApiKeys(stationCode, timezone);

  let lastError: Error | null = null;
  for (const apiKey of keys) {
    try {
      const geocode = `${input.latitude},${input.longitude}`;
      const url = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${apiKey}`;
      sourceDiagLog('wunderground_daily', {
        phase: 'request',
        method: 'GET',
        url: maskUrlSecrets(url),
        params: { geocode, units: 'm', language: 'en-US', format: 'json' },
        headers: { accept: 'application/json', userAgent: 'Mozilla/5.0 (ShanghaiDecisionBot)' }
      });
      const raw = await fetchJsonWithCurlFallback(url, 12000);
      sourceDiagLog('wunderground_daily', {
        phase: 'response',
        url: maskUrlSecrets(url),
        httpStatus: 200,
        parserKeys: raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>).slice(0, 10) : [],
        bodyPreview: JSON.stringify(raw).slice(0, 500)
      });
      const temp = extractDailyForecastMaxTemp(raw, targetKey);
      if (temp != null) return temp;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      sourceDiagLog('wunderground_daily', {
        phase: 'error',
        error: lastError.message,
        failureCategory: classifySourceFailure(lastError.message)
      });
    }
  }
  if (lastError) {
    throw new Error(`Wunderground 次日最高温预测拉取失败：${lastError.message}`);
  }
  return null;
}

export async function fetchWundergroundPeakWindow30d(input: FetchWuDailyForecastInput): Promise<LearnedPeakWindow | null> {
  const stationCode = input.stationCode ?? 'ZSPD';
  const timezone = input.timezone ?? 'Asia/Shanghai';
  const end = new Date(input.targetDate.getTime() - 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const ymdStart = toDateKey(start, timezone).replaceAll('-', '');
  const ymdEnd = toDateKey(end, timezone).replaceAll('-', '');
  const keys = await loadApiKeys(stationCode, timezone);

  let lastError: Error | null = null;
  for (const apiKey of keys) {
    try {
      const url = `https://api.weather.com/v1/geocode/${input.latitude}/${input.longitude}/observations/historical.json?apiKey=${apiKey}&units=m&startDate=${ymdStart}&endDate=${ymdEnd}`;
      sourceDiagLog('wunderground_30d', {
        phase: 'request',
        method: 'GET',
        url: maskUrlSecrets(url),
        params: { units: 'm', startDate: ymdStart, endDate: ymdEnd },
        headers: { accept: 'application/json', userAgent: 'Mozilla/5.0 (ShanghaiDecisionBot)' }
      });
      const raw = await fetchJsonWithCurlFallback(url, 12000);
      sourceDiagLog('wunderground_30d', {
        phase: 'response',
        url: maskUrlSecrets(url),
        httpStatus: 200,
        parserKeys: raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>).slice(0, 10) : [],
        bodyPreview: JSON.stringify(raw).slice(0, 500)
      });
      const parsed = wuHistoricalSchema.parse(raw);
      const byDay = new Map<string, Array<{ temp: number; hour: number }>>();
      for (const obs of parsed.observations ?? []) {
        if (typeof obs.temp !== 'number' || !Number.isFinite(obs.temp)) continue;
        if (typeof obs.valid_time_gmt !== 'number' || !Number.isFinite(obs.valid_time_gmt)) continue;
        const d = new Date(obs.valid_time_gmt * 1000);
        const dateKey = toDateKey(d, timezone);
        const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, hour: '2-digit' }).format(d));
        const arr = byDay.get(dateKey) ?? [];
        arr.push({ temp: obs.temp, hour });
        byDay.set(dateKey, arr);
      }

      const peakHours: number[] = [];
      for (const rows of byDay.values()) {
        if (!rows.length) continue;
        const max = Math.max(...rows.map((r) => r.temp));
        const hourAtMax = rows.find((r) => r.temp === max)?.hour;
        if (typeof hourAtMax === 'number' && Number.isFinite(hourAtMax)) peakHours.push(hourAtMax);
      }
      if (peakHours.length < 8) return null;
      peakHours.sort((a, b) => a - b);
      const p25 = percentile(peakHours, 0.25);
      const p50 = percentile(peakHours, 0.5);
      const p75 = percentile(peakHours, 0.75);
      if (p25 == null || p50 == null || p75 == null) return null;
      return {
        startHour: Math.max(10, Math.min(18, p25 - 0.5)),
        endHour: Math.max(10.5, Math.min(20, p75 + 0.5)),
        medianHour: Math.max(10, Math.min(19, p50)),
        sampleDays: peakHours.length,
        method: 'wunderground_30d_history'
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      sourceDiagLog('wunderground_30d', {
        phase: 'error',
        error: lastError.message,
        failureCategory: classifySourceFailure(lastError.message)
      });
    }
  }
  if (lastError) {
    throw new Error(`Wunderground 30天峰值窗口学习失败：${lastError.message}`);
  }
  return null;
}

export async function fetchWundergroundNowcasting(input: FetchWuNowcastingInput): Promise<WundergroundNowcasting> {
  const stationCode = input.stationCode ?? 'ZSPD';
  const timezone = input.timezone ?? 'Asia/Shanghai';
  const targetKey = toDateKey(new Date(), timezone);
  const ymd = targetKey.replaceAll('-', '');
  const keys = await loadApiKeys(stationCode, timezone);

  let lastError: Error | null = null;
  for (const apiKey of keys) {
    try {
      const geocode = `${input.latitude},${input.longitude}`;
      const currentUrl = `https://api.weather.com/v3/wx/observations/current?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${apiKey}`;
      const hourlyUrl = `https://api.weather.com/v3/wx/forecast/hourly/2day?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${apiKey}`;
      const historyUrl = `https://api.weather.com/v1/geocode/${input.latitude}/${input.longitude}/observations/historical.json?apiKey=${apiKey}&units=m&startDate=${ymd}&endDate=${ymd}`;
      sourceDiagLog('wunderground_nowcasting', {
        phase: 'request',
        method: 'GET',
        requests: [
          { url: maskUrlSecrets(currentUrl), params: { geocode, units: 'm', language: 'en-US', format: 'json' } },
          { url: maskUrlSecrets(hourlyUrl), params: { geocode, units: 'm', language: 'en-US', format: 'json' } },
          { url: maskUrlSecrets(historyUrl), params: { units: 'm', startDate: ymd, endDate: ymd } }
        ],
        headers: { accept: 'application/json', userAgent: 'Mozilla/5.0 (ShanghaiDecisionBot)' }
      });
      const [currentRaw, hourlyRaw, historyRaw] = await Promise.all([
        fetchJsonWithCurlFallback(currentUrl, 12000),
        fetchJsonWithCurlFallback(hourlyUrl, 12000),
        fetchJsonWithCurlFallback(historyUrl, 12000)
      ]);
      sourceDiagLog('wunderground_nowcasting', {
        phase: 'response',
        httpStatus: 200,
        parserKeys: {
          current: currentRaw && typeof currentRaw === 'object' ? Object.keys(currentRaw as Record<string, unknown>).slice(0, 10) : [],
          hourly: hourlyRaw && typeof hourlyRaw === 'object' ? Object.keys(hourlyRaw as Record<string, unknown>).slice(0, 10) : [],
          history: historyRaw && typeof historyRaw === 'object' ? Object.keys(historyRaw as Record<string, unknown>).slice(0, 10) : []
        },
        bodyPreview: {
          current: JSON.stringify(currentRaw).slice(0, 500),
          hourly: JSON.stringify(hourlyRaw).slice(0, 500),
          history: JSON.stringify(historyRaw).slice(0, 500)
        }
      });

      const current = wuCurrentSchema.parse(currentRaw);
      const hourly = wuHourlySchema.parse(hourlyRaw);
      const history = wuHistoricalSchema.parse(historyRaw);

      const now = new Date();
      const nowMs = now.getTime();
      const hourPoints = (hourly.validTimeLocal ?? []).map((v, idx) => {
        const at = parseDate(v, hourly.validTimeUtc?.[idx]);
        return {
          at,
          temp: pickArrayNumber(hourly.temperature, idx),
          cloudCover: clamp(pickArrayNumber(hourly.cloudCover, idx), 0, 100),
          precipitationProb: clamp(pickArrayNumber(hourly.precipChance, idx), 0, 100),
          windSpeed: pickArrayNumber(hourly.windSpeed, idx),
          windDirection: clamp(pickArrayNumber(hourly.windDirection, idx), 0, 360)
        };
      });
      const future = hourPoints
        .filter((p) => p.at && p.at.getTime() > nowMs)
        .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
        .slice(0, WU_FUTURE_HOURS_WINDOW)
        .map((p, i) => ({
          hourOffset: i + 1,
          temp: p.temp,
          cloudCover: p.cloudCover,
          precipitationProb: p.precipitationProb,
          windSpeed: p.windSpeed,
          windDirection: p.windDirection,
          at: p.at
        }));

      const obsTemps = (history.observations ?? [])
        .filter((o) => {
          if (typeof o.valid_time_gmt !== 'number') return true;
          return toDateKey(new Date(o.valid_time_gmt * 1000), timezone) === targetKey;
        })
        .map((o) => o.temp)
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      const todayMaxTemp = obsTemps.length ? Math.max(...obsTemps) : null;
      const observedAt =
        parseDate(current.validTimeLocal, current.validTimeUtc) ??
        future[0]?.at ??
        now;

      return {
        observedAt,
        currentTemp: typeof current.temperature === 'number' ? current.temperature : null,
        todayMaxTemp,
        cloudCover: clamp(current.cloudCover ?? null, 0, 100),
        precipitationProb: normalizePrecipProbFromCurrent(current),
        windSpeed: typeof current.windSpeed === 'number' ? current.windSpeed : null,
        windDirection: clamp(current.windDirection ?? null, 0, 360),
        humidity: clamp(current.relativeHumidity ?? null, 0, 100),
        futureHours: future
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      sourceDiagLog('wunderground_nowcasting', {
        phase: 'error',
        error: lastError.message,
        failureCategory: classifySourceFailure(lastError.message)
      });
    }
  }
  throw new Error(`Wunderground nowcasting 拉取失败：${lastError?.message ?? 'unknown error'}`);
}
