import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIntegerSettlementDistribution,
  buildSettlementDistributionDebugSummary,
  mapIntegerDistributionToBins,
  pickMostLikelyInteger
} from '@/src/lib/trading-engine/settlementMapping';
import { computeConstraintBounds } from '@/src/lib/trading-engine/constraints';

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

test('hard ceiling should zero out impossible higher integers', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 15.2,
    sigma: 1.2,
    minTemp: 10,
    maxTemp: 20,
    maxAllowedInteger: 15
  });
  const highMass = dist.filter((r) => r.temp > 15).reduce((s, r) => s + r.probability, 0);
  assert.equal(highMass, 0);
});

test('asymmetric sigma should reduce left-tail mass before peak', () => {
  const symmetric = buildIntegerSettlementDistribution({
    mean: 12,
    sigma: 1.6,
    minTemp: 8,
    maxTemp: 16
  });
  const asymmetric = buildIntegerSettlementDistribution({
    mean: 12,
    sigma: 1.6,
    sigmaBelowMean: 1.0,
    sigmaAboveMean: 2.0,
    minTemp: 8,
    maxTemp: 16
  });
  const symLeft = symmetric.filter((r) => r.temp <= 10).reduce((s, r) => s + r.probability, 0);
  const asymLeft = asymmetric.filter((r) => r.temp <= 10).reduce((s, r) => s + r.probability, 0);
  assert.ok(asymLeft < symLeft);
});

test('today constrained case should keep mass only in feasible integer buckets', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 13,
    sigma: 1.4,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: 12,
    maxContinuous: 14,
    minAllowedInteger: 12,
    maxAllowedInteger: 14
  });
  const probs = mapIntegerDistributionToBins(['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C'], dist);
  assert.equal(probs[0], 0);
  assert.equal(probs[4], 0);
  assert.equal(probs[5], 0);
  assert.ok(probs[1] > 0 && probs[2] > 0 && probs[3] > 0);
});

test('non-today without continuous bounds should behave like unconstrained normal mapping', () => {
  const unconstrained = buildIntegerSettlementDistribution({
    mean: 13,
    sigma: 1.3,
    minTemp: 8,
    maxTemp: 20
  });
  const wideBounds = buildIntegerSettlementDistribution({
    mean: 13,
    sigma: 1.3,
    minTemp: 8,
    maxTemp: 20,
    minContinuous: -100,
    maxContinuous: 100
  });
  const diff = unconstrained.reduce((acc, r, idx) => acc + Math.abs(r.probability - (wideBounds[idx]?.probability ?? 0)), 0);
  assert.ok(diff < 1e-6);
});

test('late session should use tighter integer ceiling when stricter than general upper bound', () => {
  const constraints = computeConstraintBounds({
    isTargetDateToday: true,
    nowHourLocal: 17.2,
    learnedPeakWindowStartHour: 10.5,
    learnedPeakWindowEndHour: 14.5,
    observedMaxTemp: 12,
    currentTemp: 13.2,
    futureTemps1To6h: [12.8, 12.7, 12.5],
    cloudCover: 20,
    windSpeed: 10
  });
  assert.equal(constraints.maxAllowedInteger, 13);
  assert.ok((constraints.maxContinuous ?? 0) > 13);
  assert.equal(constraints.debugSummary.continuousUpperSource, 'late_session_tightened');
});

test('extremely narrow continuous interval should concentrate almost all mass in 14C bucket', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 14,
    sigma: 1.4,
    minTemp: 10,
    maxTemp: 18,
    minContinuous: 13.9,
    maxContinuous: 14.0
  });
  const p14 = dist.find((r) => r.temp === 14)?.probability ?? 0;
  const sum = dist.reduce((acc, r) => acc + r.probability, 0);
  assert.ok(Number.isFinite(sum));
  assert.ok(Math.abs(sum - 1) < 1e-6);
  assert.ok(p14 > 0.98);
  assert.ok(dist.every((r) => Number.isFinite(r.probability) && r.probability >= 0));
});

test('reachability floor is diagnostics-only and does not hard-bind v1 probability engine', () => {
  const constraints = computeConstraintBounds({
    isTargetDateToday: true,
    nowHourLocal: 12.5,
    observedMaxTemp: 12,
    currentTemp: 12.2,
    futureTemps1To6h: [14.8, 14.4, 14.1],
    cloudCover: 45,
    windSpeed: 16
  });
  assert.equal(constraints.minAllowedInteger, 12);
  assert.equal(constraints.reachabilityFloorInteger, 14);
  assert.equal(constraints.debugSummary.reachabilityFloorAppliedInV1, false);
});

test('distribution debug summary should expose active integers and model tag', () => {
  const dist = buildIntegerSettlementDistribution({
    mean: 13,
    sigma: 1.1,
    minTemp: 10,
    maxTemp: 16,
    minContinuous: 12,
    maxContinuous: 14
  });
  const debug = buildSettlementDistributionDebugSummary({
    mean: 13,
    sigma: 1.1,
    sigmaBelowMean: 1.1,
    sigmaAboveMean: 1.1,
    minContinuous: 12,
    maxContinuous: 14,
    integerDistribution: dist
  });
  assert.equal(debug.model, 'truncated_normal_to_integer_rounding');
  assert.ok(debug.activeIntegers.every((t) => t >= 12 && t <= 14));
});
