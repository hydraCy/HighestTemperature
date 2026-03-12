import { syncAllNow, syncMarket5m, syncModel5m, syncWeather10m, syncSettledDaily } from '@/lib/services/refresh-service';

async function main() {
  const job = process.argv[2] ?? 'all';
  if (job === 'market') await syncMarket5m();
  else if (job === 'weather') await syncWeather10m();
  else if (job === 'model') await syncModel5m();
  else if (job === 'settled') await syncSettledDaily();
  else await syncAllNow();
  console.log('done:', job);
}

main();
