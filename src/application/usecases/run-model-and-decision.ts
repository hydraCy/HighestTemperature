import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { runModelAndDecision } from '@/src/infrastructure/gateways/pipeline-operations';

export async function runModelAndDecisionUseCase(
  totalCapital?: number,
  maxSingleTradePercent?: number,
  request?: PipelineRequest
) {
  return runModelAndDecision(totalCapital, maxSingleTradePercent, request);
}
