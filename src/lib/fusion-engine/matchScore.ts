import type { StationType } from '@/src/lib/fusion-engine/types';

export function matchScore(stationType: StationType) {
  if (stationType === 'exact_station') return 1;
  if (stationType === 'city_level') return 0.7;
  return 0.5;
}
