import 'dotenv/config';
import { fetchJsonWithCurlFallback } from '@/lib/utils/http-json';
import { fetchWundergroundSettledMaxTemp } from '@/lib/services/wunderground-settlement';

function shanghaiDateKey(date: Date) {
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

async function openMeteoDailyMax(dateKey: string) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=31.1443&longitude=121.8083` +
    `&start_date=${dateKey}&end_date=${dateKey}&hourly=temperature_2m&timezone=Asia%2FShanghai`;
  const j = (await fetchJsonWithCurlFallback(url, 15000)) as { hourly?: { temperature_2m?: number[] } };
  const arr = j.hourly?.temperature_2m ?? [];
  if (!arr.length) throw new Error('open-meteo archive no hourly data');
  return Math.max(...arr);
}

async function main() {
  const now = new Date();
  const rows: Array<{
    date: string;
    openMeteo?: number;
    wunderground?: number;
    diff?: number;
    error?: string;
  }> = [];

  for (let i = 1; i <= 10; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = shanghaiDateKey(d);
    try {
      const [om, wu] = await Promise.all([
        openMeteoDailyMax(key),
        fetchWundergroundSettledMaxTemp({
          targetDate: new Date(`${key}T12:00:00+08:00`),
          stationCode: 'ZSPD'
        }).then((x) => x.maxTempC)
      ]);
      rows.push({
        date: key,
        openMeteo: om,
        wunderground: wu,
        diff: Number((om - wu).toFixed(2))
      });
    } catch (error) {
      rows.push({
        date: key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const valid = rows.filter((r) => r.error == null && typeof r.diff === 'number');
  const bias =
    valid.length > 0
      ? valid.reduce((acc, r) => acc + (r.diff ?? 0), 0) / valid.length
      : null;
  const mae =
    valid.length > 0
      ? valid.reduce((acc, r) => acc + Math.abs(r.diff ?? 0), 0) / valid.length
      : null;

  console.log(
    JSON.stringify(
      {
        station: 'ZSPD',
        sampleSize: valid.length,
        bias,
        mae,
        rows
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

