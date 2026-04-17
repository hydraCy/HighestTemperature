import test from 'node:test';
import assert from 'node:assert/strict';
import { runProbabilityEngine } from '@/src/lib/probability-engine';

test('stage1 acceptance: observed floor and continuous upper bound must hard-constrain distribution', () => {
  const result = runProbabilityEngine({
    mu: 13,
    sigma: 1.4,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 12,
    maxContinuous: 14,
    binLabels: ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C']
  });
  const bin = result.debugSummary.binProbabilities;
  assert.equal(bin['<=11°C'], 0);
  assert.equal(bin['15°C'], 0);
  assert.equal(bin['>=16°C'], 0);
  assert.ok((bin['12°C'] ?? 0) > 0);
  assert.ok((bin['13°C'] ?? 0) > 0);
  assert.ok((bin['14°C'] ?? 0) > 0);
  assert.equal(result.debugSummary.L, 12);
  assert.equal(result.debugSummary.U, 14);
});

test('stage1 narrow interval: lower=13.9 and upper=14.0 should concentrate mass in 14', () => {
  const result = runProbabilityEngine({
    mu: 14,
    sigma: 1.2,
    minTemp: 10,
    maxTemp: 18,
    minContinuous: 13.9,
    maxContinuous: 14.0,
    binLabels: ['13°C', '14°C', '15°C']
  });
  const p14 = result.debugSummary.integerProbabilities['14'] ?? 0;
  assert.ok(p14 > 0.98);
  assert.ok(Object.values(result.debugSummary.integerProbabilities).every((x) => Number.isFinite(x) && x >= 0));
});

test('L/U invariant should be valid for normal bounds', () => {
  const result = runProbabilityEngine({
    mu: 13,
    sigma: 1.2,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 12,
    maxContinuous: 14,
    minAllowedInteger: 12,
    maxAllowedInteger: 14,
    binLabels: ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C']
  });
  assert.equal(result.debugSummary.luInvariant.isValid, true);
  assert.equal(result.debugSummary.luInvariant.issues.length, 0);
});

test('L/U invariant should report inverted continuous bounds', () => {
  const result = runProbabilityEngine({
    mu: 13,
    sigma: 1.2,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 14.2,
    maxContinuous: 13.8,
    binLabels: ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C']
  });
  assert.equal(result.debugSummary.luInvariant.isValid, false);
  assert.ok(result.debugSummary.luInvariant.issues.includes('continuous_bounds_inverted'));
});

