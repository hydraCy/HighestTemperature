import cron from 'node-cron';
import { syncMarket5m, syncModel5m, syncWeather10m, syncAllNow, syncSettledDaily } from '@/lib/services/refresh-service';

async function run(name: string, fn: () => Promise<unknown>) {
  try {
    console.log(`[job] ${name} start ${new Date().toISOString()}`);
    await fn();
    console.log(`[job] ${name} done`);
  } catch (e) {
    console.error(`[job] ${name} failed`, e);
  }
}

cron.schedule('*/5 * * * *', () => run('market-5m', syncMarket5m));
cron.schedule('*/10 * * * *', () => run('weather-10m', syncWeather10m));
cron.schedule('*/5 * * * *', () => run('model-5m', syncModel5m));
cron.schedule('10 1 * * *', () => run('settled-daily', syncSettledDaily));

console.log('Shanghai decision cron started');
run('bootstrap', syncAllNow);
