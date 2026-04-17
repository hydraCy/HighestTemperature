import type { PipelineRequest } from '@/lib/config/pipeline-request';
import {
  refreshMarketData as refreshMarketDataPipeline,
  refreshWeatherData as refreshWeatherDataPipeline,
  runModelAndDecision as runModelAndDecisionPipeline,
  syncSettledResults as syncSettledResultsPipeline
} from '@/lib/services/trading-pipeline';

export async function refreshMarketData(request?: PipelineRequest) {
  return refreshMarketDataPipeline(request);
}

export async function refreshWeatherData(request?: PipelineRequest) {
  return refreshWeatherDataPipeline(request);
}

export async function runModelAndDecision(
  totalCapital?: number,
  maxSingleTradePercent?: number,
  request?: PipelineRequest
) {
  return runModelAndDecisionPipeline(totalCapital, maxSingleTradePercent, request);
}

export async function syncSettledResults() {
  return syncSettledResultsPipeline();
}
