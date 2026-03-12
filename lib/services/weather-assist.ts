import { z } from 'zod';
import { fetchJsonWithCurlFallback, fetchTextWithCurlOnly } from '@/lib/utils/http-json';

const openMeteoSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    cloud_cover: z.array(z.number()).optional(),
    precipitation: z.array(z.number()).optional(),
    wind_speed_10m: z.array(z.number()).optional(),
    relative_humidity_2m: z.array(z.number()).optional()
  })
});

const wttrSchema = z.object({
  current_condition: z
    .array(
      z.object({
        temp_C: z.string().optional(),
        humidity: z.string().optional(),
        cloudcover: z.string().optional(),
        precipMM: z.string().optional(),
        windspeedKmph: z.string().optional()
      })
    )
    .optional(),
  weather: z
    .array(
      z.object({
        date: z.string(),
        hourly: z
          .array(
            z.object({
              time: z.string().optional(),
              tempC: z.string().optional(),
              cloudcover: z.string().optional(),
              precipMM: z.string().optional(),
              chanceofrain: z.string().optional(),
              windspeedKmph: z.string().optional(),
              humidity: z.string().optional()
            })
          )
          .optional()
      })
    )
    .optional()
});

const metNoSchema = z.object({
  properties: z.object({
    timeseries: z.array(
      z.object({
        time: z.string(),
        data: z.object({
          instant: z.object({
            details: z.object({
              air_temperature: z.number().optional(),
              relative_humidity: z.number().optional(),
              wind_speed: z.number().optional(),
              cloud_area_fraction: z.number().optional()
            })
          }),
          next_1_hours: z
            .object({
              details: z.object({
                precipitation_amount: z.number().optional()
              })
            })
            .optional()
        })
      })
    )
  })
});

export type WeatherAssist = {
  observedAt: Date;
  temperature2m: number;
  humidity: number;
  cloudCover: number;
  precipitation: number;
  windSpeed: number;
  temp1hAgo: number;
  temp2hAgo: number;
  temp3hAgo: number;
  tempRise1h: number;
  tempRise2h: number;
  tempRise3h: number;
  maxTempSoFar: number;
  raw: unknown;
};

type HourlyPoint = {
  time: Date;
  temp: number;
  cloud: number;
  precip: number;
  wind: number;
  humidity: number;
  rainProb?: number;
};

export async function fetchShanghaiWeatherAssist(targetDate?: Date): Promise<{ data: WeatherAssist; source: 'api' }> {
  const openMeteoQuery = new URLSearchParams({
    latitude: '31.1443',
    longitude: '121.8083',
    hourly: 'temperature_2m,cloud_cover,precipitation,wind_speed_10m,relative_humidity_2m',
    forecast_days: '3',
    timezone: 'Asia/Shanghai'
  });

  const [openMeteoRes, wttrRes, metNoRes, cmaWebRes] = await Promise.allSettled([
    fetchJsonWithCurlFallback(`https://api.open-meteo.com/v1/forecast?${openMeteoQuery}`, 12000),
    fetchJsonWithCurlFallback('https://wttr.in/Shanghai?format=j1', 12000),
    fetchJsonWithCurlFallback('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=31.1443&lon=121.8083', 12000),
    fetchTextWithCurlOnly('https://www.weather.com.cn/weather1d/101020100.shtml', 12000)
  ]);

  let openRows: HourlyPoint[] = [];
  let wttrRows: HourlyPoint[] = [];
  let metNoRows: HourlyPoint[] = [];
  let cmaDailyMax: number | null = null;
  const errors: string[] = [];
  const targetKey = toDateKey(targetDate ?? tomorrowInShanghai());

  if (openMeteoRes.status === 'fulfilled') {
    try {
      openRows = toOpenMeteoRows(openMeteoSchema.parse(openMeteoRes.value).hourly);
    } catch (error) {
      errors.push(`Open-Meteo 数据结构异常：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push(`Open-Meteo 拉取失败：${openMeteoRes.reason instanceof Error ? openMeteoRes.reason.message : String(openMeteoRes.reason)}`);
  }

  if (wttrRes.status === 'fulfilled') {
    try {
      wttrRows = toWttrRows(wttrSchema.parse(wttrRes.value));
    } catch (error) {
      errors.push(`wttr.in 数据结构异常：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push(`wttr.in 拉取失败：${wttrRes.reason instanceof Error ? wttrRes.reason.message : String(wttrRes.reason)}`);
  }

  if (metNoRes.status === 'fulfilled') {
    try {
      metNoRows = toMetNoRows(metNoSchema.parse(metNoRes.value));
    } catch (error) {
      errors.push(`met.no 数据结构异常：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push(`met.no 拉取失败：${metNoRes.reason instanceof Error ? metNoRes.reason.message : String(metNoRes.reason)}`);
  }

  if (cmaWebRes.status === 'fulfilled') {
    cmaDailyMax = parseChinaWeatherDailyMax(cmaWebRes.value, targetKey);
    if (cmaDailyMax == null) {
      errors.push('中国天气网解析失败：未提取到目标日最高温');
    }
  } else {
    errors.push(`中国天气网拉取失败：${cmaWebRes.reason instanceof Error ? cmaWebRes.reason.message : String(cmaWebRes.reason)}`);
  }

  if (!openRows.length && !wttrRows.length && !metNoRows.length) {
    throw new Error(`天气实时数据获取失败：${errors.join(' | ')}`);
  }

  const data = buildAssistFromTargetDay(openRows, wttrRows, metNoRows, targetKey, {
    targetDate: targetKey,
    mode: 'next_day_forecast',
    resolutionSource: 'Wunderground(ZSPD)',
    resolutionSourceStatus: 'not_direct',
    errors,
    openMeteo: openMeteoRes.status === 'fulfilled' ? 'ok' : null,
    wttr: wttrRes.status === 'fulfilled' ? 'ok' : null,
    metNo: metNoRes.status === 'fulfilled' ? 'ok' : null,
    chinaWeather: cmaDailyMax != null ? 'ok' : null
  }, cmaDailyMax);

  return { source: 'api', data };
}

function parseChinaWeatherDailyMax(html: string, targetDateKey: string): number | null {
  const day = Number(targetDateKey.slice(-2));
  if (!Number.isFinite(day)) return null;
  const dayToken = `${day}日`;
  const startTag = 'var hour3data=';
  const endTag = 'var observe24h_data';
  const start = html.indexOf(startTag);
  if (start < 0) return null;
  const after = html.slice(start + startTag.length);
  const end = after.indexOf(endTag);
  if (end < 0) return null;
  const segment = after.slice(0, end);
  const braceStart = segment.indexOf('{');
  const braceEnd = segment.lastIndexOf('}');
  if (braceStart < 0 || braceEnd < 0 || braceEnd <= braceStart) return null;
  const jsonText = segment.slice(braceStart, braceEnd + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const values: number[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      if (!node.includes(dayToken)) return;
      const m = node.match(/(-?\\d+(?:\\.\\d+)?)℃/);
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) values.push(v);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(parsed);
  if (!values.length) return null;
  return Math.max(...values);
}

function buildAssistFromTargetDay(
  openRows: HourlyPoint[],
  wttrRows: HourlyPoint[],
  metNoRows: HourlyPoint[],
  targetDateKey: string,
  rawMeta: Record<string, unknown>,
  cmaDailyMax: number | null
): WeatherAssist {
  const openTarget = filterByDateKey(openRows, targetDateKey);
  const wttrTarget = filterByDateKey(wttrRows, targetDateKey);
  const metTarget = filterByDateKey(metNoRows, targetDateKey);

  if (!openTarget.length && !wttrTarget.length && !metTarget.length && cmaDailyMax == null) {
    throw new Error(`天气源中未找到目标日(${targetDateKey})逐小时预测`);
  }

  const mergedRows = mergeAllRows(openTarget, wttrTarget, metTarget);
  if (!mergedRows.length && cmaDailyMax == null) {
    throw new Error(`目标日(${targetDateKey})逐小时预测融合失败`);
  }

  const fallback = mergedRows[0] ?? {
    time: new Date(`${targetDateKey}T14:00:00+08:00`),
    temp: cmaDailyMax ?? 0,
    cloud: 0,
    precip: 0,
    wind: 0,
    humidity: 0
  };
  const peak = mergedRows.length ? [...mergedRows].sort((a, b) => b.temp - a.temp)[0] : fallback;
  const peakIdx = mergedRows.findIndex((r) => r.time.getTime() === peak.time.getTime());
  const prev1 = mergedRows[Math.max(0, peakIdx - 1)] ?? peak;
  const prev2 = mergedRows[Math.max(0, peakIdx - 2)] ?? prev1;
  const prev3 = mergedRows[Math.max(0, peakIdx - 3)] ?? prev2;

  const rowDailyMax = mergedRows.length ? Math.max(...mergedRows.map((r) => r.temp)) : (cmaDailyMax ?? peak.temp);
  const openDailyMax = openTarget.length ? Math.max(...openTarget.map((r) => r.temp)) : null;
  const wttrDailyMax = wttrTarget.length ? Math.max(...wttrTarget.map((r) => r.temp)) : null;
  const metNoDailyMax = metTarget.length ? Math.max(...metTarget.map((r) => r.temp)) : null;
  const fusedDailyMax = mergeMedian([openDailyMax ?? undefined, wttrDailyMax ?? undefined, metNoDailyMax ?? undefined, cmaDailyMax ?? undefined]);
  const dailyMax = fusedDailyMax > 0 ? fusedDailyMax : rowDailyMax;

  const precipitationProxy = Math.max(peak.precip, (peak.rainProb ?? 0) / 100);

  return {
    observedAt: peak.time,
    temperature2m: dailyMax,
    humidity: peak.humidity,
    cloudCover: peak.cloud,
    precipitation: precipitationProxy,
    windSpeed: peak.wind,
    temp1hAgo: prev1.temp,
    temp2hAgo: prev2.temp,
    temp3hAgo: prev3.temp,
    tempRise1h: peak.temp - prev1.temp,
    tempRise2h: peak.temp - prev2.temp,
    tempRise3h: peak.temp - prev3.temp,
    maxTempSoFar: dailyMax,
    raw: {
      ...rawMeta,
      peakHourLocal: hourOf(peak.time),
      dailyMaxForecast: dailyMax,
      dailyMinForecast: mergedRows.length ? Math.min(...mergedRows.map((r) => r.temp)) : null,
      sourceDailyMax: {
        openMeteo: openDailyMax,
        wttr: wttrDailyMax,
        metNo: metNoDailyMax,
        cmaChina: cmaDailyMax,
        fused: dailyMax,
        spread: spreadOf([openDailyMax, wttrDailyMax, metNoDailyMax, cmaDailyMax])
      }
    }
  };
}

function toOpenMeteoRows(hourly: z.infer<typeof openMeteoSchema>['hourly']): HourlyPoint[] {
  return hourly.time.map((t, i) => ({
    time: new Date(`${t}:00+08:00`),
    temp: hourly.temperature_2m[i] ?? 0,
    cloud: hourly.cloud_cover?.[i] ?? 0,
    precip: hourly.precipitation?.[i] ?? 0,
    wind: hourly.wind_speed_10m?.[i] ?? 0,
    humidity: hourly.relative_humidity_2m?.[i] ?? 0
  }));
}

function toWttrRows(input: z.infer<typeof wttrSchema>): HourlyPoint[] {
  const current = input.current_condition?.[0];
  const rows: HourlyPoint[] = [];
  for (const day of input.weather ?? []) {
    for (const h of day.hourly ?? []) {
      const hRaw = Number(h.time ?? '0');
      const hour = Math.floor(hRaw / 100);
      rows.push({
        time: new Date(`${day.date}T${String(hour).padStart(2, '0')}:00:00+08:00`),
        temp: Number(h.tempC ?? '0'),
        cloud: Number(h.cloudcover ?? '0'),
        precip: Number(h.precipMM ?? '0'),
        wind: Number(h.windspeedKmph ?? '0'),
        humidity: Number(h.humidity ?? current?.humidity ?? '0'),
        rainProb: Number(h.chanceofrain ?? '0')
      });
    }
  }
  rows.sort((a, b) => a.time.getTime() - b.time.getTime());
  return rows;
}

function toMetNoRows(input: z.infer<typeof metNoSchema>): HourlyPoint[] {
  const rows: HourlyPoint[] = [];
  for (const t of input.properties.timeseries) {
    rows.push({
      time: new Date(t.time),
      temp: t.data.instant.details.air_temperature ?? 0,
      cloud: t.data.instant.details.cloud_area_fraction ?? 0,
      precip: t.data.next_1_hours?.details.precipitation_amount ?? 0,
      wind: t.data.instant.details.wind_speed ?? 0,
      humidity: t.data.instant.details.relative_humidity ?? 0
    });
  }
  rows.sort((a, b) => a.time.getTime() - b.time.getTime());
  return rows;
}


function filterByDateKey(rows: HourlyPoint[], key: string) {
  return rows.filter((r) => toDateKey(r.time) === key);
}

function mergeAllRows(openRows: HourlyPoint[], wttrRows: HourlyPoint[], metRows: HourlyPoint[]): HourlyPoint[] {
  const hours = new Set<number>();
  for (const r of openRows) hours.add(hourOf(r.time));
  for (const r of wttrRows) hours.add(hourOf(r.time));
  for (const r of metRows) hours.add(hourOf(r.time));

  return [...hours]
    .map((h) => mergeHourPoint(openRows, wttrRows, metRows, h))
    .filter((x): x is HourlyPoint => Boolean(x))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

function mergeHourPoint(openRows: HourlyPoint[], wttrRows: HourlyPoint[], metRows: HourlyPoint[], hour: number): HourlyPoint | null {
  const o = pickHour(openRows, hour);
  const w = pickHour(wttrRows, hour);
  const m = pickHour(metRows, hour);
  if (!o && !w && !m) return null;

  const baseTime = o?.time ?? w?.time ?? m?.time ?? new Date();
  return {
    time: baseTime,
    temp: mergeMedian([o?.temp, w?.temp, m?.temp]),
    cloud: mergeMedian([o?.cloud, w?.cloud, m?.cloud]),
    precip: mergeMedian([o?.precip, w?.precip, m?.precip]),
    wind: mergeMedian([o?.wind, w?.wind, m?.wind]),
    humidity: mergeMedian([o?.humidity, w?.humidity, m?.humidity]),
    rainProb: mergeMedian([o?.rainProb, w?.rainProb, m?.rainProb])
  };
}

function pickHour(rows: HourlyPoint[], targetHour: number): HourlyPoint | null {
  if (!rows.length) return null;
  const withDistance = rows.map((r) => ({ row: r, dist: Math.abs(hourOf(r.time) - targetHour) }));
  withDistance.sort((a, b) => a.dist - b.dist);
  return withDistance[0]?.row ?? null;
}

function hourOf(date: Date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit' }).format(date));
}

function toDateKey(date: Date) {
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

function tomorrowInShanghai() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  local.setDate(local.getDate() + 1);
  return local;
}

function mergeMedian(values: Array<number | undefined>) {
  const valid = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) return valid[mid];
  return (valid[mid - 1] + valid[mid]) / 2;
}

function spreadOf(values: Array<number | null>) {
  const valid = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!valid.length) return null;
  return Math.max(...valid) - Math.min(...valid);
}
