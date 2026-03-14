import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBinProbabilities } from '@/src/lib/trading-engine/model';

test('flat next 1-3h forecast should suppress unrealistic high-tail bins', () => {
  const bins = ['13°C', '14°C', '15°C', '16°C', '17°C', '18°C', '>=19°C'];
  const probs = estimateBinProbabilities({
    bins,
    currentTemp: 15,
    maxTempSoFar: 15,
    observedMaxTemp: 15,
    forecastAnchorTemp: 15,
    isTargetDateToday: true,
    futureTemp1h: 15,
    futureTemp2h: 15,
    futureTemp3h: 15,
    tempRise1h: 3.4,
    tempRise2h: 4.0,
    tempRise3h: 4.0,
    cloudCover: 30,
    precipitationProb: 0,
    windSpeed: 26,
    sigma: 1.2
  });

  const byLabel = Object.fromEntries(bins.map((b, i) => [b, probs[i] ?? 0]));
  assert.ok((byLabel['15°C'] ?? 0) + (byLabel['16°C'] ?? 0) > 0.7);
  assert.ok((byLabel['18°C'] ?? 0) < 0.1);
  assert.ok((byLabel['>=19°C'] ?? 0) < 0.02);
});

