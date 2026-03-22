import 'dotenv/config';
import cron from 'node-cron';
import { syncMarket5m, syncModel5m, syncWeather10m, syncAllNow, syncSettledDaily } from '@/lib/services/refresh-service';
import { refreshWuApiKey } from '@/lib/services/wu-apikey-refresh';
import { getLocationConfig } from '@/lib/config/locations';

async function run(name: string, fn: () => Promise<unknown>) {
  try {
    console.log(`[job] ${name} start ${new Date().toISOString()}`);
    await fn();
    console.log(`[job] ${name} done`);
  } catch (e) {
    console.error(`[job] ${name} failed`, e);
  }
}

async function runWuKeyRefresh() {
  const cfg = getLocationConfig('shanghai');
  const res = await refreshWuApiKey({
    stationCode: cfg.weather.stationCode,
    stationPath: cfg.weather.wundergroundHistoryPath,
    latitude: cfg.lat,
    longitude: cfg.lon,
    persistEnv: true,
    force: false
  });
  console.log(`[job] wu-key-refresh ${res.ok ? 'ok' : 'failed'} source=${res.selectedKeySource ?? '-'} key=${res.selectedKeyMasked ?? '-'} reason=${res.reason ?? '-'}`);
}

cron.schedule('*/5 * * * *', () => run('market-5m', syncMarket5m));
cron.schedule('*/10 * * * *', () => run('weather-10m', syncWeather10m));
cron.schedule('*/5 * * * *', () => run('model-5m', syncModel5m));
cron.schedule('10 1 * * *', () => run('settled-daily', syncSettledDaily));
cron.schedule('30 */6 * * *', () => run('wu-key-refresh', runWuKeyRefresh));

console.log('Shanghai decision cron started');
run('bootstrap', syncAllNow);
