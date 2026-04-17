import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { getTradingRunConfig } from '@/src/infrastructure/repositories/trading-config-repository';
import { refreshMarketUseCase } from '@/src/application/usecases/refresh-market';
import { refreshWeatherUseCase } from '@/src/application/usecases/refresh-weather';
import { runModelAndDecisionUseCase } from '@/src/application/usecases/run-model-and-decision';
import { syncSettledResultsUseCase } from '@/src/application/usecases/sync-settled-results';

export async function runFullRefreshUseCase(request?: PipelineRequest) {
  const { totalCapital, maxSingleTradePercent } = getTradingRunConfig();
  await refreshMarketUseCase(request);
  await refreshWeatherUseCase(request);
  const result = await runModelAndDecisionUseCase(totalCapital, maxSingleTradePercent, request);
  await syncSettledResultsUseCase();
  return result;
}
