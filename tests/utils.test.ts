import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { normalizeProbabilities } from '@/lib/utils/probability';

test('bin parsing works', () => {
  const p = parseTemperatureBin('31-32C');
  assert.equal(p.min, 31);
  assert.equal(p.max, 32);
});

test('probabilities normalize to 1', () => {
  const probs = normalizeProbabilities([1, 3, 6]);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
