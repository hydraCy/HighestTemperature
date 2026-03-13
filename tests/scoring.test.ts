import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEdge, edgeToScore } from '@/src/lib/trading-engine/edge';
import { calculateTimingScore } from '@/src/lib/trading-engine/timingScore';
import { calculateWeatherStabilityScore } from '@/src/lib/trading-engine/weatherScore';
import { calculateDataQualityScore } from '@/src/lib/trading-engine/dataQuality';

test('edge calculation', () => {
  const edge = calculateEdge(0.44, 0.31);
  assert.equal(edge.toFixed(2), '0.13');
  assert.equal(edgeToScore(edge), 85);
});

test('timing score window', () => {
  assert.equal(calculateTimingScore(10, 30), 20);
  assert.equal(calculateTimingScore(14, 0), 90);
  assert.equal(calculateTimingScore(16, 0), 70);
  assert.equal(calculateTimingScore(12, 30, { startHour: 12.5, endHour: 15 }), 90);
});

test('weather and data quality score', () => {
  const weather = calculateWeatherStabilityScore({ cloudCover: 80, precipitationProb: 50, tempRise1h: -0.1 });
  assert.ok(weather < 50);
  const dq = calculateDataQualityScore({ resolutionReady: true, weatherReady: false, marketReady: true, modelReady: true });
  assert.equal(dq, 40);
});
