import { prisma } from '@/lib/db';
import { toJsonString } from '@/lib/utils/json';
import { fromJsonString } from '@/lib/utils/json';
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

function shanghaiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

function previousShanghaiDate(date: Date) {
  const shLocal = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shLocal.setDate(shLocal.getDate() - 1);
  return shanghaiDateKey(shLocal);
}

function shanghaiDateEquals(a: Date, b: Date) {
  return shanghaiDateKey(a) === shanghaiDateKey(b);
}

function shanghaiDayRangeUtc(dateKey: string) {
  return {
    start: new Date(`${dateKey}T00:00:00+08:00`),
    end: new Date(`${dateKey}T23:59:59.999+08:00`)
  };
}

async function computeBiasAdjustedFusedTarget(sourceDailyMax?: {
  wundergroundDaily?: number | null;
  openMeteo?: number | null;
  wttr?: number | null;
  metNo?: number | null;
  weatherApi?: number | null;
  qWeather?: number | null;
  fused?: number | null;
} | null) {
  if (!sourceDailyMax) return null;
  const lookbackDays = Number(process.env.BIAS_LOOKBACK_DAYS ?? '30');
  const minTotalSamples = Number(process.env.BIAS_MIN_TOTAL_SAMPLES ?? '10');
  const minSourceSamples = Number(process.env.BIAS_MIN_SOURCE_SAMPLES ?? '3');
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const stats = await prisma.forecastSourceBias.groupBy({
    where: { capturedAt: { gte: since } },
    by: ['sourceCode'],
    _avg: { bias: true, absError: true },
    _count: { sourceCode: true }
  });
  const totalSamples = stats.reduce((acc, s) => acc + (s._count.sourceCode ?? 0), 0);
  if (totalSamples < minTotalSamples) {
    // Prevent overfitting before we have enough settled history.
    return null;
  }
  const byCode = new Map(stats.map((s) => [s.sourceCode, s]));
  const rows = [
    { code: 'wunderground_daily', raw: sourceDailyMax.wundergroundDaily },
    { code: 'open_meteo', raw: sourceDailyMax.openMeteo },
    { code: 'wttr', raw: sourceDailyMax.wttr },
    { code: 'met_no', raw: sourceDailyMax.metNo },
    { code: 'weatherapi', raw: sourceDailyMax.weatherApi },
    { code: 'qweather', raw: sourceDailyMax.qWeather }
  ].filter((r): r is { code: string; raw: number } => typeof r.raw === 'number' && Number.isFinite(r.raw));
  if (!rows.length) return null;
  const rowsWithHistory = rows.filter((r) => (byCode.get(r.code)?._count.sourceCode ?? 0) >= minSourceSamples);
  if (rowsWithHistory.length < 2) return null;

  let wSum = 0;
  let xwSum = 0;
  const breakdown: Array<{ code: string; raw: number; bias: number; mae: number; adjusted: number; weight: number; sampleSize: number; biasFactor: number; reliability: number }> = [];
  for (const r of rows) {
    const st = byCode.get(r.code);
    const bias = st?._avg.bias ?? 0;
    const mae = st?._avg.absError ?? 1.5;
    const sampleSize = st?._count.sourceCode ?? 0;
    const biasFactor = sampleSize / (sampleSize + 10);
    const adjusted = r.raw - bias * biasFactor;
    const reliability = 1 / (mae + 0.25);
    const weight = reliability * Math.max(0.1, biasFactor);
    breakdown.push({ code: r.code, raw: r.raw, bias, mae, adjusted, weight, sampleSize, biasFactor, reliability });
    wSum += weight;
    xwSum += adjusted * weight;
  }
  if (wSum <= 0) return null;
  return {
    fused: xwSum / wSum,
    breakdown
  };
}

async function recordForecastBiasFromPreviousDay(marketId: string, targetDate: Date, finalMax: number) {
  const prevKey = previousShanghaiDate(targetDate);
  const { start, end } = shanghaiDayRangeUtc(prevKey);
  const snap = await prisma.snapshot.findFirst({
    where: { marketId, capturedAt: { gte: start, lte: end } },
    orderBy: { capturedAt: 'desc' }
  });
  if (!snap) return;

  const weatherFeatures = fromJsonString<{
    sourceDailyMax?: {
      wundergroundDaily?: number | null;
      openMeteo?: number | null;
      wttr?: number | null;
      metNo?: number | null;
      weatherApi?: number | null;
      qWeather?: number | null;
    };
  }>(snap.weatherFeaturesJson, {});

  const max = weatherFeatures.sourceDailyMax;
  if (!max) return;

  const rows = [
    { sourceCode: 'wunderground_daily', sourceGroup: 'free', predictedMax: max.wundergroundDaily },
    { sourceCode: 'open_meteo', sourceGroup: 'free', predictedMax: max.openMeteo },
    { sourceCode: 'wttr', sourceGroup: 'free', predictedMax: max.wttr },
    { sourceCode: 'met_no', sourceGroup: 'free', predictedMax: max.metNo },
    { sourceCode: 'weatherapi', sourceGroup: 'paid', predictedMax: max.weatherApi },
    { sourceCode: 'qweather', sourceGroup: 'paid', predictedMax: max.qWeather }
  ].filter((r): r is { sourceCode: string; sourceGroup: string; predictedMax: number } => typeof r.predictedMax === 'number' && Number.isFinite(r.predictedMax));

  for (const row of rows) {
    const bias = row.predictedMax - finalMax;
    await prisma.forecastSourceBias.upsert({
      where: {
        marketId_sourceCode_forecastDate: {
          marketId,
          sourceCode: row.sourceCode,
          forecastDate: start
        }
      },
      create: {
        marketId,
        snapshotId: snap.id,
        sourceCode: row.sourceCode,
        sourceGroup: row.sourceGroup,
        forecastDate: start,
        capturedAt: snap.capturedAt,
        predictedMax: row.predictedMax,
        finalMax,
        bias,
        absError: Math.abs(bias)
      },
      update: {
        snapshotId: snap.id,
        capturedAt: snap.capturedAt,
        predictedMax: row.predictedMax,
        finalMax,
        bias,
        absError: Math.abs(bias)
      }
    });
  }
}

function enforceStrictWeatherSourceGate(
  decision: ReturnType<typeof runTradingDecision>,
  weatherRawJson: string | null
) {
  const weatherRaw = fromJsonString<{
    raw?: {
      strictReady?: boolean;
      strictRequiredSources?: string[];
      missingSources?: string[];
      openMeteo?: string | null;
      wttr?: string | null;
      metNo?: string | null;
      weatherapi?: string | null;
      qweather?: string | null;
      sourceDailyMax?: {
        wundergroundDaily?: number | null;
        openMeteo?: number | null;
        wttr?: number | null;
        metNo?: number | null;
        weatherApi?: number | null;
        qWeather?: number | null;
        cmaChina?: number | null;
      };
    };
  }>(weatherRawJson, {});

  const meta = weatherRaw.raw ?? {};
  const requiredFromMeta = Array.isArray(meta.strictRequiredSources) ? meta.strictRequiredSources : [];
  const statusMap: Record<string, boolean> = {
    open_meteo: meta.openMeteo === 'ok',
    wttr: meta.wttr === 'ok',
    met_no: meta.metNo === 'ok',
    weatherapi: meta.weatherapi === 'ok',
    qweather: meta.qweather === 'ok'
  };
  const sourceDailyMax = meta.sourceDailyMax;
  const inferredMissing = [
    sourceDailyMax?.wundergroundDaily == null ? 'wunderground_daily' : null,
    sourceDailyMax?.openMeteo == null ? 'open_meteo' : null,
    sourceDailyMax?.wttr == null ? 'wttr' : null,
    sourceDailyMax?.metNo == null ? 'met_no' : null,
    (sourceDailyMax?.weatherApi == null && sourceDailyMax?.qWeather == null && sourceDailyMax?.cmaChina == null) ? 'weatherapi' : null
  ].filter((x): x is string => Boolean(x));
  const missingByRequired = requiredFromMeta.length
    ? requiredFromMeta.filter((s) => statusMap[s] === false)
    : [];
  const missingSources = (meta.missingSources && meta.missingSources.length > 0)
    ? meta.missingSources
    : (missingByRequired.length ? missingByRequired : inferredMissing);
  const strictReady = typeof meta.strictReady === 'boolean' ? meta.strictReady : missingSources.length === 0;

  if (strictReady) return decision;

  const zh = `严格模式已触发：天气数据源不完整（缺失：${missingSources.join('、') || 'unknown'}），系统禁止给出交易推荐，强制 PASS，仓位为 0。`;
  const en = `Strict mode triggered: weather sources are incomplete (missing: ${missingSources.join(', ') || 'unknown'}). Trading recommendation is blocked, forced PASS with zero position.`;
  const mergedFlags = Array.from(new Set([...(decision.riskFlags ?? []), 'weather_source_incomplete', 'low_data_quality']));

  return {
    ...decision,
    decision: 'PASS' as const,
    tradeScore: 0,
    positionSize: 0,
    riskFlags: mergedFlags,
    reasonZh: zh,
    reasonEn: en,
    reason: `${zh}\nEN: ${en}`
  };
}

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
  await prisma.market.updateMany({
    where: {
      cityName: 'Shanghai',
      marketSlug: { not: m.marketSlug }
    },
    data: { isActive: false }
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
      weatherSnapshots: { orderBy: { id: 'desc' }, take: 1 }
    },
    orderBy: [{ isActive: 'desc' }, { targetDate: 'desc' }, { updatedAt: 'desc' }]
  });
  if (!market) return null;

  const weather = market.weatherSnapshots[0];
  if (!weather || !market.bins.length) return null;
  const weatherRaw = fromJsonString<{
    raw?: {
      sourceDailyMax?: { fused?: number | null };
      nowcasting?: {
        currentTemp?: number;
        todayMaxTemp?: number;
        tempRise1h?: number;
        tempRise2h?: number;
        tempRise3h?: number;
        cloudCover?: number;
        precipitationProb?: number;
        windSpeed?: number;
        futureHours?: Array<{ temp?: number }>;
        weatherMaturityScore?: number;
        scenarioTag?: string;
      };
      learnedPeakWindow?: {
        startHour?: number;
        endHour?: number;
        medianHour?: number;
        sampleDays?: number;
      };
    };
  }>(weather.rawJson, {});
  const sourceDailyMax = weatherRaw.raw?.sourceDailyMax as
    | {
        wundergroundDaily?: number | null;
        openMeteo?: number | null;
        wttr?: number | null;
        metNo?: number | null;
        weatherApi?: number | null;
        qWeather?: number | null;
        fused?: number | null;
      }
    | undefined;
  const nowcasting = weatherRaw.raw?.nowcasting;
  const learnedPeakWindow = weatherRaw.raw?.learnedPeakWindow;
  const biasAdjusted = await computeBiasAdjustedFusedTarget(sourceDailyMax ?? null);
  const fusedTargetMax = biasAdjusted?.fused ?? sourceDailyMax?.fused ?? weather.maxTempSoFar;
  const isTargetDateToday = shanghaiDateEquals(market.targetDate, new Date());

  const modelCurrentTemp = isTargetDateToday
    ? (nowcasting?.currentTemp ?? weather.temperature2m)
    : weather.temperature2m;
  const modelMaxTemp = fusedTargetMax;
  const modelTempRise1h = isTargetDateToday
    ? (nowcasting?.tempRise1h ?? weather.tempRise1h ?? 0)
    : (weather.tempRise1h ?? 0);
  const modelTempRise2h = isTargetDateToday
    ? (nowcasting?.tempRise2h ?? weather.tempRise2h ?? 0)
    : (weather.tempRise2h ?? 0);
  const modelTempRise3h = isTargetDateToday
    ? (nowcasting?.tempRise3h ?? weather.tempRise3h ?? 0)
    : (weather.tempRise3h ?? 0);
  const modelCloudCover = isTargetDateToday
    ? (nowcasting?.cloudCover ?? weather.cloudCover ?? 0)
    : (weather.cloudCover ?? 0);
  const modelPrecipProb = isTargetDateToday
    ? (nowcasting?.precipitationProb ?? ((weather.precipitation ?? 0) * 100))
    : ((weather.precipitation ?? 0) * 100);
  const modelWindSpeed = isTargetDateToday
    ? (nowcasting?.windSpeed ?? weather.windSpeed ?? 0)
    : (weather.windSpeed ?? 0);
  const todayMaxTemp = nowcasting?.todayMaxTemp ?? weather.maxTempSoFar;

  const probs = estimateBinProbabilities({
    bins: market.bins.map((b) => b.outcomeLabel),
    currentTemp: modelCurrentTemp,
    maxTempSoFar: modelMaxTemp,
    observedMaxTemp: todayMaxTemp,
    tempRise1h: modelTempRise1h,
    tempRise2h: modelTempRise2h,
    tempRise3h: modelTempRise3h,
    cloudCover: modelCloudCover,
    precipitationProb: modelPrecipProb,
    windSpeed: modelWindSpeed
  });

  const decision = runTradingDecision({
    now: new Date(),
    targetDate: market.targetDate,
    marketEndAt: market.targetDate,
    marketActive: market.isActive,
    observedMaxTemp: todayMaxTemp,
    futureTemp1h: nowcasting?.futureHours?.[0]?.temp,
    futureTemp2h: nowcasting?.futureHours?.[1]?.temp,
    futureTemp3h: nowcasting?.futureHours?.[2]?.temp,
    learnedPeakWindowStartHour: learnedPeakWindow?.startHour,
    learnedPeakWindowEndHour: learnedPeakWindow?.endHour,
    currentTemp: modelCurrentTemp,
    maxTempSoFar: modelMaxTemp,
    tempRise1h: modelTempRise1h,
    tempRise2h: modelTempRise2h,
    tempRise3h: modelTempRise3h,
    cloudCover: modelCloudCover,
    precipitationProb: modelPrecipProb,
    windSpeed: modelWindSpeed,
    weatherMaturityScore: nowcasting?.weatherMaturityScore,
    scenarioTag: nowcasting?.scenarioTag,
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
  const strictDecision = enforceStrictWeatherSourceGate(decision, weather.rawJson);
  const finalDecision = {
    ...strictDecision,
    decisionMode: 'realtime' as const,
    isDailyOfficial: false,
    dailyDateKey: shanghaiDateKey(new Date())
  };

  const modelRun = await prisma.modelRun.create({
    data: {
      marketId: market.id,
      modelVersion: MODEL_VERSION,
      bestBin: finalDecision.recommendedBin,
      edge: finalDecision.edge,
      tradeScore: finalDecision.tradeScore,
      decision: finalDecision.decision,
      recommendedPosition: finalDecision.positionSize,
      timingScore: finalDecision.timingScore,
      weatherScore: finalDecision.weatherScore,
      dataQualityScore: finalDecision.dataQualityScore,
      explanation: finalDecision.reason,
      riskFlagsJson: toJsonString(finalDecision.riskFlags),
      rawFeaturesJson: toJsonString({
        currentTemp: modelCurrentTemp,
        maxTempSoFar: modelMaxTemp,
        todayMaxTemp,
        isTargetDateToday,
        recommendedSide: finalDecision.recommendedSide,
        reasonZh: finalDecision.reasonZh,
        reasonEn: finalDecision.reasonEn,
        weatherMaturityScore: nowcasting?.weatherMaturityScore ?? null,
        scenarioTag: nowcasting?.scenarioTag ?? null,
        learnedPeakWindow: learnedPeakWindow ?? null,
        calibratedFusedTemp: fusedTargetMax,
        sourceCalibration: biasAdjusted?.breakdown ?? [],
        dailyDecision: {
          mode: 'realtime',
          isOfficial: false,
          dateKey: shanghaiDateKey(new Date()),
          lockAt: null
        }
      }),
      outputs: {
        create: finalDecision.binOutputs.map((o) => ({
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
        windSpeed: weather.windSpeed,
        nowcasting: weatherRaw.raw?.nowcasting ?? null,
        sourceDailyMax: fromJsonString<{ raw?: { sourceDailyMax?: unknown } }>(weather.rawJson, {}).raw?.sourceDailyMax ?? null,
        sourceStatus: fromJsonString<{ raw?: { openMeteo?: string | null; wttr?: string | null; metNo?: string | null; weatherapi?: string | null; qweather?: string | null } }>(weather.rawJson, {}).raw ?? null
      }),
      modelOutputJson: toJsonString(modelRun.outputs),
      tradingOutputJson: toJsonString(finalDecision),
      explanationText: finalDecision.reason,
      riskFlagsJson: toJsonString(finalDecision.riskFlags)
    }
  });

  return { market, weather, modelRun, decision: finalDecision };
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
    if (!market.bins.length) continue;
    const tempBinCount = market.bins
      .map((b) => parseTemperatureBin(b.outcomeLabel))
      .filter((x) => x.min != null || x.max != null).length;
    if (tempBinCount < 2) continue;

    let roundedFinalTemp: number;
    let settledSourceUrl: string;
    if (market.settledResult) {
      roundedFinalTemp = Math.round(market.settledResult.finalValue);
      settledSourceUrl = market.settledResult.sourceUrl;
    } else {
      const stationCode = market.resolutionMetadata?.stationCode || 'ZSPD';
      const settled = await fetchWundergroundSettledMaxTemp({
        targetDate: market.targetDate,
        stationCode
      });
      roundedFinalTemp = Math.round(settled.maxTempC);
      settledSourceUrl = settled.sourceUrl;
    }
    const outcome = pickWinningBinLabel(market.bins.map((b) => b.outcomeLabel), roundedFinalTemp);

    await prisma.settledResult.upsert({
      where: { marketId: market.id },
      create: {
        marketId: market.id,
        finalOutcomeLabel: outcome,
        finalValue: roundedFinalTemp,
        settledAt: new Date(),
        sourceUrl: settledSourceUrl
      },
      update: {
        finalOutcomeLabel: outcome,
        finalValue: roundedFinalTemp,
        settledAt: new Date(),
        sourceUrl: settledSourceUrl
      }
    });

    await prisma.market.update({
      where: { id: market.id },
      data: { isActive: false }
    });
    await recordForecastBiasFromPreviousDay(market.id, market.targetDate, roundedFinalTemp);

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
