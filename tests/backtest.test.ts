import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import { runTradingDecision } from '@/src/lib/trading-engine/tradingEngine';

test('risk modifier and position sizing', () => {
  const rm = calculateRiskModifier({ cloudCover: 20, precipitationProb: 10, tempRise1h: 0.3 });
  assert.equal(rm, 1);
  const pos = calculatePositionSize({
    totalCapital: 10000,
    maxSingleTradePercent: 0.1,
    edge: 0.1,
    sideProbability: 0.7,
    entryPrice: 0.5,
    riskModifier: rm
  });
  assert.equal(pos, 200);
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

test('late-session lock should avoid contrarian 13C NO recommendation', () => {
  const out = runTradingDecision({
    now: new Date('2026-03-13T08:00:00Z'), // 16:00 Asia/Shanghai
    targetDate: new Date('2026-03-13T00:00:00+08:00'),
    observedMaxTemp: 13,
    futureTemp1h: 13,
    futureTemp2h: 12,
    futureTemp3h: 10,
    currentTemp: 13,
    maxTempSoFar: 13,
    tempRise1h: 0.6,
    tempRise2h: 1.0,
    tempRise3h: 1.0,
    cloudCover: 30,
    precipitationProb: 0,
    windSpeed: 18,
    bins: [
      { label: '13°C', marketPrice: 0.988, noMarketPrice: 0.014 },
      { label: '14°C', marketPrice: 0.026, noMarketPrice: 0.982 }
    ],
    probabilities: [0.306, 0.491],
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  assert.notEqual(`${out.recommendedBin}-${out.recommendedSide}`, '13°C-NO');
  assert.ok(out.riskFlags.includes('temperature_locked'));
});

test('should not recommend NO side when NO executable price is missing', () => {
  const out = runTradingDecision({
    now: new Date('2026-03-14T03:00:00Z'),
    targetDate: new Date('2026-03-14T00:00:00+08:00'),
    currentTemp: 15,
    maxTempSoFar: 15,
    tempRise1h: 0.2,
    tempRise2h: 0.3,
    tempRise3h: 0.4,
    cloudCover: 25,
    precipitationProb: 0,
    windSpeed: 12,
    bins: [
      { label: '15°C', marketPrice: 0.22, bestBid: 0.21 },
      { label: '16°C', marketPrice: 0.73, bestBid: 0.69 }
    ],
    probabilities: [0.8, 0.2],
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  assert.notEqual(out.recommendedSide, 'NO');
});

test('global mutually-exclusive constraint should force only target-bin YES', () => {
  const out = runTradingDecision({
    now: new Date('2026-03-14T03:00:00Z'),
    targetDate: new Date('2026-03-14T00:00:00+08:00'),
    currentTemp: 15,
    maxTempSoFar: 15,
    tempRise1h: 0.3,
    tempRise2h: 0.5,
    tempRise3h: 0.6,
    cloudCover: 25,
    precipitationProb: 0,
    windSpeed: 12,
    bins: [
      { label: '15°C', marketPrice: 0.17, noMarketPrice: 0.845 },
      { label: '16°C', marketPrice: 0.72, noMarketPrice: 0.30 },
      { label: '17°C', marketPrice: 0.087, noMarketPrice: 0.921 }
    ],
    probabilities: [0.397, 0.372, 0.182],
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  const by = new Map(out.binOutputs.map((b) => [b.outcomeLabel, b.bestSide]));
  assert.equal(by.get('15°C'), 'YES');
  assert.equal(by.get('16°C'), 'NO');
  assert.equal(by.get('17°C'), 'NO');
});
