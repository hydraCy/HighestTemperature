import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WU_URL = 'https://www.wunderground.com/history/daily/cn/shanghai/ZSPD';
const WEATHER_API_TEST_URL = (apiKey: string) =>
  `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=31.1443,121.8083&units=m&language=en-US&format=json&apiKey=${encodeURIComponent(apiKey)}`;

type CurlResult = {
  statusCode: number | null;
  body: string;
  raw: string;
  error?: string;
};

function parseHttp(raw: string): CurlResult {
  const matches = [...raw.matchAll(/^HTTP\/[0-9.]+\s+(\d{3})/gm)];
  const statusCode = matches.length ? Number(matches[matches.length - 1][1]) : null;
  const bodyStart = raw.lastIndexOf('\r\n\r\n');
  if (bodyStart >= 0) {
    return { statusCode, body: raw.slice(bodyStart + 4), raw };
  }
  const bodyStartLf = raw.lastIndexOf('\n\n');
  if (bodyStartLf >= 0) {
    return { statusCode, body: raw.slice(bodyStartLf + 2), raw };
  }
  return { statusCode, body: raw, raw };
}

async function curlGet(url: string): Promise<CurlResult> {
  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-sS',
        '-L',
        '-i',
        '--max-time',
        '20',
        '-H',
        'User-Agent: Mozilla/5.0 (WU-ApiKey-Inspector)',
        '-H',
        'Accept: text/html,application/json,*/*',
        url
      ],
      { maxBuffer: 20 * 1024 * 1024, env: process.env }
    );
    return parseHttp(stdout);
  } catch (error) {
    return {
      statusCode: null,
      body: '',
      raw: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function extractApiKeys(html: string): string[] {
  const keys = new Set<string>();

  for (const m of html.matchAll(/apiKey=([a-zA-Z0-9]+)/g)) {
    keys.add(m[1]);
  }
  for (const m of html.matchAll(/"apiKey"\s*:\s*"([a-zA-Z0-9]+)"/g)) {
    keys.add(m[1]);
  }

  return [...keys];
}

function classifyBlocked(body: string, statusCode: number | null): 'page_blocked' | 'region_restricted' | null {
  const t = body.toLowerCase();
  if (statusCode === 403 && t.includes('no longer available in your area')) {
    return 'region_restricted';
  }
  if (statusCode === 403 || statusCode === 451 || t.includes('enable javascript') || t.includes('access denied')) {
    return 'page_blocked';
  }
  return null;
}

async function main() {
  console.log('=== WU API Key Inspect ===');
  console.log(`URL: ${WU_URL}`);

  const wuPage = await curlGet(WU_URL);
  if (wuPage.error) {
    console.log(`status code: -`);
    console.log(`request error: ${wuPage.error}`);
    process.exit(1);
  }

  console.log(`status code: ${wuPage.statusCode ?? '-'}`);
  console.log('response body (first 1KB):');
  console.log((wuPage.body || '').slice(0, 1024));

  const keys = extractApiKeys(wuPage.body || '');
  if (!keys.length) {
    const blockedType = classifyBlocked(wuPage.body || '', wuPage.statusCode);
    if (blockedType) {
      console.log(`extract result: ${blockedType}`);
    } else {
      console.log('extract result: no_apikey_found');
    }
    return;
  }

  console.log(`extract result: success (${keys.length} key${keys.length > 1 ? 's' : ''})`);
  const key = keys[0];
  console.log(`extracted key (masked): ${maskKey(key)}`);

  const apiTestUrl = WEATHER_API_TEST_URL(key);
  const apiRes = await curlGet(apiTestUrl);
  if (apiRes.error) {
    console.log(`api.weather.com status code: -`);
    console.log(`api.weather.com request error: ${apiRes.error}`);
    process.exit(1);
  }

  console.log(`api.weather.com status code: ${apiRes.statusCode ?? '-'}`);
  console.log('api.weather.com body (first 500 chars):');
  console.log((apiRes.body || '').slice(0, 500));
}

main().catch((error) => {
  console.error('inspect failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

