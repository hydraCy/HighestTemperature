import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModelPanelForecast } from '@/lib/utils/model-panel';

test('model panel forecast must come only from sourceDailyMax', () => {
  const x = selectModelPanelForecast({
    fusedContinuous: 12.76,
    fusedAnchor: 13,
  });
  assert.equal(x.integer, 13);
  assert.equal(x.continuous, 12.76);
});

test('model panel forecast should not fallback when sourceDailyMax missing', () => {
  const x = selectModelPanelForecast(undefined);
  assert.equal(x.integer, null);
  assert.equal(x.continuous, null);
});

