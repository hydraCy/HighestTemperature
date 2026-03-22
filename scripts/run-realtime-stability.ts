import { PrismaClient } from '@prisma/client';

type SpreadPoint = {
  source: string;
  value: number;
  weight: number;
  diff: number;
  weightedSqContribution: number;
};

const prisma = new PrismaClient();

function stat(arr: number[]) {
  if (!arr.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: arr.reduce((a, b) => a + b, 0) / arr.length
  };
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const limitArg = process.argv.find((x) => x.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1])) : 30;

  const rows = await prisma.modelRun.findMany({
    orderBy: { runAt: 'desc' },
    take: 600,
    select: { runAt: true, rawFeaturesJson: true }
  });

  const parsed = rows
    .map((r) => {
      try {
        const j = JSON.parse(r.rawFeaturesJson || '{}');
        return { runAt: r.runAt, j };
      } catch {
        return null;
      }
    })
    .filter((x): x is { runAt: Date; j: Record<string, unknown> } => Boolean(x))
    .map((x) => ({
      runAt: x.runAt,
      d: (x.j.realtimeDebug ?? null) as Record<string, unknown> | null
    }))
    .filter((x) => x.d && finite(x.d.spreadSigmaRaw) != null);

  const sample = parsed.slice(0, limit);
  const vals = (k: string) =>
    sample
      .map((x) => finite(x.d?.[k]))
      .filter((v): v is number => v != null);

  const maxProb = (d: Record<string, unknown>) => {
    const direct = finite(d.mostLikelyIntegerProbability);
    if (direct != null) return direct;
    const list = [d.p13, d.p14, d.p15].map(finite).filter((x): x is number => x != null);
    if (!list.length) return 0;
    return Math.max(...list);
  };

  const over90Count = sample.filter((x) => maxProb(x.d!) > 0.9).length;
  const p15PositiveCount = sample.filter((x) => (finite(x.d?.p15) ?? 0) > 0).length;

  const bucketCounts = sample.reduce<Record<string, number>>((acc, x) => {
    const b = String(x.d?.snapshotBucket ?? 'unknown');
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});

  const table = sample.map((x) => {
    const d = x.d!;
    const pointsRaw = Array.isArray(d.spreadSourcePoints) ? d.spreadSourcePoints : [];
    const spreadSourcePoints = pointsRaw
      .map((p) => p as Partial<SpreadPoint>)
      .map((p) => ({
        source: String(p.source ?? 'unknown'),
        value: finite(p.value) ?? 0,
        weight: finite(p.weight) ?? 0,
        diff: finite(p.diff) ?? 0,
        weightedSqContribution: finite(p.weightedSqContribution) ?? 0
      }));
    return {
      runAt: x.runAt,
      snapshotTime: d.snapshotTime ?? null,
      snapshotBucket: d.snapshotBucket ?? null,
      mu: finite(d.mu),
      sigmaBase: finite(d.sigmaBase),
      spreadSigmaRaw: finite(d.spreadSigmaRaw),
      spreadSigmaEffective: finite(d.spreadSigmaEffective),
      lambda: finite(d.lambda),
      finalSigma: finite(d.finalSigma),
      observedMaxSoFar: finite(d.observedMaxSoFar),
      remainingCap: finite(d.remainingCap),
      finalU: finite(d.finalU),
      p13: finite(d.p13),
      p14: finite(d.p14),
      p15: finite(d.p15),
      mostLikelyInteger: finite(d.mostLikelyInteger),
      mostLikelyIntegerProbability: maxProb(d),
      spreadSourcePoints,
      spreadRemovedSources: Array.isArray(d.spreadRemovedSources) ? d.spreadRemovedSources : []
    };
  });

  const out = {
    sampleCount: sample.length,
    summary: {
      bucketCounts,
      spreadSigmaRaw: stat(vals('spreadSigmaRaw')),
      spreadSigmaEffective: stat(vals('spreadSigmaEffective')),
      finalSigma: stat(vals('finalSigma')),
      remainingCap: stat(vals('remainingCap')),
      p15PositiveCount,
      over90Count
    },
    table
  };

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

