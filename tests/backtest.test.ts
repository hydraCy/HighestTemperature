import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import { runTradingDecision } from '@/src/lib/trading-engine/tradingEngine';

test('risk modifier and position sizing', () => {
  const rm = calculateRiskModifier({ cloudCover: 20, precipitationProb: 10, tempRise1h: 0.3 });
  assert.equal(rm, 1);
  const pos = calculatePositionSize({ totalCapital: 10000, maxSingleTradePercent: 0.1, edge: 0.1, riskModifier: rm });
  assert.equal(pos, 500);
});

test('trading decision output structure', () => {
  const out = runTradingDecision({
    now: new Date('2026-03-12T07:00:00Z'),
    currentTemp: 32.6,
    maxTempSoFar: 32.6,
    tempRise1h: 0.4,
    tempRise2h: 0.9,
    tempRise3h: 1.3,
    cloudCover: 32,
    precipitationProb: 10,
    windSpeed: 12,
    bins: [
      { label: '31-32C', marketPrice: 0.3 },
      { label: '32-33C', marketPrice: 0.27 },
      { label: '33C+', marketPrice: 0.16 }
    ],
    probabilities: [0.22, 0.55, 0.23],
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  assert.ok(['BUY', 'WATCH', 'PASS'].includes(out.decision));
  assert.ok(out.binOutputs.length === 3);
  assert.ok(out.tradeScore >= 0 && out.tradeScore <= 100);
});

test('settled market should force PASS and zero position', () => {
  const out = runTradingDecision({
    now: new Date('2026-03-12T13:00:00Z'),
    marketEndAt: new Date('2026-03-12T12:00:00Z'),
    marketActive: false,
    currentTemp: 33,
    maxTempSoFar: 33,
    tempRise1h: 0.2,
    tempRise2h: 0.5,
    tempRise3h: 1,
    cloudCover: 20,
    precipitationProb: 0,
    windSpeed: 10,
    bins: [
      { label: '33C', marketPrice: 0.3 },
      { label: '34C', marketPrice: 0.2 }
    ],
    probabilities: [0.6, 0.4],
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  assert.equal(out.decision, 'PASS');
  assert.equal(out.positionSize, 0);
  assert.ok(out.riskFlags.includes('market_settled') || out.riskFlags.includes('market_inactive'));
});
