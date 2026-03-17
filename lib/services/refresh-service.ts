import { runFullRefresh, refreshMarketData, refreshWeatherData, runModelAndDecision, syncSettledResults } from '@/lib/services/trading-pipeline';

export async function syncMarket5m(targetDateKey?: string | null) {
  return refreshMarketData(targetDateKey);
}

export async function syncWeather10m(targetDateKey?: string | null) {
  return refreshWeatherData(targetDateKey);
}

export async function syncModel5m(targetDateKey?: string | null) {
  return runModelAndDecision(undefined, undefined, targetDateKey);
}

export async function syncAllNow(targetDateKey?: string | null) {
  return runFullRefresh(targetDateKey);
}

export async function syncSettledDaily() {
  return syncSettledResults();
}
