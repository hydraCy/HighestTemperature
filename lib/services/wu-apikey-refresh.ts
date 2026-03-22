import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchJsonWithCurlFallback, fetchTextWithCurlOnly } from '@/lib/utils/http-json';

type RefreshWuApiKeyOptions = {
  stationCode?: string;
  stationPath?: string;
  latitude?: number;
  longitude?: number;
  persistEnv?: boolean;
  force?: boolean;
  envPath?: string;
};

export type RefreshWuApiKeyResult = {
  ok: boolean;
  updated: boolean;
  selectedKeyMasked: string | null;
  selectedKeySource: 'env' | 'page' | null;
  tested: Array<{ source: 'env' | 'page'; masked: string; ok: boolean; reason?: string }>;
  reason?: string;
};

const DEFAULT_STATION_CODE = 'ZSPD';
const DEFAULT_STATION_PATH = 'cn/shanghai';
const DEFAULT_LAT = 31.1443;
const DEFAULT_LON = 121.8083;

function dateKeyShanghai(date: Date) {
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

function maskKey(key: string) {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function extractKeysFromHtml(html: string) {
  const keys = new Set<string>();
  for (const m of html.matchAll(/apiKey=([a-zA-Z0-9]+)/g)) keys.add(m[1]);
  for (const m of html.matchAll(/"apiKey"\s*:\s*"([a-zA-Z0-9]+)"/g)) keys.add(m[1]);
  return [...keys];
}

async function validateKey(apiKey: string, latitude: number, longitude: number) {
  const geocode = `${latitude},${longitude}`;
  const url = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const json = await fetchJsonWithCurlFallback(url, 12000);
    const obj = json as { validTimeLocal?: unknown; temperatureMax?: unknown; calendarDayTemperatureMax?: unknown };
    const hasDailyArray =
      (Array.isArray(obj.validTimeLocal) && obj.validTimeLocal.length > 0) ||
      (Array.isArray(obj.temperatureMax) && obj.temperatureMax.length > 0) ||
      (Array.isArray(obj.calendarDayTemperatureMax) && obj.calendarDayTemperatureMax.length > 0);
    if (!hasDailyArray) return { ok: false, reason: 'daily payload missing expected arrays' };
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

function updateEnvKeyFile(filePath: string, key: string) {
  const resolved = resolve(filePath);
  const line = `WUNDERGROUND_API_KEY=${key}`;
  if (!existsSync(resolved)) {
    writeFileSync(resolved, `${line}\n`, 'utf8');
    return;
  }
  const text = readFileSync(resolved, 'utf8');
  if (/^WUNDERGROUND_API_KEY=.*$/m.test(text)) {
    const replaced = text.replace(/^WUNDERGROUND_API_KEY=.*$/m, line);
    writeFileSync(resolved, replaced, 'utf8');
    return;
  }
  const suffix = text.endsWith('\n') ? '' : '\n';
  writeFileSync(resolved, `${text}${suffix}${line}\n`, 'utf8');
}

export async function refreshWuApiKey(options: RefreshWuApiKeyOptions = {}): Promise<RefreshWuApiKeyResult> {
  const stationCode = options.stationCode ?? DEFAULT_STATION_CODE;
  const stationPath = options.stationPath ?? DEFAULT_STATION_PATH;
  const latitude = options.latitude ?? DEFAULT_LAT;
  const longitude = options.longitude ?? DEFAULT_LON;
  const persistEnv = options.persistEnv ?? true;
  const force = options.force ?? false;
  const envPath = options.envPath ?? '.env';

  const current = process.env.WUNDERGROUND_API_KEY?.trim();
  const tested: RefreshWuApiKeyResult['tested'] = [];

  if (current && !force) {
    const check = await validateKey(current, latitude, longitude);
    tested.push({ source: 'env', masked: maskKey(current), ok: check.ok, reason: check.ok ? undefined : check.reason });
    if (check.ok) {
      return {
        ok: true,
        updated: false,
        selectedKeyMasked: maskKey(current),
        selectedKeySource: 'env',
        tested
      };
    }
  }

  const pageUrl = `https://www.wunderground.com/history/daily/${stationPath}/${stationCode}/date/${dateKeyShanghai(new Date())}`;
  let pageHtml = '';
  try {
    pageHtml = await fetchTextWithCurlOnly(pageUrl, 15000);
  } catch (error) {
    return {
      ok: false,
      updated: false,
      selectedKeyMasked: null,
      selectedKeySource: null,
      tested,
      reason: `fetch page failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const pageKeys = extractKeysFromHtml(pageHtml).filter((x) => x && x !== current);
  if (!pageKeys.length) {
    return {
      ok: false,
      updated: false,
      selectedKeyMasked: null,
      selectedKeySource: null,
      tested,
      reason: 'no apiKey found on page'
    };
  }

  for (const key of pageKeys) {
    const check = await validateKey(key, latitude, longitude);
    tested.push({ source: 'page', masked: maskKey(key), ok: check.ok, reason: check.ok ? undefined : check.reason });
    if (!check.ok) continue;

    process.env.WUNDERGROUND_API_KEY = key;
    if (persistEnv) updateEnvKeyFile(envPath, key);
    return {
      ok: true,
      updated: key !== current,
      selectedKeyMasked: maskKey(key),
      selectedKeySource: 'page',
      tested
    };
  }

  return {
    ok: false,
    updated: false,
    selectedKeyMasked: null,
    selectedKeySource: null,
    tested,
    reason: 'all extracted keys failed validation'
  };
}

