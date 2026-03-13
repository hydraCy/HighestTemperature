import 'dotenv/config';
import { prisma } from '@/lib/db';

type SourceRow = {
  sourceCode: string;
  sourceGroup: string;
  sampleSize: number;
  bias: number | null;
  mae: number | null;
  rmse: number | null;
  exactHitRate: number | null;
  within1CHitRate: number | null;
  biasFactor: number;
  reliabilityScore: number;
};

function summarizeSource(rows: Array<{ bias: number; absError: number }>, sourceCode: string, sourceGroup: string): SourceRow {
  if (!rows.length) {
    return {
      sourceCode,
      sourceGroup,
      sampleSize: 0,
      bias: null,
      mae: null,
      rmse: null,
      exactHitRate: null,
      within1CHitRate: null,
      biasFactor: 0,
      reliabilityScore: 0
    };
  }

  const sampleSize = rows.length;
  const bias = rows.reduce((a, r) => a + r.bias, 0) / sampleSize;
  const mae = rows.reduce((a, r) => a + Math.abs(r.bias), 0) / sampleSize;
  const rmse = Math.sqrt(rows.reduce((a, r) => a + r.bias * r.bias, 0) / sampleSize);
  const exactHit = rows.filter((r) => Math.abs(r.bias) < 0.5).length / sampleSize;
  const within1C = rows.filter((r) => Math.abs(r.bias) <= 1.0).length / sampleSize;
  const biasFactor = sampleSize / (sampleSize + 10);
  const reliabilityScore = (1 / (mae + 0.25)) * Math.max(0.1, biasFactor);

  return {
    sourceCode,
    sourceGroup,
    sampleSize,
    bias: Number(bias.toFixed(3)),
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    exactHitRate: Number(exactHit.toFixed(3)),
    within1CHitRate: Number(within1C.toFixed(3)),
    biasFactor: Number(biasFactor.toFixed(3)),
    reliabilityScore: Number(reliabilityScore.toFixed(3))
  };
}

async function main() {
  const lookbackDays = Number(process.env.BIAS_LOOKBACK_DAYS ?? '30');
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const expectedSources = [
    { sourceCode: 'open_meteo', sourceGroup: 'free' },
    { sourceCode: 'wttr', sourceGroup: 'free' },
    { sourceCode: 'met_no', sourceGroup: 'free' },
    { sourceCode: 'weatherapi', sourceGroup: 'paid' },
    { sourceCode: 'qweather', sourceGroup: 'paid' }
  ] as const;

  const data = await prisma.forecastSourceBias.findMany({
    where: { capturedAt: { gte: since } },
    select: {
      sourceCode: true,
      sourceGroup: true,
      forecastDate: true,
      predictedMax: true,
      finalMax: true,
      bias: true,
      absError: true,
      capturedAt: true
    },
    orderBy: [{ forecastDate: 'desc' }, { sourceCode: 'asc' }]
  });

  const bySource = new Map<string, Array<{ bias: number; absError: number }>>();
  for (const row of data) {
    const key = row.sourceCode;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push({ bias: row.bias, absError: row.absError });
  }

  const summary = expectedSources.map((s) =>
    summarizeSource(bySource.get(s.sourceCode) ?? [], s.sourceCode, s.sourceGroup)
  );

  const out = {
    station: 'ZSPD',
    lookbackDays,
    since: since.toISOString(),
    sampleSize: data.length,
    summary,
    recentSamples: data.slice(0, 120).map((r) => ({
      date: r.forecastDate.toISOString().slice(0, 10),
      source: r.sourceCode,
      predicted: r.predictedMax,
      final: r.finalMax,
      bias: r.bias
    }))
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

