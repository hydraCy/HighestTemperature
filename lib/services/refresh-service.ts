import { runFullRefresh, refreshMarketData, refreshWeatherData, runModelAndDecision, syncSettledResults } from '@/lib/services/trading-pipeline';

export async function syncMarket5m() {
  return refreshMarketData();
}

export async function syncWeather10m() {
  return refreshWeatherData();
}

export async function syncModel5m() {
  return runModelAndDecision();
}

export async function syncAllNow() {
  return runFullRefresh();
}

export async function syncSettledDaily() {
  return syncSettledResults();
}
