import 'dotenv/config';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';
import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { syncAllNow, syncMarket5m, syncModel5m, syncWeather10m, syncSettledDaily } from '@/lib/services/refresh-service';

function dateKeyAtTz(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

function plusDays(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T12:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return dateKeyAtTz(d, 'Asia/Shanghai');
}

async function runStartup(locationKey: SupportedLocationKey = 'shanghai') {
  const cfg = getLocationConfig(locationKey);
  const today = dateKeyAtTz(new Date(), cfg.timezone);
  const tomorrow = plusDays(today, 1);

  const targets: PipelineRequest[] = [
    { locationKey, targetDate: today },
    { locationKey, targetDate: tomorrow },
  ];

  for (const req of targets) {
    await syncMarket5m(req);
    await syncWeather10m(req);
    await syncModel5m(req);
  }
}

async function main() {
  const job = process.argv[2] ?? 'all';
  const locationArg = process.argv.find((x) => x.startsWith('--location='))?.split('=')[1] as SupportedLocationKey | undefined;
  const locationKey: SupportedLocationKey = (locationArg === 'hongkong' ? 'hongkong' : 'shanghai');
  if (job === 'market') await syncMarket5m();
  else if (job === 'weather') await syncWeather10m();
  else if (job === 'model') await syncModel5m();
  else if (job === 'settled') await syncSettledDaily();
  else if (job === 'startup') await runStartup(locationKey);
  else await syncAllNow();
  console.log('done:', job);
}

main();
