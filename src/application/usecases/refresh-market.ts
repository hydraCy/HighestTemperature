import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { refreshMarketData } from '@/src/infrastructure/gateways/pipeline-operations';

export async function refreshMarketUseCase(request?: PipelineRequest) {
  return refreshMarketData(request);
}
