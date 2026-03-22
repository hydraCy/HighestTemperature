import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { runFullRefresh, refreshMarketData, refreshWeatherData, runModelAndDecision, syncSettledResults } from '@/lib/services/trading-pipeline';

export async function syncMarket5m(request?: PipelineRequest) {
  return refreshMarketData(request);
}

export async function syncWeather10m(request?: PipelineRequest) {
  return refreshWeatherData(request);
}

export async function syncModel5m(request?: PipelineRequest) {
  return runModelAndDecision(undefined, undefined, request);
}

export async function syncAllNow(request?: PipelineRequest) {
  return runFullRefresh(request);
}

export async function syncSettledDaily() {
  return syncSettledResults();
}
