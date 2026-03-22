import 'dotenv/config';
import { refreshWuApiKey } from '@/lib/services/wu-apikey-refresh';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';

function pickArg(name: string) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

async function main() {
  const locationKey = (pickArg('location') as SupportedLocationKey | null) ?? 'shanghai';
  const force = process.argv.includes('--force');
  const cfg = getLocationConfig(locationKey);
  const stationCode = cfg.weather.stationCode;
  const stationPath = cfg.weather.wundergroundHistoryPath;

  const result = await refreshWuApiKey({
    stationCode,
    stationPath,
    latitude: cfg.lat,
    longitude: cfg.lon,
    persistEnv: true,
    force
  });

  console.log(JSON.stringify({ locationKey, force, stationCode, result }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

