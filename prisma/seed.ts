import { PrismaClient } from '@prisma/client';
import { addHours, subHours } from 'date-fns';
import { toJsonString } from '@/lib/utils/json';
import { runTradingDecision } from '@/src/lib/trading-engine/tradingEngine';
import { estimateBinProbabilities } from '@/src/lib/trading-engine/model';

const prisma = new PrismaClient();

async function main() {
  await prisma.modelBinOutput.deleteMany();
  await prisma.snapshot.deleteMany();
  await prisma.modelRun.deleteMany();
  await prisma.weatherAssistSnapshot.deleteMany();
  await prisma.marketBin.deleteMany();
  await prisma.resolutionMetadata.deleteMany();
  await prisma.note.deleteMany();
  await prisma.settledResult.deleteMany();
  await prisma.market.deleteMany();

  const market = await prisma.market.create({
    data: {
      cityName: 'Shanghai',
      eventId: 'ev_sh_1',
      marketSlug: 'highest-temperature-in-shanghai-mar-12-2026',
      marketTitle: 'Highest temperature in Shanghai on Mar 12, 2026?',
      rulesText:
        'Resolves to highest temperature in Shanghai measured at Wunderground station ZSPD. Final value rounded to nearest 0.1C. Latest finalized value is used.',
      volume: 31200,
      targetDate: new Date(),
      rawJson: toJsonString({ seeded: true })
    }
  });

  await prisma.resolutionMetadata.create({
    data: {
      marketId: market.id,
      stationName: 'Shanghai Pudong International Airport Station',
      stationCode: 'ZSPD',
      sourceName: 'Wunderground',
      sourceUrl: 'https://www.wunderground.com/history/daily/cn/shanghai/ZSPD',
      precisionRule: 'Final value rounded to nearest 0.1°C',
      finalizedRule: 'Use latest finalized value shown on source',
      revisionRule: 'Source revisions before settlement are valid'
    }
  });

  const bins = [
    { outcomeLabel: '<30C', marketPrice: 0.08 },
    { outcomeLabel: '30-31C', marketPrice: 0.23 },
    { outcomeLabel: '31-32C', marketPrice: 0.31 },
    { outcomeLabel: '32-33C', marketPrice: 0.24 },
    { outcomeLabel: '33C+', marketPrice: 0.14 }
  ];

  await prisma.marketBin.createMany({
    data: bins.map((b, i) => ({
      marketId: market.id,
      outcomeLabel: b.outcomeLabel,
      outcomeIndex: i,
      marketPrice: b.marketPrice,
      impliedProbability: b.marketPrice
    }))
  });

  const temps = [29.6, 30.2, 30.8, 31.4, 31.8, 32.1, 32.3, 32.6];
  const clouds = [28, 26, 24, 26, 30, 35, 39, 43];
  const rains = [0, 0, 0, 0, 0, 0.1, 0.1, 0.1];

  for (let i = 0; i < temps.length; i++) {
    const observedAt = addHours(subHours(new Date(), temps.length - 1), i);
    const currentTemp = temps[i];
    const t1 = temps[Math.max(0, i - 1)];
    const t2 = temps[Math.max(0, i - 2)];
    const t3 = temps[Math.max(0, i - 3)];

    await prisma.weatherAssistSnapshot.create({
      data: {
        marketId: market.id,
        observedAt,
        temperature2m: currentTemp,
        humidity: 60 - Math.min(i, 8),
        cloudCover: clouds[i],
        precipitation: rains[i],
        windSpeed: 12 + i * 0.3,
        temp1hAgo: t1,
        temp2hAgo: t2,
        temp3hAgo: t3,
        tempRise1h: currentTemp - t1,
        tempRise2h: currentTemp - t2,
        tempRise3h: currentTemp - t3,
        maxTempSoFar: Math.max(...temps.slice(0, i + 1)),
        rawJson: toJsonString({ seeded: true })
      }
    });
  }

  const latestWeather = await prisma.weatherAssistSnapshot.findFirst({ where: { marketId: market.id }, orderBy: { observedAt: 'desc' } });
  if (!latestWeather) return;

  const probabilities = estimateBinProbabilities({
    bins: bins.map((b) => b.outcomeLabel),
    currentTemp: latestWeather.temperature2m,
    maxTempSoFar: latestWeather.maxTempSoFar,
    tempRise1h: latestWeather.tempRise1h ?? 0,
    tempRise2h: latestWeather.tempRise2h ?? 0,
    tempRise3h: latestWeather.tempRise3h ?? 0,
    cloudCover: latestWeather.cloudCover ?? 0,
    precipitationProb: (latestWeather.precipitation ?? 0) * 100,
    windSpeed: latestWeather.windSpeed ?? 0
  });

  const decision = runTradingDecision({
    now: new Date(),
    currentTemp: latestWeather.temperature2m,
    maxTempSoFar: latestWeather.maxTempSoFar,
    tempRise1h: latestWeather.tempRise1h ?? 0,
    tempRise2h: latestWeather.tempRise2h ?? 0,
    tempRise3h: latestWeather.tempRise3h ?? 0,
    cloudCover: latestWeather.cloudCover ?? 0,
    precipitationProb: (latestWeather.precipitation ?? 0) * 100,
    windSpeed: latestWeather.windSpeed ?? 0,
    bins: bins.map((b) => ({ label: b.outcomeLabel, marketPrice: b.marketPrice })),
    probabilities,
    resolutionReady: true,
    weatherReady: true,
    marketReady: true,
    modelReady: true,
    totalCapital: 10000,
    maxSingleTradePercent: 0.1
  });

  const run = await prisma.modelRun.create({
    data: {
      marketId: market.id,
      modelVersion: 'seed-model-v1',
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
      rawFeaturesJson: toJsonString({ seeded: true }),
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
      modelRunId: run.id,
      marketPricesJson: toJsonString(bins),
      weatherFeaturesJson: toJsonString({ currentTemp: latestWeather.temperature2m }),
      modelOutputJson: toJsonString(run.outputs),
      tradingOutputJson: toJsonString(decision),
      explanationText: decision.reason,
      riskFlagsJson: toJsonString(decision.riskFlags)
    }
  });

  await prisma.note.create({
    data: {
      marketId: market.id,
      noteText: '样例研究：当前 31-32C 与 32-33C bin 需要重点比较 edge。'
    }
  });

  await prisma.settledResult.create({
    data: {
      marketId: market.id,
      finalOutcomeLabel: '32-33C',
      finalValue: 32.4,
      settledAt: new Date(),
      sourceUrl: 'https://www.wunderground.com/history/daily/cn/shanghai/ZSPD'
    }
  });

  console.log('Seeded Shanghai decision platform');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
