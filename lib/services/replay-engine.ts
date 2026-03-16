import { prisma } from '@/lib/db';
import { fromJsonString } from '@/lib/utils/json';

export type ReplayInput = {
  marketSlug: string;
  timestamp: Date;
};

export type ReplayOutput = {
  snapshotId: string;
  capturedAt: Date;
  modelDistribution: Array<{ label: string; probability: number }>;
  marketPrices: Array<{ label: string; price: number }>;
  decision: { decision?: string; recommendedBin?: string; recommendedSide?: string; edge?: number };
};

export async function replaySnapshot(input: ReplayInput): Promise<ReplayOutput | null> {
  const market = await prisma.market.findUnique({
    where: { marketSlug: input.marketSlug },
    select: { id: true }
  });
  if (!market) return null;

  const snap = await prisma.snapshot.findFirst({
    where: { marketId: market.id, capturedAt: { lte: input.timestamp } },
    orderBy: { capturedAt: 'desc' }
  });
  if (!snap) return null;

  const model = fromJsonString<Array<{ outcomeLabel?: string; modelProbability?: number }>>(snap.modelOutputJson, []);
  const prices = fromJsonString<Array<{ label?: string; price?: number }>>(snap.marketPricesJson, []);
  const trading = fromJsonString<{ decision?: string; recommendedBin?: string; recommendedSide?: string; edge?: number }>(
    snap.tradingOutputJson,
    {}
  );

  return {
    snapshotId: snap.id,
    capturedAt: snap.capturedAt,
    modelDistribution: model
      .filter((x) => typeof x.outcomeLabel === 'string' && typeof x.modelProbability === 'number')
      .map((x) => ({ label: x.outcomeLabel as string, probability: x.modelProbability as number })),
    marketPrices: prices
      .filter((x) => typeof x.label === 'string' && typeof x.price === 'number')
      .map((x) => ({ label: x.label as string, price: x.price as number })),
    decision: trading
  };
}

export function evaluateReplay(
  replay: ReplayOutput,
  finalOutcomeLabel: string
) {
  const byLabel = new Map(replay.modelDistribution.map((x) => [x.label, x.probability]));
  const outcomes = replay.modelDistribution.map((x) => x.label);
  const brier = outcomes.reduce((acc, label) => {
    const p = byLabel.get(label) ?? 0;
    const o = label === finalOutcomeLabel ? 1 : 0;
    return acc + (p - o) ** 2;
  }, 0) / Math.max(1, outcomes.length);
  const pWin = Math.max(1e-6, Math.min(1 - 1e-6, byLabel.get(finalOutcomeLabel) ?? 1e-6));
  const logLoss = -Math.log(pWin);
  const picked = replay.decision.recommendedBin ?? '';
  const pickedPrice = replay.marketPrices.find((x) => x.label === picked)?.price ?? null;
  const realizedEV = pickedPrice == null ? null : ((picked === finalOutcomeLabel ? 1 : 0) - pickedPrice);
  return {
    brierScore: brier,
    logLoss,
    realizedEV
  };
}

