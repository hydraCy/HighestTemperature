import { prisma } from '@/lib/db';
import { toJsonString } from '@/lib/utils/json';
import { fetchShanghaiMarket } from '@/lib/services/polymarket';
import { parseResolutionMetadata } from '@/lib/services/resolution-parser';
import { fetchShanghaiWeatherAssist } from '@/lib/services/weather-assist';
import { fetchWundergroundSettledMaxTemp } from '@/lib/services/wunderground-settlement';
import { estimateBinProbabilities } from '@/src/lib/trading-engine/model';
import { runTradingDecision } from '@/src/lib/trading-engine/tradingEngine';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { Prisma } from '@prisma/client';

const MODEL_VERSION = 'shanghai-rule-v1';
const SHANGHAI_TEMP_MARKET_WHERE: Prisma.MarketWhereInput = {
  cityName: 'Shanghai',
  OR: [
    { marketSlug: { contains: 'highest-temperature-in-shanghai' } },
    { marketTitle: { contains: 'Highest temperature in Shanghai' } }
  ]
};

export async function refreshMarketData() {
  const marketRes = await fetchShanghaiMarket();
  const m = marketRes.data;

  const market = await prisma.market.upsert({
    where: { marketSlug: m.marketSlug },
    create: {
      cityName: 'Shanghai',
      eventId: m.eventId,
      marketSlug: m.marketSlug,
      marketTitle: m.marketTitle,
      rulesText: m.rulesText,
      volume: m.volume,
      targetDate: m.targetDate,
      isActive: m.isActive,
      rawJson: toJsonString({ source: marketRes.source, isClosed: m.isClosed, isActive: m.isActive, endAt: m.targetDate.toISOString() })
    },
    update: {
      eventId: m.eventId,
      marketTitle: m.marketTitle,
      rulesText: m.rulesText,
      volume: m.volume,
      targetDate: m.targetDate,
      isActive: m.isActive,
      rawJson: toJsonString({ source: marketRes.source, isClosed: m.isClosed, isActive: m.isActive, endAt: m.targetDate.toISOString() })
    }
  });

  for (const bin of m.bins) {
    await prisma.marketBin.upsert({
      where: { marketId_outcomeIndex: { marketId: market.id, outcomeIndex: bin.index } },
      create: {
        marketId: market.id,
        outcomeLabel: bin.label,
        outcomeIndex: bin.index,
        marketPrice: bin.price,
        noMarketPrice: bin.noPrice,
        bestBid: bin.bestBid,
        bestAsk: bin.bestAsk,
        spread: bin.spread,
        impliedProbability: bin.price
      },
      update: {
        outcomeLabel: bin.label,
        marketPrice: bin.price,
        noMarketPrice: bin.noPrice,
        bestBid: bin.bestBid,
        bestAsk: bin.bestAsk,
        spread: bin.spread,
        impliedProbability: bin.price,
        updatedAt: new Date()
      }
    });
  }

  const rm = parseResolutionMetadata(m.rulesText);
  await prisma.resolutionMetadata.upsert({
    where: { marketId: market.id },
    create: { marketId: market.id, ...rm },
    update: { ...rm, updatedAt: new Date() }
  });

  return market;
}

export async function refreshWeatherData() {
  const market = await prisma.market.findFirst({
    where: { ...SHANGHAI_TEMP_MARKET_WHERE, isActive: true },
    orderBy: [{ targetDate: 'desc' }, { updatedAt: 'desc' }]
  });
  if (!market) return null;

  const weatherRes = await fetchShanghaiWeatherAssist(market.targetDate);
  const w = weatherRes.data;

  return prisma.weatherAssistSnapshot.create({
    data: {
      marketId: market.id,
      observedAt: w.observedAt,
      temperature2m: w.temperature2m,
      humidity: w.humidity,
      cloudCover: w.cloudCover,
      precipitation: w.precipitation,
      windSpeed: w.windSpeed,
      temp1hAgo: w.temp1hAgo,
      temp2hAgo: w.temp2hAgo,
      temp3hAgo: w.temp3hAgo,
      tempRise1h: w.tempRise1h,
      tempRise2h: w.tempRise2h,
      tempRise3h: w.tempRise3h,
      maxTempSoFar: w.maxTempSoFar,
      rawJson: toJsonString({ source: weatherRes.source, raw: w.raw })
    }
  });
}

export async function runModelAndDecision(totalCapital = 10000, maxSingleTradePercent = 0.1) {
  const market = await prisma.market.findFirst({
    where: SHANGHAI_TEMP_MARKET_WHERE,
    include: {
      bins: { orderBy: { outcomeIndex: 'asc' } },
      resolutionMetadata: true,
      weatherSnapshots: { orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], take: 1 }
    },
    orderBy: [{ isActive: 'desc' }, { targetDate: 'desc' }, { updatedAt: 'desc' }]
  });
  if (!market) return null;

  const weather = market.weatherSnapshots[0];
  if (!weather || !market.bins.length) return null;

  const probs = estimateBinProbabilities({
    bins: market.bins.map((b) => b.outcomeLabel),
    currentTemp: weather.temperature2m,
    maxTempSoFar: weather.maxTempSoFar,
    tempRise1h: weather.tempRise1h ?? 0,
    tempRise2h: weather.tempRise2h ?? 0,
    tempRise3h: weather.tempRise3h ?? 0,
    cloudCover: weather.cloudCover ?? 0,
    precipitationProb: (weather.precipitation ?? 0) * 100,
    windSpeed: weather.windSpeed ?? 0
  });

  const decision = runTradingDecision({
    now: new Date(),
    targetDate: market.targetDate,
    marketEndAt: market.targetDate,
    marketActive: market.isActive,
    currentTemp: weather.temperature2m,
    maxTempSoFar: weather.maxTempSoFar,
    tempRise1h: weather.tempRise1h ?? 0,
    tempRise2h: weather.tempRise2h ?? 0,
    tempRise3h: weather.tempRise3h ?? 0,
    cloudCover: weather.cloudCover ?? 0,
    precipitationProb: (weather.precipitation ?? 0) * 100,
    windSpeed: weather.windSpeed ?? 0,
    bins: market.bins.map((b) => ({
      label: b.outcomeLabel,
      marketPrice: b.marketPrice,
      noMarketPrice: b.noMarketPrice ?? undefined,
      bestBid: b.bestBid ?? undefined
    })),
    probabilities: probs,
    resolutionReady: Boolean(market.resolutionMetadata),
    weatherReady: Boolean(weather),
    marketReady: market.bins.length > 0,
    modelReady: probs.length === market.bins.length,
    totalCapital,
    maxSingleTradePercent
  });

  const modelRun = await prisma.modelRun.create({
    data: {
      marketId: market.id,
      modelVersion: MODEL_VERSION,
      bestBin: decision.recommendedBin,
      edge: decision.edge,
      tradeScore: decision.tradeScore,
      decision: decision.decision,
      recommendedPosition: decision.positionSize,
      timingScore: decision.timingScore,
      weatherScore: decision.weatherScore,
      dataQualityScore: decision.dataQualityScore,
      explanation: decision.reason,
      riskFlagsJson: toJsonString(decision.riskFlags),
      rawFeaturesJson: toJsonString({
        currentTemp: weather.temperature2m,
        maxTempSoFar: weather.maxTempSoFar,
        recommendedSide: decision.recommendedSide
      }),
      outputs: {
        create: decision.binOutputs.map((o) => ({
          outcomeLabel: o.outcomeLabel,
          modelProbability: o.modelProbability,
          marketPrice: o.marketPrice,
          edge: o.edge
        }))
      }
    },
    include: { outputs: true }
  });

  await prisma.snapshot.create({
    data: {
      marketId: market.id,
      modelRunId: modelRun.id,
      capturedAt: new Date(),
      marketPricesJson: toJsonString(market.bins.map((b) => ({ label: b.outcomeLabel, price: b.marketPrice }))),
      weatherFeaturesJson: toJsonString({
        currentTemp: weather.temperature2m,
        maxTempSoFar: weather.maxTempSoFar,
        tempRise1h: weather.tempRise1h,
        tempRise2h: weather.tempRise2h,
        tempRise3h: weather.tempRise3h,
        cloudCover: weather.cloudCover,
        precipitation: weather.precipitation,
        windSpeed: weather.windSpeed
      }),
      modelOutputJson: toJsonString(modelRun.outputs),
      tradingOutputJson: toJsonString(decision),
      explanationText: decision.reason,
      riskFlagsJson: toJsonString(decision.riskFlags)
    }
  });

  return { market, weather, modelRun, decision };
}

export async function runFullRefresh() {
  const totalCapital = Number(process.env.TOTAL_CAPITAL ?? '10000');
  const maxSingleTradePercent = Number(process.env.MAX_SINGLE_TRADE_PERCENT ?? '0.1');
  await refreshMarketData();
  await refreshWeatherData();
  const result = await runModelAndDecision(totalCapital, maxSingleTradePercent);
  await syncSettledResults();
  return result;
}

export async function syncSettledResults() {
  const markets = await prisma.market.findMany({
    where: { ...SHANGHAI_TEMP_MARKET_WHERE, targetDate: { lt: new Date() } },
    include: {
      bins: { orderBy: { outcomeIndex: 'asc' } },
      resolutionMetadata: true,
      settledResult: true
    },
    orderBy: { targetDate: 'desc' },
    take: 20
  });

  const synced: Array<{ marketSlug: string; finalTemp: number; outcome: string }> = [];

  for (const market of markets) {
    if (market.settledResult) continue;
    if (!market.bins.length) continue;
    const tempBinCount = market.bins
      .map((b) => parseTemperatureBin(b.outcomeLabel))
      .filter((x) => x.min != null || x.max != null).length;
    if (tempBinCount < 2) continue;

    const stationCode = market.resolutionMetadata?.stationCode || 'ZSPD';
    const settled = await fetchWundergroundSettledMaxTemp({
      targetDate: market.targetDate,
      stationCode
    });
    const roundedFinalTemp = Math.round(settled.maxTempC);
    const outcome = pickWinningBinLabel(market.bins.map((b) => b.outcomeLabel), roundedFinalTemp);

    await prisma.settledResult.upsert({
      where: { marketId: market.id },
      create: {
        marketId: market.id,
        finalOutcomeLabel: outcome,
        finalValue: roundedFinalTemp,
        settledAt: new Date(),
        sourceUrl: settled.sourceUrl
      },
      update: {
        finalOutcomeLabel: outcome,
        finalValue: roundedFinalTemp,
        settledAt: new Date(),
        sourceUrl: settled.sourceUrl
      }
    });

    await prisma.market.update({
      where: { id: market.id },
      data: { isActive: false }
    });

    synced.push({
      marketSlug: market.marketSlug,
      finalTemp: roundedFinalTemp,
      outcome
    });
  }

  return synced;
}

function pickWinningBinLabel(labels: string[], finalTemp: number) {
  const scored = labels.map((label) => {
    const p = parseTemperatureBin(label);
    return { label, min: p.min, max: p.max };
  });

  const exact = scored.find((b) => {
    if (b.min != null && b.max != null) return finalTemp >= b.min && finalTemp < b.max;
    if (b.min != null && b.max == null) return finalTemp >= b.min;
    if (b.min == null && b.max != null) return finalTemp < b.max;
    return false;
  });
  if (exact) return exact.label;

  const nearest = scored
    .map((b) => {
      const anchor = b.min ?? b.max ?? 0;
      return { label: b.label, dist: Math.abs(finalTemp - anchor) };
    })
    .sort((a, b) => a.dist - b.dist)[0];
  return nearest?.label ?? labels[0] ?? 'unknown';
}
