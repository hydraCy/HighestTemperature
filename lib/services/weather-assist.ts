import { z } from 'zod';
import { fetchJsonWithCurlFallback, fetchTextWithCurlFallback } from '@/lib/utils/http-json';
import {
  fetchWundergroundNowcasting,
  fetchWundergroundDailyMaxForecast,
  fetchWundergroundPeakWindow30d,
  type WundergroundNowcasting
} from '@/lib/services/wunderground-nowcasting';
import { runFusionEngine } from '@/src/lib/fusion-engine/fuse';
import type { HistoricalCalibration, WeatherSourceInput } from '@/src/lib/fusion-engine/types';
import { classifySourceKind, type SourceKind } from '@/src/lib/fusion-engine/sourcePolicy';
import { computeSourceHealth } from '@/lib/services/source-health';
import { classifyWeatherRegime } from '@/src/lib/trading-engine/regimeClassifier';

const RESOLUTION_STATION = {
  stationName: 'Shanghai Pudong International Airport Station',
  stationCode: 'ZSPD',
  latitude: 31.1443,
  longitude: 121.8083,
  timezone: 'Asia/Shanghai'
} as const;

const nwsHourlySchema = z.object({
  properties: z.object({
    updated: z.string().optional(),
    periods: z.array(
      z.object({
        startTime: z.string(),
        temperature: z.number().nullable().optional(),
        temperatureUnit: z.string().optional(),
        windSpeed: z.string().optional(),
        windDirection: z.string().optional(),
        shortForecast: z.string().optional(),
        probabilityOfPrecipitation: z.object({ value: z.number().nullable().optional() }).optional(),
        relativeHumidity: z.object({ value: z.number().nullable().optional() }).optional(),
        skyCover: z.object({ value: z.number().nullable().optional() }).optional()
      })
    )
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
        maxtempC: z.string().optional(),
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
    meta: z.object({
      updated_at: z.string().optional()
    }).optional(),
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

const openMeteoSchema = z.object({
  daily: z.object({
    time: z.array(z.string()).optional(),
    temperature_2m_max: z.array(z.number().nullable()).optional()
  }).optional(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    cloud_cover: z.array(z.number().nullable()).optional(),
    precipitation: z.array(z.number().nullable()).optional(),
    precipitation_probability: z.array(z.number().nullable()).optional(),
    wind_speed_10m: z.array(z.number().nullable()).optional(),
    wind_direction_10m: z.array(z.number().nullable()).optional(),
    relative_humidity_2m: z.array(z.number().nullable()).optional()
  })
});

const weatherApiSchema = z.object({
  current: z.object({
    last_updated_epoch: z.number().optional(),
    last_updated: z.string().optional()
  }).optional(),
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
  updateTime: z.string().optional(),
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

type AviationMetarPoint = {
  observedAt: Date;
  tempC: number | null;
  dewpointC: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  visibilityKm: number | null;
  cloudCoverPct: number | null;
  rawText?: string;
};

type AviationTafPoint = {
  issuedAt: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  rawText?: string;
  parsed?: {
    station?: string;
    validity?: { fromDay: number; fromHour: number; toDay: number; toHour: number };
    segments: Array<{
      type: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
      marker?: string;
      windDirectionDeg?: number | null;
      windSpeedKt?: number | null;
      gustKt?: number | null;
      visibility?: string | null;
      weatherCodes: string[];
      cloudCodes: string[];
    }>;
    next3hRisk?: {
      precipLike: boolean;
      convectiveLike: boolean;
      lowCeilingLike: boolean;
      strongestSignal: string | null;
    };
  };
};

type ParsedTafSegment = {
  type: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB';
  marker?: string;
  windDirectionDeg?: number | null;
  windSpeedKt?: number | null;
  gustKt?: number | null;
  visibility?: string | null;
  weatherCodes: string[];
  cloudCodes: string[];
};

type WeatherSourceCode = 'wunderground' | 'wunderground_daily' | 'weather_com' | 'wunderground_history' | 'nws_hourly' | 'open_meteo' | 'aviationweather' | 'wttr' | 'met_no' | 'weatherapi' | 'qweather';
type ApiHealthStatus = 'ok' | 'no_data' | 'fetch_error' | 'parse_error' | 'skipped';
type ApiHealth = {
  status: ApiHealthStatus;
  reason?: string;
  hasData: boolean;
  dateLabel?: string;
};

function strictSourceListFromEnv(): WeatherSourceCode[] {
  const raw = process.env.WEATHER_STRICT_SOURCES?.trim();
  if (!raw) return [];
  const allowed: WeatherSourceCode[] = ['wunderground', 'wunderground_daily', 'weather_com', 'wunderground_history', 'nws_hourly', 'open_meteo', 'aviationweather', 'wttr', 'met_no', 'weatherapi', 'qweather'];
  const list = raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is WeatherSourceCode => allowed.includes(x as WeatherSourceCode));
  return list.length ? Array.from(new Set(list)) : [];
}

function strictKindListFromEnv(): SourceKind[] {
  const raw = process.env.WEATHER_STRICT_REQUIRED_KINDS?.trim();
  const allowed: SourceKind[] = ['settlement', 'observation', 'forecast', 'guidance'];
  if (!raw) return ['settlement', 'forecast', 'guidance'];
  const kinds = raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x): x is SourceKind => allowed.includes(x as SourceKind));
  return kinds.length ? Array.from(new Set(kinds)) : ['settlement', 'forecast', 'guidance'];
}

function fusionExcludedSourcesFromEnv() {
  const raw = process.env.FUSION_EXCLUDED_SOURCES?.trim();
  if (!raw) return new Set<string>(['nws_hourly']);
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isNwsHourlyEnabled() {
  return (process.env.ENABLE_NWS_HOURLY ?? 'false').toLowerCase() === 'true';
}

function formatShanghaiDate(dateLike: Date | string | null | undefined) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESOLUTION_STATION.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const day = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${day}`;
}

function formatShanghaiDateTime(dateLike: Date | string | null | undefined) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESOLUTION_STATION.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const day = parts.find((p) => p.type === 'day')?.value ?? '00';
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${y}-${m}-${day} ${h}:${mm}`;
}

export async function fetchShanghaiWeatherAssist(targetDate?: Date, marketId?: string): Promise<{ data: WeatherAssist; source: 'api' }> {
  const weatherApiKey = process.env.WEATHERAPI_KEY?.trim();
  const weatherApiBase = (process.env.WEATHERAPI_API_BASE?.trim() || 'https://api.weatherapi.com/v1').replace(/\/+$/, '');
  const qWeatherApiKey = process.env.QWEATHER_API_KEY?.trim();
  const qWeatherApiBase = (process.env.QWEATHER_API_BASE?.trim() || 'https://devapi.qweather.com').replace(/\/+$/, '');
  const nwsEnabled = isNwsHourlyEnabled();
  const targetDateResolved = targetDate ?? tomorrowInShanghai();
  const [wuNowcastRes, wuDailyRes, wuHistoryRes, nwsHourlyRes, openMeteoRes, aviationRes, wttrRes, metNoRes, weatherApiRes, qWeatherRes] = await Promise.allSettled([
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
    nwsEnabled ? fetchNwsHourlyJson(12000) : Promise.resolve(null),
    fetchJsonWithCurlFallback(
      `https://api.open-meteo.com/v1/forecast?latitude=${RESOLUTION_STATION.latitude}&longitude=${RESOLUTION_STATION.longitude}&hourly=temperature_2m,cloud_cover,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,relative_humidity_2m&forecast_days=3&timezone=${encodeURIComponent(RESOLUTION_STATION.timezone)}&models=ecmwf_ifs04`,
      12000
    ),
    fetchAviationMetarTaf(12000),
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

  let nwsRows: HourlyPoint[] = [];
  let openMeteoRows: HourlyPoint[] = [];
  let openMeteoDailyMax: number | null = null;
  let wttrRows: HourlyPoint[] = [];
  let wttrDailyMax: number | null = null;
  let metNoRows: HourlyPoint[] = [];
  let aviationMetar: AviationMetarPoint | null = null;
  let aviationTaf: AviationTafPoint | null = null;
  let weatherApiDailyMax: number | null = null;
  let weatherApiUpdatedAt: string | null = null;
  let weatherApiMeta: { matchedDate: string | null; availableDates: string[]; field: 'maxtemp_c' } = {
    matchedDate: null,
    availableDates: [],
    field: 'maxtemp_c'
  };
  let qWeatherDailyMax: number | null = null;
  let qWeatherUpdatedAt: string | null = null;
  let nwsUpdatedAt: string | null = null;
  let metNoUpdatedAt: string | null = null;
  let wuDailyMax: number | null = null;
  let wuNowcasting: WundergroundNowcasting | null = null;
  let wuPeakWindow: { startHour: number; endHour: number; medianHour: number; sampleDays: number; method: string } | null = null;
  const errors: string[] = [];
  const strictRequiredSources = strictSourceListFromEnv();
  const strictRequiredKinds = strictKindListFromEnv();
  const targetKey = toDateKey(targetDateResolved);
  const apiStatus: Record<WeatherSourceCode, ApiHealth> = {
    wunderground: { status: 'skipped', hasData: false },
    wunderground_daily: { status: 'skipped', hasData: false },
    weather_com: { status: 'skipped', hasData: false, reason: '当前未接入 Weather.com API，保留结算对账位' },
    wunderground_history: { status: 'skipped', hasData: false },
    nws_hourly: { status: 'skipped', hasData: false },
    open_meteo: { status: 'skipped', hasData: false },
    aviationweather: { status: 'skipped', hasData: false },
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

  if (!nwsEnabled) {
    apiStatus.nws_hourly = { status: 'skipped', hasData: false, reason: '未启用 ENABLE_NWS_HOURLY（默认关闭）' };
  } else if (nwsHourlyRes.status === 'fulfilled' && nwsHourlyRes.value) {
    try {
      const parsedNws = nwsHourlySchema.parse(nwsHourlyRes.value);
      nwsUpdatedAt = parsedNws.properties.updated ?? null;
      nwsRows = toNwsRows(parsedNws);
      apiStatus.nws_hourly = { status: nwsRows.length ? 'ok' : 'no_data', hasData: nwsRows.length > 0, reason: nwsRows.length ? undefined : '无逐小时数据' };
    } catch (error) {
      const reason = `NWS 小时预报数据结构异常：${error instanceof Error ? error.message : String(error)}`;
      errors.push(reason);
      apiStatus.nws_hourly = { status: 'parse_error', hasData: false, reason };
    }
  } else if (nwsHourlyRes.status === 'fulfilled') {
    apiStatus.nws_hourly = { status: 'no_data', hasData: false, reason: 'NWS 未返回可用逐小时数据' };
  } else {
    const reason = `NWS 小时预报拉取失败：${nwsHourlyRes.reason instanceof Error ? nwsHourlyRes.reason.message : String(nwsHourlyRes.reason)}`;
    errors.push(reason);
    apiStatus.nws_hourly = { status: 'fetch_error', hasData: false, reason };
  }

  if (openMeteoRes.status === 'fulfilled') {
    try {
      const parsedOpenMeteo = openMeteoSchema.parse(openMeteoRes.value);
      openMeteoRows = toOpenMeteoRows(parsedOpenMeteo);
      openMeteoDailyMax = parseOpenMeteoDailyMax(parsedOpenMeteo, targetKey);
      const hasData = openMeteoRows.length > 0 || openMeteoDailyMax != null;
      apiStatus.open_meteo = {
        status: hasData ? 'ok' : 'no_data',
        hasData,
        reason: hasData ? undefined : 'Open-Meteo(ECMWF IFS) 在目标日返回全 null'
      };
    } catch {
      const reason = 'Open-Meteo 数据结构异常（字段解析失败）';
      errors.push(reason);
      apiStatus.open_meteo = { status: 'parse_error', hasData: false, reason };
    }
  } else {
    const reason = `Open-Meteo 拉取失败：${openMeteoRes.reason instanceof Error ? openMeteoRes.reason.message : String(openMeteoRes.reason)}`;
    errors.push(reason);
    apiStatus.open_meteo = { status: 'fetch_error', hasData: false, reason };
  }

  if (aviationRes.status === 'fulfilled') {
    aviationMetar = aviationRes.value.metar;
    aviationTaf = aviationRes.value.taf;
    apiStatus.aviationweather = {
      status: aviationMetar || aviationTaf ? 'ok' : 'no_data',
      hasData: Boolean(aviationMetar || aviationTaf),
      reason: aviationMetar || aviationTaf ? undefined : 'METAR/TAF 均无可用数据'
    };
  } else {
    const reason = `AviationWeather 拉取失败：${aviationRes.reason instanceof Error ? aviationRes.reason.message : String(aviationRes.reason)}`;
    errors.push(reason);
    apiStatus.aviationweather = { status: 'fetch_error', hasData: false, reason };
  }

  if (wttrRes.status === 'fulfilled') {
    try {
      const wttrParsed = wttrSchema.parse(wttrRes.value);
      wttrRows = toWttrRows(wttrParsed);
      wttrDailyMax = parseWttrDailyMax(wttrParsed, targetKey);
      const hasWttrData = wttrRows.length > 0 || wttrDailyMax != null;
      apiStatus.wttr = {
        status: hasWttrData ? 'ok' : 'no_data',
        hasData: hasWttrData,
        reason: hasWttrData ? undefined : `目标日(${targetKey})无逐小时与日最高温数据`
      };
    } catch (error) {
      const reason = `wttr.in 数据结构异常：${error instanceof Error ? error.message : String(error)}`;
      errors.push(reason);
      apiStatus.wttr = { status: 'parse_error', hasData: false, reason };
    }
  } else {
    const reason = `wttr.in 拉取失败：${wttrRes.reason instanceof Error ? wttrRes.reason.message : String(wttrRes.reason)}`;
    errors.push(reason);
    apiStatus.wttr = { status: 'fetch_error', hasData: false, reason };
  }

  if (metNoRes.status === 'fulfilled') {
    try {
      const parsedMetNo = metNoSchema.parse(metNoRes.value);
      metNoUpdatedAt = parsedMetNo.properties.meta?.updated_at ?? null;
      metNoRows = toMetNoRows(parsedMetNo);
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

  if (weatherApiRes.status === 'fulfilled') {
    if (!weatherApiKey) {
      apiStatus.weatherapi = { status: 'skipped', hasData: false, reason: '未配置 WEATHERAPI_KEY' };
      if (strictRequiredSources.includes('weatherapi')) {
        errors.push('WeatherAPI 未配置 API Key（WEATHERAPI_KEY）');
      }
    } else {
      try {
        const weatherApiParsedPayload = weatherApiSchema.parse(weatherApiRes.value);
        weatherApiUpdatedAt =
          typeof weatherApiParsedPayload.current?.last_updated_epoch === 'number'
            ? new Date(weatherApiParsedPayload.current.last_updated_epoch * 1000).toISOString()
            : (weatherApiParsedPayload.current?.last_updated ?? null);
        const parsedWeatherApi = parseWeatherApiDailyMax(weatherApiParsedPayload, targetKey);
        weatherApiDailyMax = parsedWeatherApi.value;
        weatherApiMeta = {
          matchedDate: parsedWeatherApi.matchedDate,
          availableDates: parsedWeatherApi.availableDates,
          field: parsedWeatherApi.field
        };
        apiStatus.weatherapi = {
          status: weatherApiDailyMax == null ? 'no_data' : 'ok',
          hasData: weatherApiDailyMax != null,
          reason: weatherApiDailyMax == null
            ? `目标日(${targetKey})未返回最高温；可用日期: ${weatherApiMeta.availableDates.join(', ') || '-'}；字段: ${weatherApiMeta.field}`
            : `命中日期 ${weatherApiMeta.matchedDate}；字段 ${weatherApiMeta.field}=${weatherApiDailyMax.toFixed(1)}°C`
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
        const qWeatherParsedPayload = qWeatherSchema.parse(qWeatherRes.value);
        qWeatherUpdatedAt = qWeatherParsedPayload.updateTime ?? null;
        qWeatherDailyMax = parseQWeatherDailyMax(qWeatherParsedPayload, targetKey);
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

  if (!openMeteoRows.length && !nwsRows.length && !wttrRows.length && !metNoRows.length) {
    throw new Error(`天气实时数据获取失败：${errors.join(' | ')}`);
  }

  const openMeteoTarget = filterByDateKey(openMeteoRows, targetKey);
  const nwsTarget = filterByDateKey(nwsRows, targetKey);
  const wttrTarget = filterByDateKey(wttrRows, targetKey);
  const metNoTarget = filterByDateKey(metNoRows, targetKey);
  if (apiStatus.open_meteo.status === 'ok' && openMeteoTarget.length === 0 && openMeteoDailyMax == null) {
    apiStatus.open_meteo = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }
  if (apiStatus.nws_hourly.status === 'ok' && nwsTarget.length === 0) {
    apiStatus.nws_hourly = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }
  if (apiStatus.wttr.status === 'ok' && wttrTarget.length === 0 && wttrDailyMax == null) {
    apiStatus.wttr = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }
  if (apiStatus.met_no.status === 'ok' && metNoTarget.length === 0) {
    apiStatus.met_no = { status: 'no_data', hasData: false, reason: `目标日(${targetKey})无数据` };
  }

  const availability: Record<WeatherSourceCode, boolean> = {
    wunderground: wuNowcasting != null,
    wunderground_daily: wuDailyMax != null,
    weather_com: false,
    wunderground_history: wuPeakWindow != null,
    nws_hourly: nwsTarget.length > 0,
    open_meteo: openMeteoTarget.length > 0 || openMeteoDailyMax != null,
    aviationweather: aviationMetar != null || aviationTaf != null,
    wttr: wttrTarget.length > 0 || wttrDailyMax != null,
    met_no: metNoTarget.length > 0,
    weatherapi: weatherApiDailyMax != null,
    qweather: qWeatherDailyMax != null
  };
  const sourceKindByCode: Record<WeatherSourceCode, SourceKind> = {
    wunderground: classifySourceKind('wunderground'),
    wunderground_daily: classifySourceKind('wunderground_daily'),
    weather_com: classifySourceKind('weather.com'),
    wunderground_history: classifySourceKind('wunderground_history'),
    nws_hourly: classifySourceKind('nws_hourly'),
    open_meteo: classifySourceKind('open_meteo'),
    aviationweather: classifySourceKind('aviationweather'),
    wttr: classifySourceKind('wttr'),
    met_no: classifySourceKind('met_no'),
    weatherapi: classifySourceKind('weatherapi'),
    qweather: classifySourceKind('qweather')
  };
  const availableKinds = new Set<SourceKind>(
    (Object.entries(availability) as Array<[WeatherSourceCode, boolean]>)
      .filter(([, ok]) => ok)
      .map(([code]) => sourceKindByCode[code])
  );
  const missingKinds = strictRequiredKinds.filter((k) => !availableKinds.has(k));
  const missingExplicitSources: WeatherSourceCode[] = strictRequiredSources.filter((s) => !availability[s]);
  const strictMode: 'source' | 'kind' = strictRequiredSources.length > 0 ? 'source' : 'kind';
  const missingSources = strictMode === 'source'
    ? missingExplicitSources
    : missingKinds.map((k) => `kind:${k}` as unknown as WeatherSourceCode);
  const strictReady = missingSources.length === 0;

  const weatherApiDate = weatherApiMeta.matchedDate ?? formatShanghaiDate(weatherApiUpdatedAt);
  const sourceDateLabels: Record<WeatherSourceCode, string | null> = {
    wunderground: formatShanghaiDateTime(wuNowcasting?.observedAt) ?? targetKey,
    wunderground_daily: targetKey,
    weather_com: targetKey,
    wunderground_history: `${targetKey} (30d)`,
    nws_hourly: formatShanghaiDateTime(nwsUpdatedAt) ?? targetKey,
    open_meteo: targetKey,
    aviationweather: formatShanghaiDateTime(aviationMetar?.observedAt ?? aviationTaf?.issuedAt) ?? targetKey,
    wttr: targetKey,
    met_no: metNoUpdatedAt
      ? `${targetKey}（发布 ${formatShanghaiDateTime(metNoUpdatedAt) ?? '-'}）`
      : targetKey,
    weatherapi: weatherApiDate ?? targetKey,
    qweather: formatShanghaiDateTime(qWeatherUpdatedAt) ?? targetKey,
  };
  (Object.keys(apiStatus) as WeatherSourceCode[]).forEach((code) => {
    apiStatus[code] = {
      ...apiStatus[code],
      dateLabel: sourceDateLabels[code] ?? targetKey,
    };
  });

  const data = await buildAssistFromTargetDay(openMeteoRows, openMeteoDailyMax, nwsRows, wttrRows, wttrDailyMax, metNoRows, targetKey, {
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
    strictRequiredKinds,
    strictMode,
    strictReady,
    missingSources,
    errors,
    apiStatus,
    openMeteo: apiStatus.open_meteo.status === 'ok' ? 'ok' : null,
    openMeteoModel: 'ecmwf_ifs04',
    nwsHourly: apiStatus.nws_hourly.status === 'ok' ? 'ok' : null,
    wunderground: wuNowcasting ? 'ok' : null,
    wundergroundDaily: wuDailyMax != null ? 'ok' : null,
    wttr: wttrRes.status === 'fulfilled' ? 'ok' : null,
    metNo: metNoRes.status === 'fulfilled' ? 'ok' : null,
    weatherapi: weatherApiDailyMax != null ? 'ok' : null,
    qweather: qWeatherDailyMax != null ? 'ok' : null,
    sourceGroups: {
      free: ['wunderground_daily', 'open_meteo', 'aviationweather', 'wttr', 'met_no'],
      paid: ['weatherapi', 'qweather']
    },
    weatherapiMeta: weatherApiMeta
  }, weatherApiDailyMax, qWeatherDailyMax, wuNowcasting, wuDailyMax, wuPeakWindow, aviationMetar, aviationTaf, {
    nwsUpdatedAt,
    metNoUpdatedAt,
    weatherApiUpdatedAt,
    qWeatherUpdatedAt
  }, marketId);

  return { source: 'api', data };
}

async function fetchNwsHourlyJson(timeoutMs: number) {
  const lat = RESOLUTION_STATION.latitude;
  const lon = RESOLUTION_STATION.longitude;
  const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
  try {
    const points = await fetchJsonWithCurlFallback(pointsUrl, timeoutMs) as {
      properties?: { forecastHourly?: string };
      detail?: string;
      title?: string;
      status?: number;
    };
    const forecastHourlyUrl = points?.properties?.forecastHourly;
    if (!forecastHourlyUrl) {
      const msg = points?.detail || points?.title || `NWS points 未返回 forecastHourly`;
      throw new Error(msg);
    }
    return await fetchJsonWithCurlFallback(forecastHourlyUrl, timeoutMs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/outside|unavailable|no\s+gridpoint|not\s+found|404/i.test(msg)) {
      throw new Error(`NWS 仅覆盖美国本土网格，当前站点(${RESOLUTION_STATION.stationCode})不在覆盖范围`);
    }
    throw error;
  }
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseAviationCloudPct(raw: string | undefined) {
  if (!raw) return null;
  const s = raw.toUpperCase();
  if (s.includes('CLR') || s.includes('SKC')) return 0;
  if (s.includes('FEW')) return 20;
  if (s.includes('SCT')) return 45;
  if (s.includes('BKN')) return 75;
  if (s.includes('OVC')) return 95;
  return null;
}

function parseMetarTempFromRaw(rawText: string | undefined): number | null {
  if (!rawText) return null;
  const m = rawText.match(/\s(M?\d{1,2})\/(M?\d{1,2})\s/);
  if (!m) return null;
  const toSigned = (s: string) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));
  const t = toSigned(m[1]);
  return Number.isFinite(t) ? t : null;
}

function parseAviationMetar(row: unknown): AviationMetarPoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const rawText = typeof r.rawOb === 'string' ? r.rawOb : (typeof r.raw_text === 'string' ? r.raw_text : undefined);
  const observedAtRaw = r.obsTime || r.observation_time || r.observed || r.reportTime || r.report_time || null;
  const observedAtParsed = observedAtRaw ? new Date(String(observedAtRaw)) : null;
  const observedAt = observedAtParsed && Number.isFinite(observedAtParsed.getTime()) ? observedAtParsed : new Date();
  const tempC = toNum(r.temp ?? r.tempC ?? r.temperature) ?? parseMetarTempFromRaw(rawText);
  const dewpointC = toNum(r.dewp ?? r.dewpoint ?? r.dewpointC);
  const windSpeedKt = toNum(r.wspd ?? r.wind_speed_kt);
  const windSpeedKmh = windSpeedKt != null ? windSpeedKt * 1.852 : toNum(r.wind_speed_kmh);
  const windDirectionDeg = toNum(r.wdir ?? r.wind_dir_degrees ?? r.wind_direction);
  const visibilityKm = toNum(r.visib ?? r.visibility_km);
  const cloudCoverPct = toNum(r.skyCover) ?? parseAviationCloudPct(rawText);
  if (tempC == null && dewpointC == null && windSpeedKmh == null && visibilityKm == null && !rawText) return null;
  return { observedAt, tempC, dewpointC, windSpeedKmh, windDirectionDeg, visibilityKm, cloudCoverPct, rawText };
}

function parseAviationTaf(row: unknown): AviationTafPoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const issuedAt = r.issueTime ? new Date(String(r.issueTime)) : (r.issue_time ? new Date(String(r.issue_time)) : null);
  const validFrom = r.validTimeFrom ? new Date(String(r.validTimeFrom)) : (r.valid_time_from ? new Date(String(r.valid_time_from)) : null);
  const validTo = r.validTimeTo ? new Date(String(r.validTimeTo)) : (r.valid_time_to ? new Date(String(r.valid_time_to)) : null);
  const rawText = typeof r.rawTAF === 'string' ? r.rawTAF : (typeof r.raw_text === 'string' ? r.raw_text : undefined);
  const parsed = parseTafText(rawText);
  return {
    issuedAt: issuedAt && Number.isFinite(issuedAt.getTime()) ? issuedAt : null,
    validFrom: validFrom && Number.isFinite(validFrom.getTime()) ? validFrom : null,
    validTo: validTo && Number.isFinite(validTo.getTime()) ? validTo : null,
    rawText,
    parsed
  };
}

function parseWindToken(token: string): { windDirectionDeg?: number | null; windSpeedKt?: number | null; gustKt?: number | null } | null {
  const m = token.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/);
  if (!m) return null;
  const dir = m[1] === 'VRB' ? null : Number(m[1]);
  const speedRaw = Number(m[2]);
  const gustRaw = m[4] ? Number(m[4]) : null;
  // Convert MPS to KT when needed.
  const factor = m[5] === 'MPS' ? 1.94384 : 1;
  return {
    windDirectionDeg: dir,
    windSpeedKt: Number.isFinite(speedRaw) ? speedRaw * factor : null,
    gustKt: gustRaw != null ? gustRaw * factor : null
  };
}

function isWeatherCode(token: string) {
  return /^[-+]?([A-Z]{2})+$/.test(token) && /RA|SN|DZ|TS|SH|FG|BR|HZ|SQ|GR|GS/.test(token);
}

function isCloudCode(token: string) {
  return /^(FEW|SCT|BKN|OVC|VV)\d{3}/.test(token);
}

function buildTafSegment(type: 'BASE' | 'FM' | 'TEMPO' | 'BECMG' | 'PROB', marker: string | undefined, tokens: string[]): ParsedTafSegment {
  let windDirectionDeg: number | null | undefined;
  let windSpeedKt: number | null | undefined;
  let gustKt: number | null | undefined;
  let visibility: string | null = null;
  const weatherCodes: string[] = [];
  const cloudCodes: string[] = [];
  for (const t of tokens) {
    const wind = parseWindToken(t);
    if (wind) {
      windDirectionDeg = wind.windDirectionDeg;
      windSpeedKt = wind.windSpeedKt;
      gustKt = wind.gustKt;
      continue;
    }
    if (/^\d{4}$/.test(t) || t === '9999' || /^\d{1,2}SM$/.test(t)) {
      visibility = t;
      continue;
    }
    if (isWeatherCode(t)) weatherCodes.push(t);
    if (isCloudCode(t)) cloudCodes.push(t);
  }
  return { type, marker, windDirectionDeg, windSpeedKt, gustKt, visibility, weatherCodes, cloudCodes };
}

function parseTafText(rawText?: string): AviationTafPoint['parsed'] | undefined {
  if (!rawText) return undefined;
  const clean = rawText.replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ');
  if (!tokens.length) return undefined;

  const station = tokens[1] && /^[A-Z]{4}$/.test(tokens[1]) ? tokens[1] : undefined;
  const validityToken = tokens.find((t) => /^\d{4}\/\d{4}$/.test(t));
  const validity = validityToken
    ? {
        fromDay: Number(validityToken.slice(0, 2)),
        fromHour: Number(validityToken.slice(2, 4)),
        toDay: Number(validityToken.slice(5, 7)),
        toHour: Number(validityToken.slice(7, 9))
      }
    : undefined;

  const markerIdx: Array<{ idx: number; type: 'FM' | 'TEMPO' | 'BECMG' | 'PROB'; marker: string }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (/^FM\d{6}$/.test(t)) markerIdx.push({ idx: i, type: 'FM', marker: t });
    else if (t === 'TEMPO') markerIdx.push({ idx: i, type: 'TEMPO', marker: t });
    else if (t === 'BECMG') markerIdx.push({ idx: i, type: 'BECMG', marker: t });
    else if (/^PROB\d{2}$/.test(t)) markerIdx.push({ idx: i, type: 'PROB', marker: t });
  }

  const baseStart = Math.max(tokens.findIndex((t) => /^\d{4}\/\d{4}$/.test(t)) + 1, 0);
  const segments: ParsedTafSegment[] = [];
  if (!markerIdx.length) {
    segments.push(buildTafSegment('BASE', undefined, tokens.slice(baseStart)));
  } else {
    segments.push(buildTafSegment('BASE', undefined, tokens.slice(baseStart, markerIdx[0].idx)));
    for (let i = 0; i < markerIdx.length; i += 1) {
      const cur = markerIdx[i];
      const next = markerIdx[i + 1];
      const segTokens = tokens.slice(cur.idx + 1, next ? next.idx : tokens.length);
      segments.push(buildTafSegment(cur.type, cur.marker, segTokens));
    }
  }

  const next3hRisk = (() => {
    const joined = segments.map((s) => [...s.weatherCodes, ...s.cloudCodes].join(' ')).join(' ');
    const precipLike = /RA|SN|DZ|SH|FZ/.test(joined);
    const convectiveLike = /TS|SQ|GR|GS/.test(joined);
    const lowCeilingLike = /BKN00|OVC00|VV00|BKN0|OVC0|VV0/.test(joined);
    const strongestSignal = convectiveLike ? 'CONVECTIVE' : precipLike ? 'PRECIP' : lowCeilingLike ? 'LOW_CEILING' : null;
    return { precipLike, convectiveLike, lowCeilingLike, strongestSignal };
  })();

  return { station, validity, segments, next3hRisk };
}

async function fetchAviationMetarTaf(timeoutMs: number): Promise<{ metar: AviationMetarPoint | null; taf: AviationTafPoint | null }> {
  const station = RESOLUTION_STATION.stationCode;
  const base = process.env.AVIATIONWEATHER_API_BASE?.trim() || 'https://aviationweather.gov/api/data';
  const metarUrl = `${base.replace(/\/+$/, '')}/metar?ids=${encodeURIComponent(station)}&format=json`;
  const tafUrl = `${base.replace(/\/+$/, '')}/taf?ids=${encodeURIComponent(station)}&format=json`;
  const [metarRes, tafRes] = await Promise.allSettled([
    fetchJsonWithCurlFallback(metarUrl, timeoutMs),
    fetchJsonWithCurlFallback(tafUrl, timeoutMs)
  ]);
  if (metarRes.status === 'rejected' && tafRes.status === 'rejected') {
    const mr = metarRes.reason instanceof Error ? metarRes.reason.message : String(metarRes.reason);
    const tr = tafRes.reason instanceof Error ? tafRes.reason.message : String(tafRes.reason);
    throw new Error(`METAR/TAF 均失败：METAR=${mr} | TAF=${tr}`);
  }
  const metarPayload = metarRes.status === 'fulfilled' ? metarRes.value : null;
  const tafPayload = tafRes.status === 'fulfilled' ? tafRes.value : null;
  const metar = Array.isArray(metarPayload) ? parseAviationMetar(metarPayload[0]) : parseAviationMetar(metarPayload);
  const taf = Array.isArray(tafPayload) ? parseAviationTaf(tafPayload[0]) : parseAviationTaf(tafPayload);
  return { metar, taf };
}

async function fetchWttrJson(timeoutMs: number) {
  const unwrapWttrPayload = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return payload;
    const maybe = payload as { data?: unknown };
    return maybe.data && typeof maybe.data === 'object' ? maybe.data : payload;
  };
  const hasUsableDaily = (payload: unknown) => {
    const unwrapped = unwrapWttrPayload(payload);
    if (!unwrapped || typeof unwrapped !== 'object') return false;
    const weather = (unwrapped as { weather?: Array<{ hourly?: unknown[]; maxtempC?: string }> }).weather;
    if (!Array.isArray(weather) || weather.length === 0) return false;
    return weather.some((d) => {
      const hasHourly = Array.isArray(d?.hourly) && d.hourly.length > 0;
      const dailyMax = Number(d?.maxtempC);
      return hasHourly || Number.isFinite(dailyMax);
    });
  };
  const urls = [
    `https://wttr.in/${RESOLUTION_STATION.stationCode}?format=j1`,
    `https://wttr.in/~${RESOLUTION_STATION.latitude},${RESOLUTION_STATION.longitude}?format=j1`,
    `https://wttr.in/${RESOLUTION_STATION.latitude},${RESOLUTION_STATION.longitude}?format=j1`,
    'https://wttr.in/Shanghai?format=j1'
  ];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const payload = await fetchJsonWithCurlFallback(url, timeoutMs);
      const normalized = unwrapWttrPayload(payload);
      if (hasUsableDaily(normalized)) return normalized;
      const keys = normalized && typeof normalized === 'object' ? Object.keys(normalized as Record<string, unknown>).slice(0, 8).join(',') : typeof normalized;
      const sample = JSON.stringify(normalized).slice(0, 120);
      errors.push(`${url} -> 返回成功但无逐小时/日最高温数据 keys=[${keys}] sample=${sample}`);
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      const suggestion = await parseWttrSuggestedLocation(url, timeoutMs);
      if (suggestion) {
        const suggestedUrl = `https://wttr.in/${suggestion}?format=j1`;
        try {
          const payload = await fetchJsonWithCurlFallback(suggestedUrl, timeoutMs);
          const normalized = unwrapWttrPayload(payload);
          if (hasUsableDaily(normalized)) return normalized;
          const keys = normalized && typeof normalized === 'object' ? Object.keys(normalized as Record<string, unknown>).slice(0, 8).join(',') : typeof normalized;
          const sample = JSON.stringify(normalized).slice(0, 120);
          errors.push(`${suggestedUrl} -> 返回成功但无逐小时/日最高温数据 keys=[${keys}] sample=${sample}`);
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

function parseWeatherApiDailyMax(payload: z.infer<typeof weatherApiSchema>, targetDateKey: string): {
  value: number | null;
  matchedDate: string | null;
  availableDates: string[];
  field: 'maxtemp_c';
} {
  const availableDates = (payload.forecast?.forecastday ?? []).map((d) => d.date);
  for (const d of payload.forecast?.forecastday ?? []) {
    if (d.date !== targetDateKey) continue;
    const val = Number(d.day.maxtemp_c);
    if (Number.isFinite(val)) {
      return { value: val, matchedDate: d.date, availableDates, field: 'maxtemp_c' };
    }
  }
  return { value: null, matchedDate: null, availableDates, field: 'maxtemp_c' };
}

function parseQWeatherDailyMax(payload: z.infer<typeof qWeatherSchema>, targetDateKey: string): number | null {
  for (const d of payload.daily ?? []) {
    if (d.fxDate !== targetDateKey) continue;
    const val = Number(d.tempMax);
    if (Number.isFinite(val)) return val;
  }
  return null;
}

function parseWttrDailyMax(input: z.infer<typeof wttrSchema>, targetDateKey: string): number | null {
  for (const d of input.weather ?? []) {
    if (d.date !== targetDateKey) continue;
    const v = Number(d.maxtempC);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

async function buildAssistFromTargetDay(
  openMeteoRows: HourlyPoint[],
  openMeteoDailyMaxInput: number | null,
  nwsRows: HourlyPoint[],
  wttrRows: HourlyPoint[],
  wttrDailyMaxInput: number | null,
  metNoRows: HourlyPoint[],
  targetDateKey: string,
  rawMeta: Record<string, unknown>,
  weatherApiDailyMax: number | null,
  qWeatherDailyMax: number | null,
  wuNowcasting: WundergroundNowcasting | null,
  wuDailyMax: number | null,
  wuPeakWindow: { startHour: number; endHour: number; medianHour: number; sampleDays: number; method: string } | null,
  aviationMetar: AviationMetarPoint | null,
  aviationTaf: AviationTafPoint | null,
  sourceUpdatedAt: {
    nwsUpdatedAt?: string | null;
    metNoUpdatedAt?: string | null;
    weatherApiUpdatedAt?: string | null;
    qWeatherUpdatedAt?: string | null;
  },
  marketId?: string
): Promise<WeatherAssist> {
  const openMeteoTarget = filterByDateKey(openMeteoRows, targetDateKey);
  const nwsTarget = filterByDateKey(nwsRows, targetDateKey);
  const wttrTarget = filterByDateKey(wttrRows, targetDateKey);
  const metTarget = filterByDateKey(metNoRows, targetDateKey);

  if (!openMeteoTarget.length && !nwsTarget.length && !wttrTarget.length && !metTarget.length && weatherApiDailyMax == null && qWeatherDailyMax == null && wuDailyMax == null) {
    throw new Error(`天气源中未找到目标日(${targetDateKey})逐小时预测`);
  }

  const mergedRows = mergeAllRows(openMeteoTarget, nwsTarget, wttrTarget, metTarget);
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

  const precipitationProxy = Math.max(peak.precip, (peak.rainProb ?? 0) / 100);
  const nowcasting = buildNowcastingContext(openMeteoRows, nwsRows, wttrRows, metNoRows, targetDateKey, wuNowcasting, aviationMetar, aviationTaf);
  const rowDailyMaxRaw = mergedRows.length ? Math.max(...mergedRows.map((r) => r.temp)) : (wuDailyMax ?? weatherApiDailyMax ?? qWeatherDailyMax ?? peak.temp);
  const wuDailyMaxInt = toResolutionInt(wuDailyMax);
  const openMeteoDailyMaxRaw = openMeteoTarget.length ? Math.max(...openMeteoTarget.map((r) => r.temp)) : openMeteoDailyMaxInput;
  const nwsDailyMaxRaw = nwsTarget.length ? Math.max(...nwsTarget.map((r) => r.temp)) : null;
  const wttrDailyMaxRaw = wttrTarget.length ? Math.max(...wttrTarget.map((r) => r.temp)) : wttrDailyMaxInput;
  const metNoDailyMaxRaw = metTarget.length ? Math.max(...metTarget.map((r) => r.temp)) : null;
  const openMeteoDailyMax = toResolutionInt(openMeteoDailyMaxRaw);
  const nwsDailyMax = toResolutionInt(nwsDailyMaxRaw);
  const wttrDailyMax = toResolutionInt(wttrDailyMaxRaw);
  const metNoDailyMax = toResolutionInt(metNoDailyMaxRaw);
  const weatherApiDailyMaxInt = toResolutionInt(weatherApiDailyMax);
  const qWeatherDailyMaxInt = toResolutionInt(qWeatherDailyMax);
  const rowDailyMax = toResolutionInt(rowDailyMaxRaw) ?? 0;

  const fusionExcluded = fusionExcludedSourcesFromEnv();
  const nowTs = Date.now();
  const sourceAgeHours = {
    wunderground_daily: estimateSourceAgeHours(wuNowcasting?.observedAt ?? null, nowTs),
    open_meteo: nearestRowAgeHours(openMeteoRows, nowTs),
    nws_hourly: estimateSourceAgeHours(sourceUpdatedAt.nwsUpdatedAt, nowTs),
    wttr: nearestRowAgeHours(wttrRows, nowTs),
    met_no: estimateSourceAgeHours(sourceUpdatedAt.metNoUpdatedAt ?? (metNoRows[0]?.time ?? null), nowTs),
    weatherapi: estimateSourceAgeHours(sourceUpdatedAt.weatherApiUpdatedAt, nowTs),
    qweather: estimateSourceAgeHours(sourceUpdatedAt.qWeatherUpdatedAt, nowTs)
  };
  const sourceHealth = marketId
    ? Object.fromEntries(await Promise.all([
      computeSourceHealth(marketId, 'wunderground_daily', rawMeta.wundergroundDaily as string | null | undefined, sourceAgeHours.wunderground_daily).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'open_meteo', rawMeta.openMeteo as string | null | undefined, sourceAgeHours.open_meteo).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'wttr', rawMeta.wttr as string | null | undefined, sourceAgeHours.wttr).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'met_no', rawMeta.metNo as string | null | undefined, sourceAgeHours.met_no).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'weatherapi', rawMeta.weatherapi as string | null | undefined, sourceAgeHours.weatherapi).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'qweather', rawMeta.qweather as string | null | undefined, sourceAgeHours.qweather).then((x) => [x.sourceCode, x]),
      computeSourceHealth(marketId, 'nws_hourly', rawMeta.nwsHourly as string | null | undefined, sourceAgeHours.nws_hourly).then((x) => [x.sourceCode, x])
    ]))
    : {};

  const fusionSources = [
    wuDailyMax != null ? {
      sourceName: 'wunderground_daily',
      rawPredictedMaxTemp: wuDailyMax,
      stationType: 'exact_station' as const,
      explicitResolutionStation: true,
      sourceKind: classifySourceKind('wunderground_daily'),
      forecastAgeHours: sourceAgeHours.wunderground_daily,
      healthStatus: sourceHealth.wunderground_daily?.status
    } : null,
    openMeteoDailyMaxRaw != null ? {
      sourceName: 'open_meteo',
      rawPredictedMaxTemp: openMeteoDailyMaxRaw,
      stationType: 'region_grid' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('open_meteo'),
      forecastAgeHours: sourceAgeHours.open_meteo,
      healthStatus: sourceHealth.open_meteo?.status
    } : null,
    nwsDailyMaxRaw != null ? {
      sourceName: 'nws_hourly',
      rawPredictedMaxTemp: nwsDailyMaxRaw,
      stationType: 'east_china_grid' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('nws_hourly'),
      forecastAgeHours: sourceAgeHours.nws_hourly,
      healthStatus: sourceHealth.nws_hourly?.status
    } : null,
    wttrDailyMaxRaw != null ? {
      sourceName: 'wttr',
      rawPredictedMaxTemp: wttrDailyMaxRaw,
      stationType: 'city_level' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('wttr'),
      forecastAgeHours: sourceAgeHours.wttr,
      healthStatus: sourceHealth.wttr?.status
    } : null,
    metNoDailyMaxRaw != null ? {
      sourceName: 'met_no',
      rawPredictedMaxTemp: metNoDailyMaxRaw,
      stationType: 'region_grid' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('met_no'),
      forecastAgeHours: sourceAgeHours.met_no,
      healthStatus: sourceHealth.met_no?.status
    } : null,
    weatherApiDailyMax != null ? {
      sourceName: 'weatherapi',
      rawPredictedMaxTemp: weatherApiDailyMax,
      stationType: 'city_level' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('weatherapi'),
      forecastAgeHours: sourceAgeHours.weatherapi,
      healthStatus: sourceHealth.weatherapi?.status
    } : null,
    qWeatherDailyMax != null ? {
      sourceName: 'qweather',
      rawPredictedMaxTemp: qWeatherDailyMax,
      stationType: 'city_level' as const,
      explicitResolutionStation: false,
      sourceKind: classifySourceKind('qweather'),
      forecastAgeHours: sourceAgeHours.qweather,
      healthStatus: sourceHealth.qweather?.status
    } : null
  ]
    .filter((x): x is NonNullable<typeof x> => x != null)
    .map((x): WeatherSourceInput => x)
    .filter((x) => !fusionExcluded.has(x.sourceName.toLowerCase()));
  const calibrations = await loadFusionCalibrations({
    scenarioTag: nowcasting.scenarioTag,
    nowHourLocal: hourOf(new Date()),
    isTargetDateToday: toDateKey(new Date()) === targetDateKey
  });
  const fusionOutput =
    fusionSources.length >= 2
      ? runFusionEngine({
          sources: fusionSources,
          calibrations,
          resolutionContext: {
            cityName: 'Shanghai',
            resolutionStationName: RESOLUTION_STATION.stationName,
            resolutionSourceName: 'Wunderground',
            precision: 'integer_celsius'
          },
          scenarioContext: {
            currentTemp: nowcasting.currentTemp,
            tempRise1h: nowcasting.tempRise1h,
            tempRise2h: nowcasting.tempRise2h,
            cloudCover: nowcasting.cloudCover,
            precipitationProb: nowcasting.precipitationProb,
            windSpeed: nowcasting.windSpeed,
            nowHourLocal: hourOf(new Date()),
            isTargetDateToday: toDateKey(new Date()) === targetDateKey,
            peakWindowStartHour: wuPeakWindow?.startHour,
            peakWindowEndHour: wuPeakWindow?.endHour,
            scenarioTag: nowcasting.scenarioTag
          }
        })
      : null;
  const medianFallback = mergeMedian([
    wuDailyMaxInt ?? undefined,
    openMeteoDailyMax ?? undefined,
    nwsDailyMax ?? undefined,
    wttrDailyMax ?? undefined,
    metNoDailyMax ?? undefined,
    weatherApiDailyMaxInt ?? undefined,
    qWeatherDailyMaxInt ?? undefined
  ]);
  const fusedRaw = fusionOutput?.fusedTemp ?? (medianFallback > 0 ? medianFallback : rowDailyMax);
  const dailyMaxContinuous = Number(fusedRaw.toFixed(2));
  const dailyMaxAnchor = maxAwareSettlementAnchor(dailyMaxContinuous);
  const dailyMax = dailyMaxAnchor;
  const sourceSpread = spreadOf([wuDailyMaxInt, nwsDailyMax, wttrDailyMax, metNoDailyMax, weatherApiDailyMaxInt, qWeatherDailyMaxInt]);
  const confidence =
    sourceSpread == null ? 'low' : sourceSpread <= 1 ? 'high' : sourceSpread <= 2.5 ? 'medium' : 'low';
  const zhSourceList = [
    `Wunderground ${wuDailyMaxInt ?? '-'}°C`,
    `Open-Meteo(ECMWF IFS) ${openMeteoDailyMax ?? '-'}°C`,
    nwsDailyMax != null ? `NWS(hourly) ${nwsDailyMax}°C` : null,
    `wttr ${wttrDailyMax ?? '-'}°C`,
    `met.no ${metNoDailyMax ?? '-'}°C`,
    `WeatherAPI ${weatherApiDailyMaxInt ?? '-'}°C`,
    `QWeather ${qWeatherDailyMaxInt ?? '-'}°C`
  ].filter((x): x is string => Boolean(x)).join(' / ');
  const enSourceList = [
    `Wunderground ${wuDailyMaxInt ?? '-'}°C`,
    `Open-Meteo(ECMWF IFS) ${openMeteoDailyMax ?? '-'}°C`,
    nwsDailyMax != null ? `NWS(hourly) ${nwsDailyMax}°C` : null,
    `wttr ${wttrDailyMax ?? '-'}°C`,
    `met.no ${metNoDailyMax ?? '-'}°C`,
    `WeatherAPI ${weatherApiDailyMaxInt ?? '-'}°C`,
    `QWeather ${qWeatherDailyMaxInt ?? '-'}°C`
  ].filter((x): x is string => Boolean(x)).join(' / ');

  return {
    observedAt: nowcasting.observedAt,
    temperature2m: nowcasting.currentTemp,
    humidity: nowcasting.humidity,
    cloudCover: nowcasting.cloudCover,
    precipitation: nowcasting.precipitationProb / 100,
    windSpeed: nowcasting.windSpeed,
    temp1hAgo: nowcasting.temp1hAgo,
    temp2hAgo: nowcasting.temp2hAgo,
    temp3hAgo: nowcasting.temp3hAgo,
    tempRise1h: nowcasting.tempRise1h,
    tempRise2h: nowcasting.tempRise2h,
    tempRise3h: nowcasting.tempRise3h,
    maxTempSoFar: nowcasting.todayMaxTemp,
    raw: {
      ...rawMeta,
      nowcasting,
      aviation: {
        metar: aviationMetar,
        taf: aviationTaf
      },
      learnedPeakWindow: wuPeakWindow,
      peakHourLocal: hourOf(peak.time),
      dailyMaxForecast: dailyMax,
      dailyMaxForecastContinuous: dailyMaxContinuous,
      dailyMaxForecastAnchor: dailyMaxAnchor,
      dailyMinForecast: mergedRows.length ? Math.min(...mergedRows.map((r) => r.temp)) : null,
      sourceDailyMax: {
        wundergroundDaily: wuDailyMaxInt,
        openMeteo: openMeteoDailyMax,
        nwsHourly: nwsDailyMax,
        wttr: wttrDailyMax,
        metNo: metNoDailyMax,
        weatherApi: weatherApiDailyMaxInt,
        qWeather: qWeatherDailyMaxInt,
        cmaChina: qWeatherDailyMaxInt,
        fused: dailyMax,
        fusedContinuous: dailyMaxContinuous,
        fusedAnchor: dailyMaxAnchor,
        spread: sourceSpread
      },
      sourcePolicy: {
        sourceKind: {
          wunderground_daily: 'settlement',
          weather_com: 'settlement',
          aviationweather: 'observation',
          open_meteo: 'forecast',
          weatherapi: 'forecast',
          met_no: 'forecast',
          qweather: 'forecast',
          wttr: 'guidance',
          nws_hourly: 'forecast'
        },
        baseSourceWeight: {
          settlement: 1.4,
          observation: 1.3,
          forecast: 1.0,
          guidance: 0.8
        }
      },
      sourceHealth: sourceHealth,
      forecastExplain: {
        method: fusionOutput ? 'weighted_fusion' : 'median_of_sources',
        confidence,
        weightBreakdown: fusionOutput
          ? fusionOutput.sourceBreakdown.map((s) => ({
              source: s.sourceName,
              sourceKind: s.sourceKind,
              raw: Number(s.rawPredictedMaxTemp.toFixed(2)),
              adjusted: Number(s.adjustedPredictedMaxTemp.toFixed(2)),
              weight: Number((s.finalWeight * 100).toFixed(2)),
              baseSourceWeight: s.baseSourceWeight ?? 1,
              matchScore: s.matchScore,
              accuracyScore: s.accuracyScore,
              scenarioScore: s.scenarioScore,
              regimeScore: s.regimeScore ?? 1,
              freshnessScore: s.freshnessScore ?? 1,
              healthScore: s.healthScore ?? 1,
              healthStatus: s.healthStatus ?? 'healthy'
            }))
          : [],
        outcomeProbabilities: fusionOutput
          ? fusionOutput.outcomeProbabilities.map((o) => ({
              label: o.label,
              probability: Number(o.probability.toFixed(6))
            }))
          : [],
        zh: fusionOutput
          ? `目标日最高温采用加权融合：${zhSourceList}，连续融合值 ${dailyMaxContinuous}°C，结算锚点 ${dailyMaxAnchor}°C。源间分歧 ${sourceSpread?.toFixed(1) ?? '-'}°C，置信度 ${confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'}。${fusionOutput.explanation}`
          : `目标日最高温由多源日高温预测融合得到：${zhSourceList}，连续融合值 ${dailyMaxContinuous}°C，结算锚点 ${dailyMaxAnchor}°C。源间分歧 ${sourceSpread?.toFixed(1) ?? '-'}°C，置信度 ${confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'}。`,
        en: fusionOutput
          ? `Target-day max temperature uses weighted fusion: ${enSourceList}, fused continuous value ${dailyMaxContinuous}°C and settlement anchor ${dailyMaxAnchor}°C. Cross-source spread ${sourceSpread?.toFixed(1) ?? '-'}°C, confidence ${confidence}. ${fusionOutput.explanation}`
          : `Target-day max temperature is fused from multiple source daily highs: ${enSourceList}. Continuous fused value is ${dailyMaxContinuous}°C with settlement anchor ${dailyMaxAnchor}°C. Cross-source spread is ${sourceSpread?.toFixed(1) ?? '-'}°C, confidence is ${confidence}.`
      }
    }
  };
}

type CalibrationLoadContext = {
  scenarioTag?: 'stable_sunny' | 'suppressed_heating' | 'neutral';
  nowHourLocal: number;
  isTargetDateToday: boolean;
};

type BiasRowLite = {
  sourceCode: string;
  bias: number;
  absError: number;
  predictedMax: number;
  finalMax: number;
  capturedAt: Date;
  snapshot: { weatherFeaturesJson: string } | null;
};

function toDayPart(hour: number) {
  if (hour < 12) return 'morning';
  if (hour < 15.5) return 'midday';
  return 'late';
}

function inferScenarioTagFromWeatherJson(weatherFeaturesJson: string | null | undefined): 'stable_sunny' | 'suppressed_heating' | 'neutral' {
  if (!weatherFeaturesJson) return 'neutral';
  try {
    const parsed = JSON.parse(weatherFeaturesJson) as {
      nowcasting?: {
        scenarioTag?: 'stable_sunny' | 'suppressed_heating' | 'neutral';
        cloudCover?: number;
        precipitationProb?: number;
        tempRise1h?: number;
      };
    };
    if (parsed?.nowcasting?.scenarioTag) return parsed.nowcasting.scenarioTag;
    const cloud = Number(parsed?.nowcasting?.cloudCover ?? 0);
    const rain = Number(parsed?.nowcasting?.precipitationProb ?? 0);
    const rise = Number(parsed?.nowcasting?.tempRise1h ?? 0);
    if (cloud < 40 && rain < 20 && rise > 0) return 'stable_sunny';
    if (cloud > 70 || rain > 40 || rise <= 0) return 'suppressed_heating';
    return 'neutral';
  } catch {
    return 'neutral';
  }
}

function aggregateCalibration(rows: BiasRowLite[]) {
  const bySource = new Map<string, {
    sourceName: string;
    sampleSize: number;
    biasSum: number;
    absSum: number;
    exactCount: number;
    within1Count: number;
  }>();

  for (const row of rows) {
    const bucket = bySource.get(row.sourceCode) ?? {
      sourceName: row.sourceCode,
      sampleSize: 0,
      biasSum: 0,
      absSum: 0,
      exactCount: 0,
      within1Count: 0
    };
    bucket.sampleSize += 1;
    bucket.biasSum += row.bias;
    bucket.absSum += row.absError;
    const p = Math.round(row.predictedMax);
    const f = Math.round(row.finalMax);
    if (p === f) bucket.exactCount += 1;
    if (Math.abs(p - f) <= 1) bucket.within1Count += 1;
    bySource.set(row.sourceCode, bucket);
  }

  const out = new Map<string, HistoricalCalibration>();
  for (const item of bySource.values()) {
    out.set(item.sourceName, {
      sourceName: item.sourceName,
      sampleSize: item.sampleSize,
      bias: item.sampleSize ? item.biasSum / item.sampleSize : 0,
      mae: item.sampleSize ? item.absSum / item.sampleSize : 1.5,
      exactHitRate: item.sampleSize ? item.exactCount / item.sampleSize : 0,
      within1CHitRate: item.sampleSize ? item.within1Count / item.sampleSize : 0
    });
  }
  return out;
}

async function loadFusionCalibrations(ctx: CalibrationLoadContext): Promise<HistoricalCalibration[]> {
  const enableFusionCalibration = (process.env.ENABLE_FUSION_CALIBRATION ?? 'false').toLowerCase() === 'true';
  if (!enableFusionCalibration) return [];
  let prisma: unknown = null;
  try {
    const mod = await import('@/lib/db');
    prisma = mod.prisma;
  } catch {
    return [];
  }
  const prismaClient = prisma as {
    forecastSourceBias: {
      findMany: (args: unknown) => Promise<unknown[]>;
    };
  };
  const lookbackDays = Number(process.env.FUSION_CALIBRATION_LOOKBACK_DAYS ?? '60');
  const minBucketSamples = Number(process.env.FUSION_CALIBRATION_BUCKET_MIN_SAMPLES ?? '6');
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await prismaClient.forecastSourceBias.findMany({
    where: { capturedAt: { gte: since } },
    select: {
      sourceCode: true,
      bias: true,
      absError: true,
      predictedMax: true,
      finalMax: true,
      capturedAt: true,
      snapshot: { select: { weatherFeaturesJson: true } }
    }
  });
  if (!rows.length) return [];

  const global = aggregateCalibration(rows as BiasRowLite[]);
  const targetDayPart = ctx.isTargetDateToday ? toDayPart(ctx.nowHourLocal) : 'morning';
  const targetScenario = ctx.scenarioTag ?? 'neutral';
  const bucketRows = (rows as BiasRowLite[]).filter((r) => {
    const scenario = inferScenarioTagFromWeatherJson(r.snapshot?.weatherFeaturesJson);
    const dayPart = toDayPart(hourOf(r.capturedAt));
    return scenario === targetScenario && dayPart === targetDayPart;
  });
  const scenarioRows = (rows as BiasRowLite[]).filter((r) => {
    const scenario = inferScenarioTagFromWeatherJson(r.snapshot?.weatherFeaturesJson);
    return scenario === targetScenario;
  });
  const bucket = aggregateCalibration(bucketRows);
  const scenarioOnly = aggregateCalibration(scenarioRows);

  const allSources = new Set<string>([
    ...global.keys(),
    ...bucket.keys(),
    ...scenarioOnly.keys()
  ]);

  return [...allSources].map((sourceName) => {
    const bucketCal = bucket.get(sourceName);
    if (bucketCal && bucketCal.sampleSize >= minBucketSamples) return bucketCal;
    const scenarioCal = scenarioOnly.get(sourceName);
    if (scenarioCal && scenarioCal.sampleSize >= minBucketSamples) return scenarioCal;
    return global.get(sourceName) ?? {
      sourceName,
      sampleSize: 0,
      bias: 0,
      mae: 1.5,
      exactHitRate: 0,
      within1CHitRate: 0
    };
  });
}

function toResolutionInt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function maxAwareSettlementAnchor(value: number) {
  const threshold = Number(process.env.MAX_TEMP_UPSHIFT_THRESHOLD ?? '0.35');
  const floor = Math.floor(value);
  const frac = value - floor;
  return frac >= threshold ? floor + 1 : floor;
}

function parseNwsWindSpeedKmh(raw?: string) {
  if (!raw) return 0;
  const nums = (raw.match(/(\d+(?:\.\d+)?)/g) ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (!nums.length) return 0;
  const mph = Math.max(...nums);
  return mph * 1.60934;
}

function parseNwsWindDirection(raw?: string) {
  if (!raw) return undefined;
  const map: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5
  };
  return map[raw.toUpperCase()];
}

function toNwsRows(input: z.infer<typeof nwsHourlySchema>): HourlyPoint[] {
  const rows: HourlyPoint[] = [];
  for (const p of input.properties.periods) {
    const tRaw = p.temperature;
    if (!Number.isFinite(tRaw)) continue;
    const unit = (p.temperatureUnit ?? '').toUpperCase();
    const tempC = unit === 'F' ? ((Number(tRaw) - 32) * 5) / 9 : Number(tRaw);
    const rainProb = p.probabilityOfPrecipitation?.value ?? undefined;
    const humidity = p.relativeHumidity?.value ?? undefined;
    const skyCover = p.skyCover?.value ?? undefined;
    const text = p.shortForecast?.toLowerCase() ?? '';
    rows.push({
      time: new Date(p.startTime),
      temp: tempC,
      cloud: Number.isFinite(skyCover) ? Number(skyCover) : (text.includes('cloud') ? 70 : 35),
      precip: (Number.isFinite(rainProb) ? Number(rainProb) : 0) / 100,
      wind: parseNwsWindSpeedKmh(p.windSpeed),
      windDirection: parseNwsWindDirection(p.windDirection),
      humidity: Number.isFinite(humidity) ? Number(humidity) : 65,
      rainProb: Number.isFinite(rainProb) ? Number(rainProb) : undefined
    });
  }
  rows.sort((a, b) => a.time.getTime() - b.time.getTime());
  return rows;
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

function toOpenMeteoRows(input: z.infer<typeof openMeteoSchema>): HourlyPoint[] {
  const t = input.hourly.time ?? [];
  const temp = input.hourly.temperature_2m ?? [];
  const cloud = input.hourly.cloud_cover ?? [];
  const precip = input.hourly.precipitation ?? [];
  const rainProb = input.hourly.precipitation_probability ?? [];
  const wind = input.hourly.wind_speed_10m ?? [];
  const wdir = input.hourly.wind_direction_10m ?? [];
  const rh = input.hourly.relative_humidity_2m ?? [];
  const len = Math.min(t.length, temp.length);
  const rows: HourlyPoint[] = [];
  for (let i = 0; i < len; i += 1) {
    const when = new Date(t[i]);
    const tt = temp[i];
    if (!Number.isFinite(when.getTime()) || !Number.isFinite(tt)) continue;
    rows.push({
      time: when,
      temp: Number(tt),
      cloud: Number.isFinite(cloud[i] ?? NaN) ? Number(cloud[i]) : 0,
      precip: Number.isFinite(precip[i] ?? NaN) ? Number(precip[i]) : 0,
      wind: Number.isFinite(wind[i] ?? NaN) ? Number(wind[i]) : 0,
      windDirection: Number.isFinite(wdir[i] ?? NaN) ? Number(wdir[i]) : undefined,
      humidity: Number.isFinite(rh[i] ?? NaN) ? Number(rh[i]) : 0,
      rainProb: Number.isFinite(rainProb[i] ?? NaN) ? Number(rainProb[i]) : undefined
    });
  }
  rows.sort((a, b) => a.time.getTime() - b.time.getTime());
  return rows;
}

function parseOpenMeteoDailyMax(input: z.infer<typeof openMeteoSchema>, targetDateKey: string): number | null {
  const dates = input.daily?.time ?? [];
  const vals = input.daily?.temperature_2m_max ?? [];
  const len = Math.min(dates.length, vals.length);
  for (let i = 0; i < len; i += 1) {
    if (dates[i] !== targetDateKey) continue;
    const v = vals[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}


function filterByDateKey(rows: HourlyPoint[], key: string) {
  return rows.filter((r) => toDateKey(r.time) === key);
}

function mergeAllRows(primaryRows: HourlyPoint[], secondaryRows: HourlyPoint[], wttrRows: HourlyPoint[], metRows: HourlyPoint[]): HourlyPoint[] {
  const hours = new Set<number>();
  for (const r of primaryRows) hours.add(hourOf(r.time));
  for (const r of secondaryRows) hours.add(hourOf(r.time));
  for (const r of wttrRows) hours.add(hourOf(r.time));
  for (const r of metRows) hours.add(hourOf(r.time));

  return [...hours]
    .map((h) => mergeHourPoint(primaryRows, secondaryRows, wttrRows, metRows, h))
    .filter((x): x is HourlyPoint => Boolean(x))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
}

function mergeHourPoint(primaryRows: HourlyPoint[], secondaryRows: HourlyPoint[], wttrRows: HourlyPoint[], metRows: HourlyPoint[], hour: number): HourlyPoint | null {
  const o = pickHour(primaryRows, hour);
  const s = pickHour(secondaryRows, hour);
  const w = pickHour(wttrRows, hour);
  const m = pickHour(metRows, hour);
  if (!o && !s && !w && !m) return null;

  const baseTime = o?.time ?? s?.time ?? w?.time ?? m?.time ?? new Date();
  return {
    time: baseTime,
    temp: mergeMedian([o?.temp, s?.temp, w?.temp, m?.temp]),
    cloud: mergeMedian([o?.cloud, s?.cloud, w?.cloud, m?.cloud]),
    precip: mergeMedian([o?.precip, s?.precip, w?.precip, m?.precip]),
    wind: mergeMedian([o?.wind, s?.wind, w?.wind, m?.wind]),
    windDirection: mergeMedian([o?.windDirection, s?.windDirection, w?.windDirection, m?.windDirection]),
    humidity: mergeMedian([o?.humidity, s?.humidity, w?.humidity, m?.humidity]),
    rainProb: mergeMedian([o?.rainProb, s?.rainProb, w?.rainProb, m?.rainProb])
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

function estimateSourceAgeHours(updatedAt: string | Date | null | undefined, nowTs: number) {
  if (!updatedAt) return 0;
  const ts = typeof updatedAt === 'string' ? new Date(updatedAt).getTime() : updatedAt.getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, (nowTs - ts) / 3600000);
}

function nearestRowAgeHours(rows: HourlyPoint[], nowTs: number) {
  if (!rows.length) return 0;
  const nearest = rows.reduce((best, row) => {
    const diff = Math.abs(row.time.getTime() - nowTs);
    if (!best || diff < best.diff) return { diff, row };
    return best;
  }, null as { diff: number; row: HourlyPoint } | null);
  if (!nearest) return 0;
  return Math.max(0, nearest.diff / 3600000);
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
  openMeteoRows: HourlyPoint[],
  nwsRows: HourlyPoint[],
  wttrRows: HourlyPoint[],
  metRows: HourlyPoint[],
  targetDateKey: string,
  wuNowcasting: WundergroundNowcasting | null,
  aviationMetar: AviationMetarPoint | null,
  aviationTaf: AviationTafPoint | null
) {
  const now = new Date();
  const nowHour = hourOf(now);
  const todayKey = toDateKey(now);
  const openMeteoToday = filterByDateKey(openMeteoRows, todayKey);
  const nwsToday = filterByDateKey(nwsRows, todayKey);
  const wttrToday = filterByDateKey(wttrRows, todayKey);
  const metToday = filterByDateKey(metRows, todayKey);
  const todayMerged = mergeAllRows(openMeteoToday, nwsToday, wttrToday, metToday);
  const targetMerged = mergeAllRows(
    filterByDateKey(openMeteoRows, targetDateKey),
    filterByDateKey(nwsRows, targetDateKey),
    filterByDateKey(wttrRows, targetDateKey),
    filterByDateKey(metRows, targetDateKey)
  );
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

  const fallbackFuture = [1, 2, 3, 4, 5, 6].map((offset) => {
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
  const future = (wuNowcasting?.futureHours?.length ? wuNowcasting.futureHours.slice(0, 6).map((x) => ({
    hourOffset: x.hourOffset,
    temp: x.temp ?? current.temp,
    cloudCover: x.cloudCover ?? current.cloud,
    precipitationProb: x.precipitationProb ?? precipitationProb,
    windSpeed: x.windSpeed ?? current.wind,
    windDirection: x.windDirection ?? current.windDirection ?? null
  })) : fallbackFuture);

  const currentTemp = wuNowcasting?.currentTemp ?? aviationMetar?.tempC ?? current.temp;
  const todayMaxTemp = wuNowcasting?.todayMaxTemp ?? (upToNow.length ? Math.max(...upToNow.map((r) => r.temp)) : currentTemp);
  const cloudCover = wuNowcasting?.cloudCover ?? aviationMetar?.cloudCoverPct ?? current.cloud;
  const windSpeed = wuNowcasting?.windSpeed ?? aviationMetar?.windSpeedKmh ?? current.wind;
  const windDirection = wuNowcasting?.windDirection ?? aviationMetar?.windDirectionDeg ?? current.windDirection ?? null;
  const humidity = wuNowcasting?.humidity ?? current.humidity;
  const tempRise1h = currentTemp - prev1.temp;
  const tempRise2h = currentTemp - prev2.temp;
  const tempRise3h = currentTemp - prev3.temp;

  const regime = classifyWeatherRegime({
    cloudCover,
    precipitationProb,
    windSpeed,
    windDirection,
    tempRise1h,
    tafRisk: aviationTaf?.parsed?.next3hRisk ?? null
  });
  const scenarioTag: 'stable_sunny' | 'suppressed_heating' | 'neutral' = regime.scenarioTag;

  let maturity = 45;
  if (nowHour >= 11 && nowHour <= 16) maturity += 20;
  else if (nowHour >= 8 && nowHour <= 18) maturity += 10;
  if (tempRise2h > 0.5) maturity += 12;
  if (cloudCover > 70) maturity -= 12;
  if (precipitationProb > 40) maturity -= 18;
  const availableSourceCount = [wuNowcasting != null, aviationMetar != null, openMeteoToday.length > 0, nwsToday.length > 0, wttrToday.length > 0, metToday.length > 0].filter(Boolean).length;
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
    ,
    regime
  };
}
