import type { ScenarioContext, StationType } from '@/src/lib/fusion-engine/types';

function inRange(v: number, lo: number, hi: number) {
  return v >= lo && v <= hi;
}

export function regimeScoreForSource(
  sourceName: string,
  stationType: StationType,
  scenario: ScenarioContext
) {
  const hour = scenario.nowHourLocal;
  const isToday = Boolean(scenario.isTargetDateToday);
  const peakEnd = Number.isFinite(scenario.peakWindowEndHour) ? Number(scenario.peakWindowEndHour) : 16;
  const nearPeak = hour >= peakEnd - 2 && hour <= peakEnd + 1;
  const preNoon = inRange(hour, 0, 12);

  let score = 1;

  if (!isToday) {
    if (stationType === 'exact_station') score *= 1.08;
    if (stationType === 'grid_point') score *= 0.95;
    return score;
  }

  if (nearPeak) {
    if (sourceName === 'wunderground_daily') score *= 1.18;
    if (stationType === 'exact_station') score *= 1.12;
    if (stationType === 'grid_point') score *= 0.88;
  } else if (preNoon) {
    if (stationType === 'grid_point') score *= 1.06;
    if (sourceName === 'wunderground_daily') score *= 0.96;
  } else {
    if (stationType === 'exact_station') score *= 1.05;
  }

  if (scenario.scenarioTag === 'suppressed_heating') {
    // In suppressed-heating setups, city/grid sources tend to overreact intraday.
    if (stationType !== 'exact_station') score *= 0.92;
  }

  return score;
}

