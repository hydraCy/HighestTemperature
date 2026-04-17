import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function stat(arr: number[]) {
  if (!arr.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: arr.reduce((a, b) => a + b, 0) / arr.length,
  };
}

async function main() {
  const rows = await prisma.modelRun.findMany({
    orderBy: { runAt: 'desc' },
    take: 500,
    select: { runAt: true, rawFeaturesJson: true },
  });

  const parsed = rows
    .map((r) => {
      try {
        const j = JSON.parse(r.rawFeaturesJson || '{}');
        return { runAt: r.runAt, d: j?.realtimeDebug };
      } catch {
        return null;
      }
    })
    .filter((x): x is { runAt: Date; d: any } => Boolean(x?.d))
    .filter((x) => typeof x.d.spreadSigmaRaw === 'number');

  const sample = parsed.slice(0, 30);

  const vals = (k: string) =>
    sample
      .map((x) => Number(x.d[k]))
      .filter((v) => Number.isFinite(v));

  const over90Count = sample.filter((x) => {
    const ps = [x.d.p13, x.d.p14, x.d.p15]
      .map((v: unknown) => Number(v))
      .filter((v) => Number.isFinite(v));
    return ps.some((p) => p > 0.9);
  }).length;

  const p15PositiveCount = sample.filter((x) => Number(x.d.p15) > 0).length;

  const bucketCounts = sample.reduce<Record<string, number>>((acc, x) => {
    const b = String(x.d.snapshotBucket || 'unknown');
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});

  const table = sample.map((x) => ({
    runAt: x.runAt,
    snapshotTime: x.d.snapshotTime,
    snapshotBucket: x.d.snapshotBucket,
    mu: x.d.mu,
    observedMaxSoFar: x.d.observedMaxSoFar,
    finalSigma: x.d.finalSigma,
    remainingCap: x.d.remainingCap,
    finalU: x.d.finalU,
    p13: x.d.p13,
    p14: x.d.p14,
    p15: x.d.p15,
  }));

  const out = {
    sampleCount: sample.length,
    summary: {
      finalSigma: stat(vals('finalSigma')),
      remainingCap: stat(vals('remainingCap')),
      spreadSigmaRaw: stat(vals('spreadSigmaRaw')),
      p15PositiveCount,
      over90Count,
      bucketCounts,
    },
    table,
  };

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
