import test from 'node:test';
import assert from 'node:assert/strict';
import { runFusionEngine } from '@/src/lib/fusion-engine/fuse';
import type { FusionInput } from '@/src/lib/fusion-engine/types';

test('fusion engine normalizes weights and outcome probabilities', () => {
  const input: FusionInput = {
    sources: [
      { sourceName: 'Open-Meteo', rawPredictedMaxTemp: 12.7, stationType: 'grid_point' },
      { sourceName: 'wttr', rawPredictedMaxTemp: 14, stationType: 'city_level' },
      { sourceName: 'met.no', rawPredictedMaxTemp: 14.3, stationType: 'grid_point' },
      { sourceName: 'WeatherAPI', rawPredictedMaxTemp: 14, stationType: 'city_level' },
      { sourceName: 'QWeather', rawPredictedMaxTemp: 13.8, stationType: 'exact_station' }
    ],
    calibrations: [
      { sourceName: 'Open-Meteo', sampleSize: 120, bias: -0.2, mae: 1.4, exactHitRate: 0.19, within1CHitRate: 0.62 },
      { sourceName: 'wttr', sampleSize: 100, bias: 0.1, mae: 1.2, exactHitRate: 0.23, within1CHitRate: 0.66 },
      { sourceName: 'met.no', sampleSize: 95, bias: 0.05, mae: 1.1, exactHitRate: 0.25, within1CHitRate: 0.69 },
      { sourceName: 'WeatherAPI', sampleSize: 80, bias: -0.05, mae: 0.95, exactHitRate: 0.31, within1CHitRate: 0.75 },
      { sourceName: 'QWeather', sampleSize: 60, bias: -0.1, mae: 1.0, exactHitRate: 0.29, within1CHitRate: 0.72 }
    ],
    resolutionContext: {
      cityName: 'Shanghai',
      resolutionStationName: 'Shanghai Pudong International Airport Station',
      resolutionSourceName: 'Wunderground',
      precision: 'integer_celsius'
    },
    scenarioContext: {
      currentTemp: 10.1,
      tempRise1h: 0.7,
      tempRise2h: 1.2,
      cloudCover: 35,
      precipitationProb: 10,
      windSpeed: 12,
      nowHourLocal: 22
    }
  };

  const out = runFusionEngine(input);
  const weightSum = out.sourceBreakdown.reduce((acc, x) => acc + x.finalWeight, 0);
  const probSum = out.outcomeProbabilities.reduce((acc, x) => acc + x.probability, 0);

  assert.ok(out.fusedTemp >= 10 && out.fusedTemp <= 25);
  assert.ok(out.fusedSigma >= 0.6);
  assert.ok(Math.abs(weightSum - 1) < 1e-4);
  assert.ok(Math.abs(probSum - 1) < 1e-6);
  assert.equal(out.outcomeProbabilities[0]?.label, '10°C');
  assert.equal(out.outcomeProbabilities.at(-1)?.label, '25°C');
  assert.ok(out.explanation.includes('融合结果'));
});

test('fusion engine applies time-regime weighting near peak window', () => {
  const baseInput: FusionInput = {
    sources: [
      { sourceName: 'wunderground_daily', rawPredictedMaxTemp: 15.8, stationType: 'exact_station' },
      { sourceName: 'open_meteo', rawPredictedMaxTemp: 14.2, stationType: 'grid_point' }
    ],
    calibrations: [
      { sourceName: 'wunderground_daily', sampleSize: 50, bias: 0, mae: 1.0, exactHitRate: 0.3, within1CHitRate: 0.7 },
      { sourceName: 'open_meteo', sampleSize: 50, bias: 0, mae: 1.0, exactHitRate: 0.3, within1CHitRate: 0.7 }
    ],
    resolutionContext: {
      cityName: 'Shanghai',
      resolutionStationName: 'Shanghai Pudong International Airport Station',
      resolutionSourceName: 'Wunderground',
      precision: 'integer_celsius'
    },
    scenarioContext: {
      currentTemp: 14,
      tempRise1h: 0.4,
      tempRise2h: 0.8,
      cloudCover: 30,
      precipitationProb: 5,
      windSpeed: 10,
      nowHourLocal: 15,
      isTargetDateToday: true,
      peakWindowEndHour: 16,
      scenarioTag: 'stable_sunny'
    }
  };

  const out = runFusionEngine(baseInput);
  const wu = out.sourceBreakdown.find((x) => x.sourceName === 'wunderground_daily');
  const om = out.sourceBreakdown.find((x) => x.sourceName === 'open_meteo');
  assert.ok(wu && om);
  assert.ok((wu?.regimeScore ?? 0) > (om?.regimeScore ?? 0));
});
