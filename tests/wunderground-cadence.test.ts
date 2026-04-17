import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWundergroundFreshnessThresholdMinutes,
  minutesUntilNextWundergroundUpdate
} from '@/src/lib/weather/wunderground-cadence';

test('minutesUntilNextWundergroundUpdate follows 05/15/... cadence', () => {
  assert.equal(minutesUntilNextWundergroundUpdate(new Date('2026-03-22T10:04:00+08:00')), 1);
  assert.equal(minutesUntilNextWundergroundUpdate(new Date('2026-03-22T10:05:00+08:00')), 10);
  assert.equal(minutesUntilNextWundergroundUpdate(new Date('2026-03-22T10:56:00+08:00')), 9);
});

test('calculateWundergroundFreshnessThresholdMinutes prefers cadence over broad stale cap', () => {
  const threshold = calculateWundergroundFreshnessThresholdMinutes({
    observedAt: new Date('2026-03-22T10:55:00+08:00'),
    cadenceGraceMinutes: 4,
    fallbackMaxStaleMinutes: 15
  });
  assert.equal(threshold, 14);
});
