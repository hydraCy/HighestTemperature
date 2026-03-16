import type { StationType } from '@/src/lib/fusion-engine/types';
import { stationMatchScore } from '@/src/lib/fusion-engine/sourcePolicy';

export function matchScore(stationType: StationType) {
  return stationMatchScore(stationType);
}
