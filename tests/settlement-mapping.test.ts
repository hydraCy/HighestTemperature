import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIntegerSettlementDistribution,
  mapIntegerDistributionToBins,
  pickMostLikelyInteger
} from '@/src/lib/trading-engine/settlementMapping';

test('integer settlement mapping builds normalized distribution and maps to bins', () => {
  const dist = buildIntegerSettlementDistribution({ mean: 15.4, sigma: 1.2, minTemp: 10, maxTemp: 20 });
  const sum = dist.reduce((s, r) => s + r.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  const top = pickMostLikelyInteger(dist);
  assert.ok(top >= 14 && top <= 16);

  const probs = mapIntegerDistributionToBins(['<=11°C', '12°C', '13°C', '14°C', '15°C', '16°C', '>=17°C'], dist);
  const psum = probs.reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(psum - 1) < 1e-6);
  assert.ok(probs[4] > probs[2]); // 15°C bin should dominate 13°C around mean 15.4
});

test('observed max hard floor should zero out impossible lower integers', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 15.2,
    sigma: 1.2,
    minTemp: 10,
    maxTemp: 20,
    minAllowedInteger: 16
  });
  const lowMass = dist.filter((r) => r.temp < 16).reduce((s, r) => s + r.probability, 0);
  assert.equal(lowMass, 0);
});
