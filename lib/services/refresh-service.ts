import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { runFullRefreshUseCase } from '@/src/application/usecases/run-full-refresh';
import { refreshMarketUseCase } from '@/src/application/usecases/refresh-market';
import { refreshWeatherUseCase } from '@/src/application/usecases/refresh-weather';
import { runModelAndDecisionUseCase } from '@/src/application/usecases/run-model-and-decision';
import { syncSettledResultsUseCase } from '@/src/application/usecases/sync-settled-results';

export async function syncMarket5m(request?: PipelineRequest) {
  return refreshMarketUseCase(request);
}

export async function syncWeather10m(request?: PipelineRequest) {
  return refreshWeatherUseCase(request);
}

export async function syncModel5m(request?: PipelineRequest) {
  return runModelAndDecisionUseCase(undefined, undefined, request);
}

export async function syncAllNow(request?: PipelineRequest) {
  return runFullRefreshUseCase(request);
}

export async function syncSettledDaily() {
  return syncSettledResultsUseCase();
}
