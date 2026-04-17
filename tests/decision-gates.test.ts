import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceDateAlignmentGate,
  enforceStrictWeatherSourceGate,
  enforceWeatherFreshnessGate,
} from '@/lib/services/trading-pipeline';
import type { TradingDecisionOutput } from '@/src/lib/trading-engine/types';

function baseDecision(): TradingDecisionOutput {
  return {
    decision: 'BUY',
    recommendedBin: '13°C',
    recommendedSide: 'NO',
    edge: 0.12,
    tradeScore: 78,
    positionSize: 100,
    timingScore: 70,
    weatherScore: 70,
    dataQualityScore: 80,
    riskFlags: [],
    reason: 'x',
    reasonZh: 'x',
    reasonEn: 'x',
    binOutputs: [],
  };
}

test('strict source gate should force PASS when strictReady=false', () => {
  const d = baseDecision();
  const out = enforceStrictWeatherSourceGate(
    d,
    JSON.stringify({
      raw: {
        strictReady: false,
        missingSources: ['weatherapi'],
      },
    }),
  );
  assert.equal(out.decision, 'PASS');
  assert.equal(out.positionSize, 0);
  assert.ok(out.riskFlags.includes('weather_source_incomplete'));
});

test('freshness gate should force PASS when data stale', () => {
  const d = baseDecision();
  const now = new Date('2026-03-22T10:20:00+08:00');
  const stale = new Date('2026-03-22T10:05:00+08:00').toISOString();
  const out = enforceWeatherFreshnessGate(
    d,
    JSON.stringify({
      raw: {
        nowcasting: { observedAt: stale },
        fetchedAtIso: stale
      },
    }),
    now
  );
  assert.equal(out.decision, 'PASS');
  assert.equal(out.positionSize, 0);
  assert.ok(out.riskFlags.includes('weather_data_stale'));
});

test('freshness gate should pass when within WU cadence window', () => {
  const d = baseDecision();
  const now = new Date('2026-03-22T10:17:00+08:00');
  const freshObservedAt = new Date('2026-03-22T10:05:00+08:00').toISOString();
  const out = enforceWeatherFreshnessGate(
    d,
    JSON.stringify({
      raw: {
        nowcasting: { observedAt: freshObservedAt },
      },
    }),
    now
  );
  assert.equal(out.decision, 'BUY');
  assert.equal(out.positionSize, 100);
});

test('date alignment gate should force PASS when weather target date mismatches market', () => {
  const d = baseDecision();
  const out = enforceDateAlignmentGate(
    d,
    new Date('2026-03-17T00:00:00+08:00'),
    JSON.stringify({
      raw: {
        targetDate: '2026-03-18',
      },
    }),
  );
  assert.equal(out.decision, 'PASS');
  assert.equal(out.positionSize, 0);
  assert.ok(out.riskFlags.includes('weather_market_date_mismatch'));
});

