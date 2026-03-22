import { fromJsonString } from '@/lib/utils/json';
import { targetDayEndSettlementAt } from '@/lib/utils/market-time';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';

function marketWhereByLocation(locationKey: SupportedLocationKey) {
  const cfg = getLocationConfig(locationKey);
  return {
    cityName: cfg.market.cityName,
    OR: [
      { marketSlug: { contains: cfg.market.slugKeyword } },
      { marketTitle: { contains: cfg.market.titleKeyword } }
    ]
  };
}

function localDayRange(dateKey: string | undefined, timezone: string) {
  if (!dateKey) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const offset = timezone === 'Asia/Hong_Kong' ? '+08:00' : '+08:00';
  const start = new Date(`${dateKey}T00:00:00${offset}`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

function marketStatusOf(market: { targetDate: Date; isActive: boolean }) {
  const now = new Date();
  const settlementAt = targetDayEndSettlementAt(market.targetDate);
  const minutesToSettlement = Math.floor((settlementAt.getTime() - now.getTime()) / 60000);
  const isSettledByTime = minutesToSettlement <= 0;
  const isSettledByInactive = !market.isActive;
  const isSettled = isSettledByTime || isSettledByInactive;
  return {
    now,
    settlementAt,
    minutesToSettlement,
    isSettled,
    isSettledByTime,
    isSettledByInactive,
    settledReason: isSettledByTime ? 'time_elapsed' : (isSettledByInactive ? 'market_inactive' : 'open')
  };
}

function effectiveMarketActive(market: { isActive: boolean; rawJson: string | null }) {
  const raw = fromJsonString<{ isActive?: boolean }>(market.rawJson, {});
  if (typeof raw.isActive === 'boolean') return raw.isActive;
  return market.isActive;
}

export async function getDashboardData(targetDateKey?: string, locationKey: SupportedLocationKey = 'shanghai') {
  const { prisma } = await import('@/lib/db');
  const cfg = getLocationConfig(locationKey);
  const whereByLocation = marketWhereByLocation(locationKey);
  const dayRange = localDayRange(targetDateKey, cfg.timezone);
  const market = await prisma.market.findFirst({
    where: {
      ...whereByLocation,
      ...(dayRange ? { targetDate: dayRange } : {})
    },
    include: {
      bins: { orderBy: { outcomeIndex: 'asc' } },
      resolutionMetadata: true,
      weatherSnapshots: { orderBy: { id: 'desc' }, take: 1 },
      modelRuns: { orderBy: { runAt: 'desc' }, take: 1, include: { outputs: true } },
      settledResult: true,
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 20 },
      notes: { orderBy: { createdAt: 'desc' }, take: 20 }
    },
    orderBy: [{ isActive: 'desc' }, { targetDate: 'desc' }, { updatedAt: 'desc' }]
  });

  if (!market) return null;

  const latestRun = market.modelRuns[0] ?? null;
  const latestWeather = market.weatherSnapshots[0] ?? null;
  const marketStatus = marketStatusOf({
    targetDate: market.targetDate,
    isActive: effectiveMarketActive(market)
  });
  const biasStats = await prisma.forecastSourceBias.groupBy({
    by: ['sourceCode', 'sourceGroup'],
    _count: { sourceCode: true },
    _avg: { absError: true, bias: true },
    orderBy: { _avg: { absError: 'asc' } }
  });

  return {
    locationKey,
    locationConfig: cfg,
    market,
    marketStatus,
    latestRun,
    latestWeather,
    marketSource: fromJsonString<{ source?: string }>(market.rawJson, {}).source ?? 'unknown',
    weatherSource: fromJsonString<{ source?: string }>(latestWeather?.rawJson, {}).source ?? 'unknown',
    latestDecision: latestRun
      ? {
          reasonMeta: fromJsonString<{ reasonZh?: string; reasonEn?: string; recommendedSide?: string }>(latestRun.rawFeaturesJson, {}),
          decision: latestRun.decision,
          recommendedBin: latestRun.bestBin,
          recommendedSide: fromJsonString<{ recommendedSide?: string }>(latestRun.rawFeaturesJson, {}).recommendedSide ?? 'YES',
          edge: latestRun.edge,
          tradeScore: latestRun.tradeScore,
          positionSize: latestRun.recommendedPosition,
          timingScore: latestRun.timingScore,
          weatherScore: latestRun.weatherScore,
          dataQualityScore: latestRun.dataQualityScore,
          riskFlags: fromJsonString<string[]>(latestRun.riskFlagsJson, []),
          reason: latestRun.explanation,
          reasonZh: fromJsonString<{ reasonZh?: string }>(latestRun.rawFeaturesJson, {}).reasonZh ?? latestRun.explanation,
          reasonEn: fromJsonString<{ reasonEn?: string }>(latestRun.rawFeaturesJson, {}).reasonEn ?? latestRun.explanation
        }
      : null,
    biasStats,
    snapshots: market.snapshots,
    notes: market.notes
  };
}

export async function getMarketDetail(slug: string) {
  const { prisma } = await import('@/lib/db');
  const market = await prisma.market.findUnique({
    where: { marketSlug: slug },
    include: {
      bins: { orderBy: { outcomeIndex: 'asc' } },
      resolutionMetadata: true,
      weatherSnapshots: { orderBy: { id: 'desc' }, take: 30 },
      modelRuns: { orderBy: { runAt: 'desc' }, take: 30, include: { outputs: true } },
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 30 },
      forecastBiases: { orderBy: [{ forecastDate: 'desc' }, { absError: 'asc' }], take: 100 },
      settledResult: true,
      notes: { orderBy: { createdAt: 'desc' }, take: 50 }
    }
  });

  if (!market) return null;
  const locationKey: SupportedLocationKey = market.cityName === 'Hong Kong' ? 'hongkong' : 'shanghai';
  const cfg = getLocationConfig(locationKey);
  const latestMarket = await prisma.market.findFirst({
    where: marketWhereByLocation(locationKey),
    orderBy: [{ isActive: 'desc' }, { targetDate: 'desc' }, { updatedAt: 'desc' }],
    select: { marketSlug: true, targetDate: true }
  });
  const marketStatus = marketStatusOf({
    targetDate: market.targetDate,
    isActive: effectiveMarketActive(market)
  });
  const biasStats = await prisma.forecastSourceBias.groupBy({
    by: ['sourceCode', 'sourceGroup'],
    _count: { sourceCode: true },
    _avg: { absError: true, bias: true },
    orderBy: { _avg: { absError: 'asc' } }
  });

  return {
    locationKey,
    locationConfig: cfg,
    market,
    marketStatus,
    latestRun: market.modelRuns[0] ?? null,
    latestWeather: market.weatherSnapshots[0] ?? null,
    marketSource: fromJsonString<{ source?: string }>(market.rawJson, {}).source ?? 'unknown',
    weatherSource: fromJsonString<{ source?: string }>(market.weatherSnapshots[0]?.rawJson, {}).source ?? 'unknown',
    snapshots: market.snapshots,
    settled: market.settledResult,
    biasStats,
    latestMarketSlug: latestMarket?.marketSlug ?? null,
    isLatestMarket: latestMarket?.marketSlug === market.marketSlug
  };
}
