import { z } from 'zod';
import { fetchJsonWithCurlFallback, fetchTextWithCurlFallback } from '@/lib/utils/http-json';
import {
  fetchWundergroundNowcasting,
  fetchWundergroundDailyMaxForecast,
  fetchWundergroundPeakWindow30d,
  type WundergroundNowcasting
} from '@/lib/services/wunderground-nowcasting';

const RESOLUTION_STATION = {
  stationName: 'Shanghai Pudong International Airport Station',
  stationCode: 'ZSPD',
  latitude: 31.1443,
  longitude: 121.8083,
  timezone: 'Asia/Shanghai'
} as const;

const openMeteoSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    cloud_cover: z.array(z.number()).optional(),
    precipitation: z.array(z.number()).optional(),
    wind_speed_10m: z.array(z.number()).optional(),
    wind_direction_10m: z.array(z.number()).optional(),
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
        windspeedKmph: z.string().optional(),
        winddirDegree: z.string().optional()
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
              humidity: z.string().optional(),
              winddirDegree: z.string().optional()
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
              wind_from_direction: z.number().optional(),
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

const weatherApiSchema = z.object({
  forecast: z
    .object({
      forecastday: z
        .array(
          z.object({
            date: z.string(),
            day: z.object({
              maxtemp_c: z.number().optional()
            })
          })
        )
        .optional()
    })
    .optional()
});

const qWeatherSchema = z.object({
  daily: z
    .array(
      z.object({
        fxDate: z.string(),
        tempMax: z.string().optional()
      })
    )
    .optional()
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
  windDirection?: number;
  humidity: number;
  rainProb?: number;
};

type WeatherSourceCode = 'wunderground' | 'wunderground_daily' | 'wunderground_history' | 'open_meteo' | 'wttr' | 'met_no' | 'weatherapi' | 'qweather';
type ApiHealthStatus = 'ok' | 'no_data' | 'fetch_error' | 'parse_error' | 'skipped' | 'fallback_proxy';
type ApiHealth = {
  status: ApiHealthStatus;
  reason?: string;
  hasData: boolean;
};

function strictSourceListFromEnv(): WeatherSourceCode[] {
  const raw = process.env.WEATHER_STRICT_SOURCES?.trim();
  if (!raw) return ['open_meteo', 'wttr', 'met_no'];
  const allowed: WeatherSourceCode[] = ['wunderground', 'wunderground_daily', 'wunderground_history', 'open_meteo', 'wttr', 'met_no', 'weatherapi', 'qweather'];
  const list = raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is WeatherSourceCode => allowed.includes(x as WeatherSourceCode));
  return list.length ? Array.from(new Set(list)) : ['open_meteo', 'wttr', 'met_no'];
}

export async function fetchShanghaiWeatherAssist(targetDate?: Date): Promise<{ data: WeatherAssist; source: 'api' }> {
  const weatherApiKey = process.env.WEATHERAPI_KEY?.trim();
  const weatherApiBase = (process.env.WEATHERAPI_API_BASE?.trim() || 'https://api.weatherapi.com/v1').replace(/\/+$/, '');
  const qWeatherApiKey = process.env.QWEATHER_API_KEY?.trim();
  const qWeatherApiBase = (process.env.QWEATHER_API_BASE?.trim() || 'https://devapi.qweather.com').replace(/\/+$/, '');
  const targetDateResolved = targetDate ?? tomorrowInShanghai();
  const openMeteoQuery = new URLSearchParams({
    latitude: String(RESOLUTION_STATION.latitude),
    longitude: String(RESOLUTION_STATION.longitude),
    hourly: 'temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m',
    forecast_days: '3',
    timezone: RESOLUTION_STATION.timezone
  });

  const [wuNowcastRes, wuDailyRes, wuHistoryRes, openMeteoRes, wttrRes, metNoRes, weatherApiRes, qWeatherRes] = await Promise.allSettled([
    fetchWundergroundNowcasting({
      stationCode: RESOLUTION_STATION.stationCode,
      latitude: RESOLUTION_STATION.latitude,
      longitude: RESOLUTION_STATION.longitude,
      timezone: RESOLUTION_STATION.timezone
    }),
    fetchWundergroundDailyMaxForecast({
      stationCode: RESOLUTION_STATION.stationCode,
      latitude: RESOLUTION_STATION.latitude,
      longitude: RESOLUTION_STATION.longitude,
      targetDate: targetDateResolved,
      timezone: RESOLUTION_STATION.timezone
    }),
    fetchWundergroundPeakWindow30d({
      stationCode: RESOLUTION_STATION.stationCode,
      latitude: RESOLUTION_STATION.latitude,
      longitude: RESOLUTION_STATION.longitude,
      targetDate: targetDateResolved,
      timezone: RESOLUTION_STATION.timezone
    }),
    fetchJsonWithCurlFallback(`https://api.open-meteo.com/v1/forecast?${openMeteoQuery}`, 12000),
    fetchWttrJson(12000),
    fetchJsonWithCurlFallback(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${RESOLUTION_STATION.latitude}&lon=${RESOLUTION_STATION.longitude}`, 12000),
    weatherApiKey
      ? fetchJsonWithCurlFallback(
          `${weatherApiBase}/forecast.json?key=${encodeURIComponent(weatherApiKey)}&q=${RESOLUTION_STATION.latitude},${RESOLUTION_STATION.longitude}&days=3&aqi=no&alerts=no`,
          12000
        )
      : Promise.resolve({ forecast: { forecastday: [] } }),
    qWeatherApiKey
      ? fetchJsonWithCurlFallback(
          `${qWeatherApiBase}/v7/weather/3d?location=${RESOLUTION_STATION.longitude},${RESOLUTION_STATION.latitude}&key=${encodeURIComponent(qWeatherApiKey)}`,
          12000
        )
      : Promise.resolve({ daily: [] })
  ]);

  let openRows: HourlyPoint[] = [];
  let wttrRows: HourlyPoint[] = [];
  let metNoRows: HourlyPoint[] = [];
  let wttrFailureReason: string | null = null;
  let weatherApiDailyMax: number | null = null;
  let qWeatherDailyMax: number | null = null;
  let wuDailyMax: number | null = null;
  let wuNowcasting: WundergroundNowcasting | null = null;
  let wuPeakWindow: { startHour: number; endHour: number; medianHour: number; sampleDays: number; method: string } | null = null;
  const errors: string[] = [];
  const strictRequiredSources = strictSourceListFromEnv();
  const targetKey = toDateKey(targetDateResolved);
  const apiStatus: Record<WeatherSourceCode, ApiHealth> = {
    wunderground: { status: 'skipped', hasData: false },
    wunderground_daily: { status: 'skipped', hasData: false },
    wunderground_history: { status: 'skipped', hasData: false },
    open_meteo: { status: 'skipped', hasData: false },
    wttr: { status: 'skipped', hasData: false },
    met_no: { status: 'skipped', hasData: false },
    weatherapi: { status: 'skipped', hasData: false },
    qweather: { status: 'skipped', hasData: false }
  };

  if (wuNowcastRes.status === 'fulfilled') {
    wuNowcasting = wuNowcastRes.value;
    apiStatus.wunderground = { status: 'ok', hasData: true };
  } else {
    const reason = `Wunderground nowcasting 拉取失败：${wuNowcastRes.reason instanceof Error ? wuNowcastRes.reason.message : String(wuNowcastRes.reason)}`;
    apiStatus.wunderground = { status: 'fetch_error', hasData: false, reason };
    if (strictRequiredSources.includes('wunderground')) {
      errors.push(reason);
    }
  }

  if (wuDailyRes.status === 'fulfilled') {
    wuDailyMax = typeof wuDailyRes.value === 'number' && Number.isFinite(wuDailyRes.value) ? wuDailyRes.value : null;
    apiStatus.wunderground_daily = {
      status: wuDailyMax == null ? 'no_data' : 'ok',
      hasData: wuDailyMax != null,
      reason: wuDailyMax == null ? '目标日未返回最高温预测' : undefined
    };
  } else {
    const reason = `Wunderground 次日最高温预测拉取失败：${wuDailyRes.reason instanceof Error ? wuDailyRes.reason.message : String(wuDailyRes.reason)}`;
    apiStatus.wunderground_daily = { status: 'fetch_error', hasData: false, reason };
    if (strictRequiredSources.includes('wunderground_daily')) {
      errors.push(reason);
    }
  }

  if (wuHistoryRes.status === 'fulfilled') {
    wuPeakWindow = wuHistoryRes.value
      ? {
          startHour: wuHistoryRes.value.startHour,
          endHour: wuHistoryRes.value.endHour,
          medianHour: wuHistoryRes.value.medianHour,
          sampleDays: wuHistoryRes.value.sampleDays,
          method: wuHistoryRes.value.method
        }
      : null;
    apiStatus.wunderground_history = {
      status: wuPeakWindow == null ? 'no_data' : 'ok',
      hasData: wuPeakWindow != null,
      reason: wuPeakWindow == null ? '历史样本不足，未生成峰值窗口' : undefined
    };
  } else {
    const reason = `Wunderground 历史峰值窗口学习失败：${wuHistoryRes.reason instanceof Error ? wuHistoryRes.reason.message : String(wuHistoryRes.reason)}`;
    apiStatus.wunderground_history = { status: 'fetch_error', hasData: false, reason };
    if (strictRequiredSources.includes('wunderground_history')) {
      errors.push(reason);
    }
  }

  if (openMeteoRes.status === 'fulfilled') {
    try {
      openRows = toOpenMeteoRows(openMeteoSchema.parse(openMeteoRes.value).hourly);
      apiStatus.open_meteo = { status: openRows.length ? 'ok' : 'no_data', hasData: openRows.length > 0, reason: openRows.length ? undefined : '无逐小时数据' };
    } catch (error) {
      const reason = `Open-Meteo 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
      errors.push(reason);
      apiStatus.open_meteo = { status: 'parse_error', hasData: false, reason };
    }
  } else {
    const reason = `Open-Meteo 拉取失败：${openMeteoRes.reason instanceof Error ? openMeteoRes.reason.message : String(openMeteoRes.reason)}`;
    errors.push(reason);
    apiStatus.open_meteo = { status: 'fetch_error', hasData: false, reason };
  }

  if (wttrRes.status === 'fulfilled') {
    try {
      wttrRows = toWttrRows(wttrSchema.parse(wttrRes.value));
      apiStatus.wttr = { status: wttrRows.length ? 'ok' : 'no_data', hasData: wttrRows.length > 0, reason: wttrRows.length ? undefined : '无逐小时数据' };
    } catch (error) {
      const reason = `wttr.in 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
      errors.push(reason);
      apiStatus.wttr = { status: 'parse_error', hasData: false, reason };
      wttrFailureReason = reason;
    }
  } else {
    const reason = `wttr.in 拉取失败：${wttrRes.reason instanceof Error ? wttrRes.reason.message : String(wttrRes.reason)}`;
    errors.push(reason);
    apiStatus.wttr = { status: 'fetch_error', hasData: false, reason };
    wttrFailureReason = reason;
  }

  if (metNoRes.status === 'fulfilled') {
    try {
      metNoRows = toMetNoRows(metNoSchema.parse(metNoRes.value));
      apiStatus.met_no = { status: metNoRows.length ? 'ok' : 'no_data', hasData: metNoRows.length > 0, reason: metNoRows.length ? undefined : '无逐小时数据' };
    } catch (error) {
      const reason = `met.no 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
      errors.push(reason);
      apiStatus.met_no = { status: 'parse_error', hasData: false, reason };
    }
  } else {
    const reason = `met.no 拉取失败：${metNoRes.reason instanceof Error ? metNoRes.reason.message : String(metNoRes.reason)}`;
    errors.push(reason);
    apiStatus.met_no = { status: 'fetch_error', hasData: false, reason };
  }

  // wttr upstream is intermittently returning "Unknown location" instead of JSON.
  // To keep decision chain alive without fake numbers, use met.no as transparent proxy fallback.
  const wttrLooksLikeUpstreamUnknown = /unknown\s+location|unknown\s+lo/i.test(wttrFailureReason ?? '');
  if (!wttrRows.length && wttrLooksLikeUpstreamUnknown && metNoRows.length) {
    wttrRows = metNoRows.map((r) => ({ ...r }));
    apiStatus.wttr = {
      status: 'fallback_proxy',
      hasData: true,
      reason: 'wttr 上游异常（Unknown location），已临时使用 met.no 逐小时数据代理。'
    };
  }

  if (weatherApiRes.status === 'fulfilled') {
    if (!weatherApiKey) {
      apiStatus.weatherapi = { status: 'skipped', hasData: false, reason: '未配置 WEATHERAPI_KEY' };
      if (strictRequiredSources.includes('weatherapi')) {
        errors.push('WeatherAPI 未配置 API Key（WEATHERAPI_KEY）');
      }
    } else {
      try {
        weatherApiDailyMax = parseWeatherApiDailyMax(weatherApiSchema.parse(weatherApiRes.value), targetKey);
        apiStatus.weatherapi = {
          status: weatherApiDailyMax == null ? 'no_data' : 'ok',
          hasData: weatherApiDailyMax != null,
          reason: weatherApiDailyMax == null ? '目标日未返回最高温' : undefined
        };
        if (weatherApiDailyMax == null) {
          if (strictRequiredSources.includes('weatherapi')) {
            errors.push('WeatherAPI 解析失败：未提取到目标日最高温');
          }
        }
      } catch (error) {
        const reason = `WeatherAPI 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
        apiStatus.weatherapi = { status: 'parse_error', hasData: false, reason };
        if (strictRequiredSources.includes('weatherapi')) {
          errors.push(reason);
        }
      }
    }
  } else {
    const reason = `WeatherAPI 拉取失败：${weatherApiRes.reason instanceof Error ? weatherApiRes.reason.message : String(weatherApiRes.reason)}`;
    apiStatus.weatherapi = { status: 'fetch_error', hasData: false, reason };
    if (strictRequiredSources.includes('weatherapi')) {
      errors.push(reason);
    }
  }

  if (qWeatherRes.status === 'fulfilled') {
    if (!qWeatherApiKey) {
      apiStatus.qweather = { status: 'skipped', hasData: false, reason: '未配置 QWEATHER_API_KEY' };
      if (strictRequiredSources.includes('qweather')) {
        errors.push('QWeather 未配置 API Key（QWEATHER_API_KEY）');
      }
    } else {
      try {
        qWeatherDailyMax = parseQWeatherDailyMax(qWeatherSchema.parse(qWeatherRes.value), targetKey);
        apiStatus.qweather = {
          status: qWeatherDailyMax == null ? 'no_data' : 'ok',
          hasData: qWeatherDailyMax != null,
          reason: qWeatherDailyMax == null ? '目标日未返回最高温' : undefined
        };
        if (qWeatherDailyMax == null && strictRequiredSources.includes('qweather')) {
          errors.push('QWeather 解析失败：未提取到目标日最高温');
        }
      } catch (error) {
        const reason = `QWeather 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
        apiStatus.qweather = { status: 'parse_error', hasData: false, reason };
        if (strictRequiredSources.includes('qweather')) {
          errors.push(reason);
        }
      }
    }
  } else if (strictRequiredSources.includes('qweather')) {
    const reason = `QWeather 拉取失败：${qWeatherRes.reason instanceof Error ? qWeatherRes.reason.message : String(qWeatherRes.reason)}`;
    errors.push(reason);
    apiStatus.qweather = { status: 'fetch_error', hasData: false, reason };
  } else {
    const reason = `QWeather 拉取失败：${qWeatherRes.reason instanceof Error ? qWeatherRes.reason.message : String(qWeatherRes.reason)}`;
    apiStatus.qweather = { status: 'fetch_error', hasData: false, reason };
  }

  if (!openRows.length && !wttrRows.length && !metNoRows.length) {
    throw new Error(`天气实时数据获取失败：${errors.join(' | ')}`);
  }

  const openTarget = filterByDateKey(openRows, targetKey);
  const wttrTarget = filterByDateKey(wttrRows, targetKey);
  const metNoTarget = filterByDateKey(metNoRows, targetKey);
  if (apiStatus.open_meteo.status === 'ok' && openTarget.length === 0) {
    apiStatus.open_meteo = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }
  if (apiStatus.wttr.status === 'ok' && wttrTarget.length === 0) {
    apiStatus.wttr = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }
  if (apiStatus.met_no.status === 'ok' && metNoTarget.length === 0) {
    apiStatus.met_no = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }

  const availability: Record<WeatherSourceCode, boolean> = {
    wunderground: wuNowcasting != null,
    wunderground_daily: wuDailyMax != null,
    wunderground_history: wuPeakWindow != null,
    open_meteo: openTarget.length > 0,
    wttr: wttrTarget.length > 0,
    met_no: metNoTarget.length > 0,
    weatherapi: weatherApiDailyMax != null,
    qweather: qWeatherDailyMax != null
  };
  const missingSources: WeatherSourceCode[] = strictRequiredSources.filter((s) => !availability[s]);
  const strictReady = missingSources.length === 0;

  const data = buildAssistFromTargetDay(openRows, wttrRows, metNoRows, targetKey, {
    targetDate: targetKey,
    mode: 'next_day_forecast',
    resolutionSource: 'Wunderground(ZSPD)',
    resolutionSourceStatus: wuNowcasting ? 'direct' : 'not_direct',
    stationName: RESOLUTION_STATION.stationName,
    stationCode: RESOLUTION_STATION.stationCode,
    stationLat: RESOLUTION_STATION.latitude,
    stationLon: RESOLUTION_STATION.longitude,
    stationTimezone: RESOLUTION_STATION.timezone,
    strictRequiredSources,
    strictReady,
    missingSources,
    errors,
    apiStatus,
    openMeteo: openMeteoRes.status === 'fulfilled' ? 'ok' : null,
    wunderground: wuNowcasting ? 'ok' : null,
    wundergroundDaily: wuDailyMax != null ? 'ok' : null,
    wttr: wttrRes.status === 'fulfilled' ? 'ok' : null,
    metNo: metNoRes.status === 'fulfilled' ? 'ok' : null,
    weatherapi: weatherApiDailyMax != null ? 'ok' : null,
    qweather: qWeatherDailyMax != null ? 'ok' : null,
    sourceGroups: {
      free: ['wunderground_daily', 'open_meteo', 'wttr', 'met_no'],
      paid: ['weatherapi', 'qweather']
    }
  }, weatherApiDailyMax, qWeatherDailyMax, wuNowcasting, wuDailyMax, wuPeakWindow);

  return { source: 'api', data };
}

async function fetchWttrJson(timeoutMs: number) {
  const urls = [
    `https://wttr.in/${RESOLUTION_STATION.stationCode}?format=j1`,
    `https://wttr.in/~${RESOLUTION_STATION.latitude},${RESOLUTION_STATION.longitude}?format=j1`,
    `https://wttr.in/${RESOLUTION_STATION.latitude},${RESOLUTION_STATION.longitude}?format=j1`,
    'https://wttr.in/Shanghai?format=j1'
  ];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      return await fetchJsonWithCurlFallback(url, timeoutMs);
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      const suggestion = await parseWttrSuggestedLocation(url, timeoutMs);
      if (suggestion) {
        const suggestedUrl = `https://wttr.in/${suggestion}?format=j1`;
        try {
          return await fetchJsonWithCurlFallback(suggestedUrl, timeoutMs);
        } catch (e2) {
          errors.push(`${suggestedUrl} -> ${e2 instanceof Error ? e2.message : String(e2)}`);
        }
      }
    }
  }
  throw new Error(errors.join(' | '));
}

async function parseWttrSuggestedLocation(url: string, timeoutMs: number) {
  try {
    const text = await fetchTextWithCurlFallback(url, timeoutMs);
    const m = text.match(/please try\s+(~[-\d.]+,[-\d.]+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function parseWeatherApiDailyMax(payload: z.infer<typeof weatherApiSchema>, targetDateKey: string): number | null {
  for (const d of payload.forecast?.forecastday ?? []) {
    if (d.date !== targetDateKey) continue;
    const val = Number(d.day.maxtemp_c);
    if (Number.isFinite(val)) return val;
  }
  return null;
}

function parseQWeatherDailyMax(payload: z.infer<typeof qWeatherSchema>, targetDateKey: string): number | null {
  for (const d of payload.daily ?? []) {
    if (d.fxDate !== targetDateKey) continue;
    const val = Number(d.tempMax);
    if (Number.isFinite(val)) return val;
  }
  return null;
}

function buildAssistFromTargetDay(
  openRows: HourlyPoint[],
  wttrRows: HourlyPoint[],
  metNoRows: HourlyPoint[],
  targetDateKey: string,
  rawMeta: Record<string, unknown>,
  weatherApiDailyMax: number | null,
  qWeatherDailyMax: number | null,
  wuNowcasting: WundergroundNowcasting | null,
  wuDailyMax: number | null,
  wuPeakWindow: { startHour: number; endHour: number; medianHour: number; sampleDays: number; method: string } | null
): WeatherAssist {
  const openTarget = filterByDateKey(openRows, targetDateKey);
  const wttrTarget = filterByDateKey(wttrRows, targetDateKey);
  const metTarget = filterByDateKey(metNoRows, targetDateKey);

  if (!openTarget.length && !wttrTarget.length && !metTarget.length && weatherApiDailyMax == null && qWeatherDailyMax == null && wuDailyMax == null) {
    throw new Error(`天气源中未找到目标日(${targetDateKey})逐小时预测`);
  }

  const mergedRows = mergeAllRows(openTarget, wttrTarget, metTarget);
  if (!mergedRows.length && weatherApiDailyMax == null && qWeatherDailyMax == null && wuDailyMax == null) {
    throw new Error(`目标日(${targetDateKey})逐小时预测融合失败`);
  }

  const fallback = mergedRows[0] ?? {
    time: new Date(`${targetDateKey}T14:00:00+08:00`),
    temp: wuDailyMax ?? weatherApiDailyMax ?? qWeatherDailyMax ?? 0,
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

  const rowDailyMaxRaw = mergedRows.length ? Math.max(...mergedRows.map((r) => r.temp)) : (wuDailyMax ?? weatherApiDailyMax ?? qWeatherDailyMax ?? peak.temp);
  const wuDailyMaxInt = toResolutionInt(wuDailyMax);
  const openDailyMax = toResolutionInt(openTarget.length ? Math.max(...openTarget.map((r) => r.temp)) : null);
  const wttrDailyMax = toResolutionInt(wttrTarget.length ? Math.max(...wttrTarget.map((r) => r.temp)) : null);
  const metNoDailyMax = toResolutionInt(metTarget.length ? Math.max(...metTarget.map((r) => r.temp)) : null);
  const weatherApiDailyMaxInt = toResolutionInt(weatherApiDailyMax);
  const qWeatherDailyMaxInt = toResolutionInt(qWeatherDailyMax);
  const rowDailyMax = toResolutionInt(rowDailyMaxRaw) ?? 0;
  const fusedDailyMax = mergeMedian([
    wuDailyMaxInt ?? undefined,
    openDailyMax ?? undefined,
    wttrDailyMax ?? undefined,
    metNoDailyMax ?? undefined,
    weatherApiDailyMaxInt ?? undefined,
    qWeatherDailyMaxInt ?? undefined
  ]);
  const dailyMax = fusedDailyMax > 0 ? Math.round(fusedDailyMax) : rowDailyMax;
  const sourceSpread = spreadOf([wuDailyMaxInt, openDailyMax, wttrDailyMax, metNoDailyMax, weatherApiDailyMaxInt, qWeatherDailyMaxInt]);
  const confidence =
    sourceSpread == null ? 'low' : sourceSpread <= 1 ? 'high' : sourceSpread <= 2.5 ? 'medium' : 'low';

  const precipitationProxy = Math.max(peak.precip, (peak.rainProb ?? 0) / 100);
  const nowcasting = buildNowcastingContext(openRows, wttrRows, metNoRows, targetDateKey, wuNowcasting);

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
      nowcasting,
      learnedPeakWindow: wuPeakWindow,
      peakHourLocal: hourOf(peak.time),
      dailyMaxForecast: dailyMax,
      dailyMinForecast: mergedRows.length ? Math.min(...mergedRows.map((r) => r.temp)) : null,
      sourceDailyMax: {
        wundergroundDaily: wuDailyMaxInt,
        openMeteo: openDailyMax,
        wttr: wttrDailyMax,
        metNo: metNoDailyMax,
        weatherApi: weatherApiDailyMaxInt,
        qWeather: qWeatherDailyMaxInt,
        cmaChina: qWeatherDailyMaxInt,
        fused: dailyMax,
        spread: sourceSpread
      },
      forecastExplain: {
        method: 'median_of_sources',
        confidence,
        zh: `次日最高温由多源日高温预测融合得到：Wunderground ${wuDailyMaxInt ?? '-'}°C / Open‑Meteo ${openDailyMax ?? '-'}°C / wttr ${wttrDailyMax ?? '-'}°C / met.no ${metNoDailyMax ?? '-'}°C / WeatherAPI ${weatherApiDailyMaxInt ?? '-'}°C / QWeather ${qWeatherDailyMaxInt ?? '-'}°C，取中位数得到 ${dailyMax}°C。源间分歧 ${sourceSpread?.toFixed(1) ?? '-'}°C，置信度 ${confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'}。`,
        en: `Next-day max temperature is fused from multiple source daily highs: Wunderground ${wuDailyMaxInt ?? '-'}°C / Open‑Meteo ${openDailyMax ?? '-'}°C / wttr ${wttrDailyMax ?? '-'}°C / met.no ${metNoDailyMax ?? '-'}°C / WeatherAPI ${weatherApiDailyMaxInt ?? '-'}°C / QWeather ${qWeatherDailyMaxInt ?? '-'}°C. Median result is ${dailyMax}°C. Cross-source spread is ${sourceSpread?.toFixed(1) ?? '-'}°C, confidence is ${confidence}.`
      }
    }
  };
}

function toResolutionInt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function toOpenMeteoRows(hourly: z.infer<typeof openMeteoSchema>['hourly']): HourlyPoint[] {
  return hourly.time.map((t, i) => ({
    time: new Date(`${t}:00+08:00`),
    temp: hourly.temperature_2m[i] ?? 0,
    cloud: hourly.cloud_cover?.[i] ?? 0,
    precip: hourly.precipitation?.[i] ?? 0,
    wind: hourly.wind_speed_10m?.[i] ?? 0,
    windDirection: hourly.wind_direction_10m?.[i] ?? undefined,
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
        windDirection: Number(h.winddirDegree ?? '0'),
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
      windDirection: t.data.instant.details.wind_from_direction ?? undefined,
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
    windDirection: mergeMedian([o?.windDirection, w?.windDirection, m?.windDirection]),
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

function buildNowcastingContext(
  openRows: HourlyPoint[],
  wttrRows: HourlyPoint[],
  metRows: HourlyPoint[],
  targetDateKey: string,
  wuNowcasting: WundergroundNowcasting | null
) {
  const now = new Date();
  const nowHour = hourOf(now);
  const todayKey = toDateKey(now);
  const openToday = filterByDateKey(openRows, todayKey);
  const wttrToday = filterByDateKey(wttrRows, todayKey);
  const metToday = filterByDateKey(metRows, todayKey);
  const todayMerged = mergeAllRows(openToday, wttrToday, metToday);
  const targetMerged = mergeAllRows(filterByDateKey(openRows, targetDateKey), filterByDateKey(wttrRows, targetDateKey), filterByDateKey(metRows, targetDateKey));
  const timeline = todayMerged.length ? todayMerged : targetMerged;
  const current = pickHour(timeline, nowHour) ?? timeline[0] ?? {
    time: now,
    temp: 0,
    cloud: 0,
    precip: 0,
    wind: 0,
    windDirection: 0,
    humidity: 0,
    rainProb: 0
  };

  const prev1 = pickHour(timeline, nowHour - 1) ?? current;
  const prev2 = pickHour(timeline, nowHour - 2) ?? prev1;
  const prev3 = pickHour(timeline, nowHour - 3) ?? prev2;

  const upToNow = timeline.filter((r) => hourOf(r.time) <= nowHour);
  const fallbackPrecipitationProb = current.rainProb != null && Number.isFinite(current.rainProb)
    ? Math.max(0, Math.min(100, current.rainProb))
    : (current.precip > 0 ? 55 : 10);

  const fallbackFuture = [1, 2, 3].map((offset) => {
    const row = pickHour(timeline, nowHour + offset) ?? current;
    const pProb = row.rainProb != null && Number.isFinite(row.rainProb)
      ? Math.max(0, Math.min(100, row.rainProb))
      : (row.precip > 0 ? 55 : 10);
    return {
      hourOffset: offset,
      temp: row.temp,
      cloudCover: row.cloud,
      precipitationProb: pProb,
      windSpeed: row.wind,
      windDirection: row.windDirection ?? null
    };
  });

  const precipitationProb = wuNowcasting?.precipitationProb ?? fallbackPrecipitationProb;
  const future = (wuNowcasting?.futureHours?.length ? wuNowcasting.futureHours.slice(0, 3).map((x) => ({
    hourOffset: x.hourOffset,
    temp: x.temp ?? current.temp,
    cloudCover: x.cloudCover ?? current.cloud,
    precipitationProb: x.precipitationProb ?? precipitationProb,
    windSpeed: x.windSpeed ?? current.wind,
    windDirection: x.windDirection ?? current.windDirection ?? null
  })) : fallbackFuture);

  const currentTemp = wuNowcasting?.currentTemp ?? current.temp;
  const todayMaxTemp = wuNowcasting?.todayMaxTemp ?? (upToNow.length ? Math.max(...upToNow.map((r) => r.temp)) : currentTemp);
  const cloudCover = wuNowcasting?.cloudCover ?? current.cloud;
  const windSpeed = wuNowcasting?.windSpeed ?? current.wind;
  const windDirection = wuNowcasting?.windDirection ?? current.windDirection ?? null;
  const humidity = wuNowcasting?.humidity ?? current.humidity;
  const tempRise1h = currentTemp - prev1.temp;
  const tempRise2h = currentTemp - prev2.temp;
  const tempRise3h = currentTemp - prev3.temp;

  const scenarioTag = (cloudCover < 40 && precipitationProb < 20 && tempRise1h > 0)
    ? 'stable_sunny'
    : (cloudCover > 70 || precipitationProb > 40 || tempRise1h <= 0)
      ? 'suppressed_heating'
      : 'neutral';

  let maturity = 45;
  if (nowHour >= 11 && nowHour <= 16) maturity += 20;
  else if (nowHour >= 8 && nowHour <= 18) maturity += 10;
  if (tempRise2h > 0.5) maturity += 12;
  if (cloudCover > 70) maturity -= 12;
  if (precipitationProb > 40) maturity -= 18;
  const availableSourceCount = [wuNowcasting != null, openToday.length > 0, wttrToday.length > 0, metToday.length > 0].filter(Boolean).length;
  maturity += availableSourceCount * 4;
  maturity = Math.max(0, Math.min(100, maturity));

  return {
    observedAt: wuNowcasting?.observedAt ?? current.time,
    currentTemp,
    todayMaxTemp,
    temp1hAgo: prev1.temp,
    temp2hAgo: prev2.temp,
    temp3hAgo: prev3.temp,
    tempRise1h,
    tempRise2h,
    tempRise3h,
    cloudCover,
    precipitationProb,
    windSpeed,
    windDirection,
    humidity,
    futureHours: future,
    scenarioTag,
    weatherMaturityScore: maturity
  };
}
