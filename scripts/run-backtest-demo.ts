import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  expandBacktestRows,
  loadSnapshotRowsFromPath,
  normalizeSnapshotRows,
  runBacktest
} from '@/src/lib/backtest';
import { runCalibration } from '@/src/lib/calibration';

function getArgValue(name: string): string | undefined {
  const idx = process.argv.findIndex((arg) => arg === name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const outFile = getArgValue('--out');
  const fullOutput = process.argv.includes('--full');
  const datasetArg = getArgValue('--dataset') ?? 'scripts/data/backtest-demo.json';
  const minRows = Number(getArgValue('--min-rows') ?? '200');
  const replicateDaysArg = Number(getArgValue('--replicate-days') ?? '0');

  const datasetPath = path.resolve(process.cwd(), datasetArg);
  const raw = await loadSnapshotRowsFromPath(datasetPath);
  const normalized = normalizeSnapshotRows(raw);
  const autoReplicateDays =
    normalized.length > 0 && minRows > normalized.length
      ? Math.ceil(minRows / normalized.length)
      : 1;
  const replicateDays = replicateDaysArg > 0 ? replicateDaysArg : autoReplicateDays;
  const rows = expandBacktestRows(normalized, replicateDays);

  const preWarnings: string[] = [];
  if (replicateDaysArg <= 0 && autoReplicateDays > 1) {
    preWarnings.push(
      `Dataset rows (${normalized.length}) below minRows (${minRows}), auto-expanded to ${rows.length} rows via replicateDays=${autoReplicateDays}.`
    );
  }

  const calibration = runCalibration(rows);
  const result = runBacktest(
    rows,
    {
      minTemp: 8,
      maxTemp: 20,
      lambda: 1.0,
      sigmaDecisionThreshold: 1.5,
      binLabels: ['<=11°C', '12°C', '13°C', '14°C', '15°C', '>=16°C'],
      priceByLabel: {
        '<=11°C': 0.06,
        '12°C': 0.22,
        '13°C': 0.35,
        '14°C': 0.28,
        '15°C': 0.08,
        '>=16°C': 0.03
      }
    },
    calibration
  );

  const p1Count = result.summary.p1Count;
  const hasP1 = p1Count > 0;

  console.log('=== Backtest Pipeline Status ===');
  console.log(
    JSON.stringify(
      {
        datasetPath,
        originalSampleCount: normalized.length,
        replicateDays,
        minRows,
        sampleCount: result.summary.sampleCount,
        bucketCounts: result.summary.bucketCounts,
        insufficientBuckets: result.summary.insufficientBuckets,
        fallbackUsed: result.summary.fallbackUsed,
        fallbackCount: result.summary.fallbackCount,
        warnings: [...preWarnings, ...result.summary.warnings]
      },
      null,
      2
    )
  );
  const smoothedBuckets = Object.entries(calibration.meta.debug.baseSigma)
    .filter(([, x]) => x.sampleCount < calibration.meta.minSamplesPerBucket)
    .map(([bucket]) => bucket);
  console.log('=== Health Summary ===');
  console.log(
    JSON.stringify(
      {
        sampleCount: result.summary.sampleCount,
        bucketCounts: result.summary.bucketCounts,
        smoothedBuckets,
        sigmaStats: result.summary.sigmaStats,
        overconfidence: result.metrics.overconfidence,
        calibrationSummary: result.metrics.calibrationError,
        distributionLegality: result.summary.distributionLegality
      },
      null,
      2
    )
  );
  console.log('=== Calibration Tables ===');
  console.log(JSON.stringify(calibration, null, 2));
  console.log('=== Sample Distributions (first 5) ===');
  console.log(JSON.stringify(result.sampleDistributions.slice(0, 5), null, 2));
  console.log('=== Metrics Summary ===');
  console.log(
    JSON.stringify(
      {
        brier: result.metrics.brier,
        logloss: result.metrics.logloss,
        calibrationQuality: result.metrics.calibrationError.quality,
        calibrationMeanAbsDeviation: result.metrics.calibrationError.meanAbsDeviation,
        calibrationMaxDeviation: result.metrics.calibrationError.maxDeviation,
        overconfidence: result.metrics.overconfidence,
        sigmaStats: result.summary.sigmaStats,
        p1Count,
        hasP1
      },
      null,
      2
    )
  );
  if (fullOutput) {
    console.log('=== Backtest Result (full) ===');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('=== Backtest Result (compact) ===');
    console.log(
      JSON.stringify(
        {
          metrics: result.metrics,
          summary: result.summary,
          sampleDistributionsPreview: result.sampleDistributions.slice(0, 3)
        },
        null,
        2
      )
    );
  }

  if (outFile) {
    const outPath = path.resolve(process.cwd(), outFile);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(
      outPath,
      JSON.stringify(
        {
          meta: {
            generatedAt: new Date().toISOString(),
            datasetPath,
            originalSampleCount: normalized.length,
            replicateDays,
            minRows,
            warnings: preWarnings
          },
          calibration,
          result
        },
        null,
        2
      ),
      'utf-8'
    );
    console.log(`=== Wrote JSON output to ${outPath} ===`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
