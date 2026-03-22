import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';

const execFileAsync = promisify(execFile);
const FALLBACK_WU_API_KEY = '5c241d89f91274015a577e3e17d43370';

type ProbeResult = {
  source: string;
  url: string;
  method: 'GET';
  httpStatus: number | null;
  parserKeys: string[];
  bodyPreview: string;
  failureCategory: 'auth_error' | 'http_error' | 'parse_error' | 'empty_payload' | 'config_missing' | null;
  ok: boolean;
  reason: string | null;
};

function maskUrlSecrets(url: string) {
  return url.replace(/([?&]apiKey=)[^&]+/gi, '$1***');
}

function dateKeyInTz(date: Date, timezone: string) {
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

function classifyFailure(reason: string) {
  const msg = reason.toLowerCase();
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth_error';
  if (msg.includes('invalid json') || msg.includes('unexpected token') || msg.includes('parse error') || msg.includes('response is not valid json')) return 'parse_error';
  if (msg.includes('empty') || msg.includes('no data') || msg === '{}' || msg.includes('sample={}')) return 'empty_payload';
  if (msg.includes('missing') || msg.includes('not configured') || msg.includes('未配置')) return 'config_missing';
  return 'http_error';
}

function parseHttpAndBody(raw: string) {
  const matches = [...raw.matchAll(/^HTTP\/[0-9.]+\s+(\d{3})/gm)];
  const httpStatus = matches.length ? Number(matches[matches.length - 1][1]) : null;
  const bodyStart = raw.lastIndexOf('\r\n\r\n');
  if (bodyStart >= 0) return { httpStatus, body: raw.slice(bodyStart + 4) };
  const bodyStartLf = raw.lastIndexOf('\n\n');
  if (bodyStartLf >= 0) return { httpStatus, body: raw.slice(bodyStartLf + 2) };
  return { httpStatus, body: raw };
}

async function curlProbe(url: string, accept: string): Promise<ProbeResult> {
  const maskedUrl = maskUrlSecrets(url);
  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-sS',
        '-L',
        '-i',
        '--max-time',
        '15',
        '-H',
        `Accept: ${accept}`,
        '-H',
        'User-Agent: Mozilla/5.0 (ShanghaiDecisionBot Diagnostics)',
        url
      ],
      { maxBuffer: 10 * 1024 * 1024, env: process.env }
    );
    const { httpStatus, body } = parseHttpAndBody(stdout);
    let parserKeys: string[] = [];
    let bodyPreview = body.slice(0, 500);
    let reason: string | null = null;
    let ok = httpStatus != null && httpStatus >= 200 && httpStatus < 300;
    let failureCategory: ProbeResult['failureCategory'] = null;

    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parserKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 20);
      }
      bodyPreview = JSON.stringify(parsed).slice(0, 500);
      if (ok && bodyPreview === '{}') {
        ok = false;
        reason = 'empty payload object';
        failureCategory = 'empty_payload';
      }
    } catch {
      // non-JSON body
      if (accept.includes('json') && ok) {
        ok = false;
        reason = 'response is not valid JSON';
        failureCategory = 'parse_error';
      }
    }

    if (!ok && !reason) {
      reason = `HTTP ${httpStatus ?? 'unknown'}`;
      failureCategory = classifyFailure(reason);
    }
    return {
      source: '',
      url: maskedUrl,
      method: 'GET',
      httpStatus,
      parserKeys,
      bodyPreview,
      failureCategory,
      ok,
      reason
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      source: '',
      url: maskedUrl,
      method: 'GET',
      httpStatus: null,
      parserKeys: [],
      bodyPreview: '',
      failureCategory: classifyFailure(reason),
      ok: false,
      reason
    };
  }
}

async function loadWundergroundApiKeys(stationCode: string, targetDateKey: string) {
  const keys = new Set<string>();
  if (process.env.WUNDERGROUND_API_KEY?.trim()) keys.add(process.env.WUNDERGROUND_API_KEY.trim());
  keys.add(FALLBACK_WU_API_KEY);
  const historyUrl = `https://www.wunderground.com/history/daily/cn/shanghai/${stationCode}/date/${targetDateKey}`;
  const pageProbe = await curlProbe(historyUrl, 'text/html');
  if (pageProbe.ok) {
    try {
      const { stdout } = await execFileAsync(
        'curl',
        [
          '-sS',
          '-L',
          '--max-time',
          '15',
          '-H',
          'Accept: text/html',
          '-H',
          'User-Agent: Mozilla/5.0 (ShanghaiDecisionBot Diagnostics)',
          historyUrl
        ],
        { maxBuffer: 10 * 1024 * 1024, env: process.env }
      );
      for (const m of stdout.matchAll(/apiKey=([a-zA-Z0-9]+)/g)) keys.add(m[1]);
    } catch {
      // keep existing keys only
    }
  }
  return { keys: [...keys], pageProbe };
}

function pickArg(name: string) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

async function main() {
  const locationKey = (pickArg('location') as SupportedLocationKey | null) ?? 'shanghai';
  const cfg = getLocationConfig(locationKey);
  const dateArg = pickArg('date');
  const targetDate = dateArg ? new Date(`${dateArg}T12:00:00+08:00`) : new Date();
  const targetDateKey = dateKeyInTz(targetDate, cfg.timezone);
  const todayKey = dateKeyInTz(new Date(), cfg.timezone);
  const ymdToday = todayKey.replaceAll('-', '');
  const geocode = `${cfg.lat},${cfg.lon}`;

  const results: ProbeResult[] = [];

  const { keys: wuKeys, pageProbe } = await loadWundergroundApiKeys(cfg.weather.stationCode, targetDateKey);
  results.push({ ...pageProbe, source: 'wunderground_page_key_extract' });

  for (const key of wuKeys.slice(0, 3)) {
    const currentUrl = `https://api.weather.com/v3/wx/observations/current?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${key}`;
    const dailyUrl = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${geocode}&units=m&language=en-US&format=json&apiKey=${key}`;
    const historyTodayUrl = `https://api.weather.com/v1/geocode/${cfg.lat}/${cfg.lon}/observations/historical.json?apiKey=${key}&units=m&startDate=${ymdToday}&endDate=${ymdToday}`;
    const currentProbe = await curlProbe(currentUrl, 'application/json');
    results.push({ ...currentProbe, source: `wunderground_nowcasting_api(key#${wuKeys.indexOf(key) + 1})` });
    const dailyProbe = await curlProbe(dailyUrl, 'application/json');
    results.push({ ...dailyProbe, source: `wunderground_daily_api(key#${wuKeys.indexOf(key) + 1})` });
    const historyProbe = await curlProbe(historyTodayUrl, 'application/json');
    results.push({ ...historyProbe, source: `wunderground_30d_api(key#${wuKeys.indexOf(key) + 1})` });
  }

  const wttrUrls = [
    `https://wttr.in/${cfg.weather.stationCode}?format=j1`,
    `https://wttr.in/~${cfg.lat},${cfg.lon}?format=j1`,
    `https://wttr.in/${cfg.lat},${cfg.lon}?format=j1`,
    `https://wttr.in/${encodeURIComponent(cfg.weather.wttrQuery)}?format=j1`
  ];
  for (const url of wttrUrls) {
    const probe = await curlProbe(url, 'application/json');
    const parserKeys = probe.parserKeys.join(',');
    const looksEmpty = probe.httpStatus === 200 && (probe.bodyPreview === '{}' || parserKeys.length === 0);
    results.push({
      ...probe,
      source: 'wttr',
      ok: probe.ok && !looksEmpty,
      failureCategory: looksEmpty ? 'empty_payload' : probe.failureCategory,
      reason: looksEmpty ? 'returned {} or no top-level keys' : probe.reason
    });
  }

  const grouped = results.reduce<Record<string, ProbeResult[]>>((acc, row) => {
    acc[row.source] = acc[row.source] ?? [];
    acc[row.source].push(row);
    return acc;
  }, {});

  const summary = Object.entries(grouped).map(([source, rows]) => {
    const okCount = rows.filter((r) => r.ok).length;
    const latest = rows[rows.length - 1];
    return {
      source,
      attempts: rows.length,
      okCount,
      status: okCount > 0 ? 'ok' : 'failed',
      lastHttp: latest.httpStatus,
      lastFailureCategory: latest.failureCategory,
      lastReason: latest.reason
    };
  });

  console.log(
    JSON.stringify(
      {
        meta: {
          locationKey,
          targetDate: targetDateKey,
          timezone: cfg.timezone,
          stationCode: cfg.weather.stationCode,
          lat: cfg.lat,
          lon: cfg.lon,
          proxy: {
            http_proxy: process.env.http_proxy ?? process.env.HTTP_PROXY ?? null,
            https_proxy: process.env.https_proxy ?? process.env.HTTPS_PROXY ?? null,
            all_proxy: process.env.all_proxy ?? process.env.ALL_PROXY ?? null
          }
        },
        summary,
        details: results
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
