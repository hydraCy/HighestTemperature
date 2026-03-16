import { NextResponse } from 'next/server';

const LAT = 31.1443;
const LON = 121.8083;

type OpenMeteoResp = {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
};

function nearestIndex(times: string[], now = new Date()): number {
  if (!times.length) return -1;
  const nowTs = now.getTime();
  let best = 0;
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const ts = new Date(times[i]).getTime();
    const d = Math.abs(ts - nowTs);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return best;
}

export async function GET() {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&hourly=temperature_2m,cloud_cover,precipitation_probability,wind_speed_10m,wind_direction_10m' +
    '&forecast_days=3&timezone=Asia%2FShanghai';

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, source: 'open_meteo', error: `status ${res.status}` }, { status: 502 });
    }
    const json = (await res.json()) as OpenMeteoResp;
    const times = json.hourly?.time ?? [];
    const temps = json.hourly?.temperature_2m ?? [];
    const clouds = json.hourly?.cloud_cover ?? [];
    const precip = json.hourly?.precipitation_probability ?? [];
    const wind = json.hourly?.wind_speed_10m ?? [];
    const windDir = json.hourly?.wind_direction_10m ?? [];

    const idx = nearestIndex(times);
    if (idx < 0 || idx >= temps.length || temps[idx] == null) {
      return NextResponse.json({ ok: false, source: 'open_meteo', error: 'no valid hourly temperature at current slot' }, { status: 502 });
    }

    const next6h = Array.from({ length: 6 }, (_, k) => idx + k)
      .filter((i) => i < times.length)
      .map((i) => ({
        time: times[i],
        temp: temps[i],
        cloud: clouds[i] ?? null,
        precipProb: precip[i] ?? null,
        windSpeed: wind[i] ?? null,
        windDirection: windDir[i] ?? null
      }));

    const dailyMaxTomorrow = (() => {
      const now = new Date();
      const tomorrow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      tomorrow.setDate(tomorrow.getDate() + 1);
      const y = tomorrow.getFullYear();
      const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const d = String(tomorrow.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      const vals = times
        .map((t, i) => ({ t, v: temps[i] }))
        .filter((x) => x.t.startsWith(key) && typeof x.v === 'number')
        .map((x) => Number(x.v));
      if (!vals.length) return null;
      return Math.max(...vals);
    })();

    return NextResponse.json({
      ok: true,
      source: 'open_meteo',
      station: 'ZSPD-proxy-grid',
      now: {
        time: times[idx],
        temp: temps[idx],
        cloud: clouds[idx] ?? null,
        precipProb: precip[idx] ?? null,
        windSpeed: wind[idx] ?? null,
        windDirection: windDir[idx] ?? null
      },
      next6h,
      tomorrowMax: dailyMaxTomorrow
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, source: 'open_meteo', error: error instanceof Error ? error.message : 'fetch failed' },
      { status: 502 }
    );
  }
}
