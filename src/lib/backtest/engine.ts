import { runCalibration } from '@/src/lib/calibration';
import { checkDistributionLegality } from '@/src/lib/metrics/distribution-checks';
import { brierScoreMulticlass, logLossMulticlass } from '@/src/lib/metrics/proper-scoring';
import { buildCalibrationCurve } from '@/src/lib/metrics/calibration';
import { runProbabilityEngine } from '@/src/lib/probability-engine';
import { backtestRowToProbabilityInput } from '@/src/lib/adapters/backtest-to-engine';
import { loadModelConfig } from '@/src/lib/model-config';
import { calculateEdge, classifyEdgeDecision } from '@/src/lib/backtest/trading';
import type {
  BacktestConfig,
  BacktestResult,
  CalibrationTables,
  NormalizedSnapshotRow,
  SnapshotBucket
} from '@/src/lib/backtest/types';

function nearestIntegerForRound(temp: number): number {
  return Math.round(temp);
}

function bucketByTime(snapshotTime: string): SnapshotBucket {
  if (snapshotTime.startsWith('08')) return '08';
  if (snapshotTime.startsWith('11')) return '11';
  if (snapshotTime.startsWith('14')) return '14';
  return 'late';
}

export function runBacktest(
  dataset: NormalizedSnapshotRow[],
  config: BacktestConfig = {},
  precomputed?: CalibrationTables
): BacktestResult {
  const tables = precomputed ?? runCalibration(dataset);
  const minTemp = config.minTemp ?? 0;
  const maxTemp = config.maxTemp ?? 45;
  const sigmaDecisionThreshold = config.sigmaDecisionThreshold ?? 1.5;
  const epsilon = config.epsilon ?? 1e-8;
  const binLabels = config.binLabels ?? ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C'];
  const modelConfig = loadModelConfig(config.modelConfigPath);
  const bucketCounts: Record<SnapshotBucket, number> = { '08': 0, '11': 0, '14': 0, 'late': 0 };
  const fallbackMinSamplesPerBucket = tables.meta.minSamplesPerBucket;
  let fallbackCount = 0;
  const warnings: string[] = [];

  const probRows: number[][] = [];
  const actualIndices: number[] = [];
  const calibrationRows: { confidence: number; hit: boolean }[] = [];
  const checks: BacktestResult['distributionChecks'] = [];
  const sigmas: number[] = [];
  const spreads: number[] = [];
  const trades: BacktestResult['trades'] = [];
  const sampleDistributions: BacktestResult['sampleDistributions'] = [];

  for (const row of dataset) {
    bucketCounts[row.snapshotBucket] += 1;
  }
  const insufficientBuckets = (Object.keys(bucketCounts) as SnapshotBucket[]).filter(
    (bucket) => bucketCounts[bucket] < fallbackMinSamplesPerBucket
  );
  if (insufficientBuckets.length > 0) {
    warnings.push(
      `Insufficient samples for buckets: ${insufficientBuckets.join(', ')} (threshold=${fallbackMinSamplesPerBucket})`
    );
  }

  for (const row of dataset) {
    const bucket = bucketByTime(row.snapshotTime);
    const adapted = backtestRowToProbabilityInput({
      row,
      binLabels,
      modelConfig,
      calibrationTables: {
        baseSigma: tables.baseSigma,
        sourceWeights: tables.sourceWeights as Record<string, Record<string, number>>,
        remainingCaps: tables.remainingCaps as Record<string, { q90?: number }>
      },
      minTemp,
      maxTemp
    });
    if (adapted.debug.sourceWeightFallbackUsed) fallbackCount += 1;
    sigmas.push(adapted.debug.finalSigma);
    spreads.push(adapted.debug.spreadSigma);
    const probabilityOutput = runProbabilityEngine({
      ...adapted.engineInput
    });
    const integerDist = probabilityOutput.integerDistribution;
    const binProbs = probabilityOutput.binProbabilities;
    sampleDistributions.push({
      targetDate: row.targetDate,
      snapshotTime: row.snapshotTime,
      bucket,
      mu: adapted.debug.mu,
      sigmaBase: adapted.debug.sigmaBase,
      spreadSigma: adapted.debug.spreadSigma,
      lambda: adapted.debug.lambda,
      finalSigma: adapted.debug.finalSigma,
      bucketSampleCount: tables.meta.bucketSampleCount[bucket] ?? 0,
      smoothedCalibration: tables.meta.usedSmoothing,
      sourceWeightFallbackUsed: adapted.debug.sourceWeightFallbackUsed,
      sigma: adapted.debug.finalSigma,
      L: adapted.debug.L,
      U: adapted.debug.U,
      integerProbabilities: probabilityOutput.debugSummary.integerProbabilities,
      binProbabilities: probabilityOutput.debugSummary.binProbabilities
    });

    checks.push(
      checkDistributionLegality({
        targetDate: row.targetDate,
        snapshotTime: row.snapshotTime,
        bucket,
        integerProbabilities: integerDist,
        minContinuous: adapted.debug.L,
        maxContinuous: adapted.debug.U,
        epsilon
      })
    );

    const probs = integerDist.map((x) => x.probability);
    const labels = integerDist.map((x) => x.temp);
    const actual = nearestIntegerForRound(row.finalMaxTemp);
    const actualIndex = labels.indexOf(actual);
    if (actualIndex < 0) continue;
    probRows.push(probs);
    actualIndices.push(actualIndex);

    const top = [...integerDist].sort((a, b) => b.probability - a.probability)[0]!;
    calibrationRows.push({
      confidence: top.probability,
      hit: top.temp === actual
    });

    for (let i = 0; i < binLabels.length; i += 1) {
      const label = binLabels[i]!;
      const p = binProbs[i] ?? 0;
      const marketPrice = config.priceByLabel?.[label];
      if (!Number.isFinite(marketPrice)) continue;
      const edge = calculateEdge(p, marketPrice as number);
      trades.push({
        targetDate: row.targetDate,
        snapshotTime: row.snapshotTime,
        bucket,
        label,
        probability: p,
        marketPrice: marketPrice as number,
        edge,
        decision: classifyEdgeDecision(edge, adapted.debug.finalSigma, sigmaDecisionThreshold),
        sigma: adapted.debug.finalSigma
      });
    }
  }
  if (fallbackCount > 0) {
    warnings.push(`Fallback source weights used on ${fallbackCount} sample(s)`);
  }
  const p1Count = sampleDistributions.filter((x) => Object.values(x.integerProbabilities).some((p) => p >= 0.999999)).length;
  const overconfRows = calibrationRows.filter((x) => x.confidence > 0.9);
  const overconfHit = overconfRows.filter((x) => x.hit).length;
  const overconfHitRate = overconfRows.length ? overconfHit / overconfRows.length : 0;
  const curveWithCount = buildCalibrationCurve(calibrationRows).filter((x) => x.count > 0);
  const meanAbsDeviation = curveWithCount.length
    ? curveWithCount.reduce((acc, x) => acc + Math.abs(x.predicted - x.actual), 0) / curveWithCount.length
    : 0;
  const maxDeviation = curveWithCount.length
    ? Math.max(...curveWithCount.map((x) => Math.abs(x.predicted - x.actual)))
    : 0;
  const calibrationQuality: 'GOOD' | 'WARNING' | 'BAD' =
    meanAbsDeviation < 0.05 ? 'GOOD' : meanAbsDeviation < 0.1 ? 'WARNING' : 'BAD';
  const calibrationCurve = buildCalibrationCurve(calibrationRows);
  const failedChecks = checks.filter((x) => !x.pass).length;
  const totalChecks = checks.length;
  const passedChecks = totalChecks - failedChecks;

  return {
    metrics: {
      brier: brierScoreMulticlass(probRows, actualIndices),
      logloss: logLossMulticlass(probRows, actualIndices),
      calibrationError: {
        meanAbsDeviation,
        maxDeviation,
        quality: calibrationQuality
      },
      overconfidence: {
        count: overconfRows.length,
        hitRate: overconfHitRate
      }
    },
    calibrationCurve,
    distributionChecks: checks,
    summary: {
      avgSigma: sigmas.length ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : 0,
      avgSpread: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0,
      rows: probRows.length,
      sampleCount: dataset.length,
      bucketCounts,
      insufficientBuckets,
      fallbackUsed: fallbackCount > 0,
      fallbackCount,
      warnings,
      sigmaStats: {
        min: sigmas.length ? Math.min(...sigmas) : 0,
        max: sigmas.length ? Math.max(...sigmas) : 0,
        avg: sigmas.length ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : 0
      },
      p1Count,
      distributionLegality: {
        totalChecks,
        passedChecks,
        failedChecks,
        passRate: totalChecks > 0 ? passedChecks / totalChecks : 0
      }
    },
    trades,
    sampleDistributions
  };
}
