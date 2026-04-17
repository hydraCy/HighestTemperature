import { syncSettledResults } from '@/src/infrastructure/gateways/pipeline-operations';

export async function syncSettledResultsUseCase() {
  return syncSettledResults();
}
