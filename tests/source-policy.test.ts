import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseSourceWeight,
  classifySourceKind,
  sourceFreshnessScore,
  sourceHealthScore,
  stationMatchScore
} from '@/src/lib/fusion-engine/sourcePolicy';

test('source policy: classification and base weights', () => {
  assert.equal(classifySourceKind('wunderground_daily'), 'settlement');
  assert.equal(classifySourceKind('aviationweather'), 'observation');
  assert.equal(classifySourceKind('wttr'), 'guidance');
  assert.equal(baseSourceWeight('settlement'), 1.4);
  assert.equal(baseSourceWeight('forecast'), 1.0);
});

test('source policy: station matching and freshness/health scores', () => {
  assert.equal(stationMatchScore('exact_station'), 1.0);
  assert.equal(stationMatchScore('city_level'), 0.85);
  assert.equal(stationMatchScore('region_grid'), 0.75);
  assert.equal(stationMatchScore('east_china_grid'), 0.6);
  assert.equal(sourceFreshnessScore(2), 1.0);
  assert.equal(sourceFreshnessScore(8), 0.75);
  assert.equal(sourceFreshnessScore(25), 0.3);
  assert.equal(sourceHealthScore('healthy'), 1);
  assert.equal(sourceHealthScore('degraded'), 0.4);
  assert.equal(sourceHealthScore('down'), 0);
});

