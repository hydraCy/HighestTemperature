import type { PipelineRequest } from '@/lib/config/pipeline-request';
import { refreshWeatherData } from '@/src/infrastructure/gateways/pipeline-operations';

export async function refreshWeatherUseCase(request?: PipelineRequest) {
  return refreshWeatherData(request);
}
