import { prisma } from '@/lib/db';
import { toJsonString } from '@/lib/utils/json';
import { fromJsonString } from '@/lib/utils/json';
import { fetchMarketByLocation } from '@/lib/services/polymarket-by-location';
import { parseResolutionMetadata } from '@/lib/services/resolution-parser';
import { fetchWeatherAssistByLocation } from '@/lib/services/weather-assist';
import { fetchWundergroundSettledMaxTemp } from '@/lib/services/wunderground-settlement';
import { refreshWuApiKey } from '@/lib/services/wu-apikey-refresh';
import { targetDayEndSettlementAt } from '@/lib/utils/market-time';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';
import { resolvePipelineRequest, type PipelineRequest } from '@/lib/config/pipeline-request';
import { estimateProjectedFinalTemperature } from '@/src/lib/trading-engine/model';
import { computeConstraintBounds } from '@/src/lib/trading-engine/constraints';
import {
  pickMostLikelyInteger
} from '@/src/lib/trading-engine/settlementMapping';
import { runProbabilityEngine } from '@/src/lib/probability-engine';
import { liveToProbabilityInput } from '@/src/lib/adapters/live-to-engine';
import { loadModelConfig, resolveModelParamsForBucket } from '@/src/lib/model-config';
import type { CertaintyReason, CertaintySummary, CertaintyType } from '@/src/lib/explainability/types';
import { MODEL_BASELINE_VERSION } from '@/src/lib/explainability/baseline';
import { runTradingDecision } from '@/src/lib/trading-engine/tradingEngine';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { calculateWundergroundFreshnessThresholdMinutes } from '@/src/lib/weather/wunderground-cadence';
import { Prisma } from '@prisma/client';
import type { SnapshotBucket } from '@/src/lib/backtest/types';
import {
  bucketHoursToPeak,
  bucketObservedVsMuGap
} from '@/src/lib/trading-engine/delta-distribution';

function marketWhereByLocation(locationKey: SupportedLocationKey): Prisma.MarketWhereInput {
  const cfg = getLocationConfig(locationKey);
  return {
    cityName: cfg.market.cityName,
    OR: [
      { marketSlug: { contains: cfg.market.slugKeyword } },
      { marketTitle: { contains: cfg.market.titleKeyword } }
    ]
  };
}

function localDateKey(date: Date, timezone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

function previousLocalDate(date: Date, timezone = 'Asia/Shanghai') {
  const shLocal = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  shLocal.setDate(shLocal.getDate() - 1);
  return localDateKey(shLocal, timezone);
}

function localDateEquals(a: Date, b: Date, timezone = 'Asia/Shanghai') {
  return localDateKey(a, timezone) === localDateKey(b, timezone);
}

function localHourNow(date: Date, timezone = 'Asia/Shanghai') {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit'
    }).format(date),
  );
}

function snapshotBucketFromHour(hour: number): SnapshotBucket {
  if (hour < 10) return '08';
  if (hour < 13) return '11';
  if (hour < 16) return '14';
  return 'late';
}

function summarizeCertainty(params: {
  maxModelProb: number;
  lowerBound?: number;
  upperBound?: number;
  observedMax?: number | null;
  currentTemp?: number | null;
  remainingCap?: number;
  spreadSigmaRaw?: number;
}): CertaintySummary {
  // Explainability layer only:
  // this summary is for UI/debug interpretation and is intentionally decoupled
  // from BUY/WATCH/PASS rule evaluation.
  const reasons: CertaintyReason[] = [];
  const l = Number.isFinite(params.lowerBound) ? Number(params.lowerBound) : undefined;
  const u = Number.isFinite(params.upperBound) ? Number(params.upperBound) : undefined;
  const width = l != null && u != null && u > l ? u - l : undefined;
  if (width != null && width <= 0.9) reasons.push('narrow_truncation_window');
  if (typeof params.remainingCap === 'number' && params.remainingCap <= 0.8) reasons.push('tight_upside_cap');
  if (
    typeof params.observedMax === 'number' &&
    typeof params.currentTemp === 'number' &&
    params.observedMax >= params.currentTemp - 0.2
  ) reasons.push('observed_floor_active');
  if (typeof params.spreadSigmaRaw === 'number' && params.spreadSigmaRaw <= 0.35) reasons.push('high_source_consensus');

  const isStructuralCertainty = params.maxModelProb >= 0.95 && reasons.length > 0;
  const isModelCertainty = params.maxModelProb >= 0.95 && reasons.length === 0;
  const certaintyType: CertaintyType =
    isStructuralCertainty ? 'structural' : isModelCertainty ? 'model' : 'mixed';
  const summaryZh = isStructuralCertainty
    ? `高置信主要来自结构性约束：${reasons.join(' + ')}。`
    : isModelCertainty
      ? '高置信主要来自模型形状，缺少结构性约束支撑。'
      : '当前不属于结构性高置信。';
  const summaryEn = isStructuralCertainty
    ? `High confidence is structural: ${reasons.join(' + ')}.`
    : isModelCertainty
      ? 'High confidence is mainly model-shaped without strong structural constraints.'
      : 'No structural certainty signal.';

  return {
    isStructuralCertainty,
    structuralReasons: reasons,
    certaintyType,
    summaryZh,
    summaryEn,
    widthFromL: width ?? null
  };
}

function localDayRangeUtc(dateKey: string, timezone = 'Asia/Shanghai') {
  const offset = timezone === 'Asia/Hong_Kong' ? '+08:00' : '+08:00';
  return {
    start: new Date(`${dateKey}T00:00:00${offset}`),
    end: new Date(`${dateKey}T23:59:59.999${offset}`)
  };
}

function localDayDateFilter(dateKey: string, timezone = 'Asia/Shanghai') {
  const { start, end } = localDayRangeUtc(dateKey, timezone);
  return { gte: start, lte: end };
}

async function computeBiasAdjustedFusedTarget(sourceDailyMax?: {
  wundergroundDaily?: number | null;
  nwsHourly?: number | null;
  openMeteo?: number | null;
  wttr?: number | null;
  metNo?: number | null;
  weatherApi?: number | null;
  qWeather?: number | null;
  fused?: number | null;
} | null) {
  if (!sourceDailyMax) return null;
  const enableBiasCalibration = (process.env.ENABLE_BIAS_CALIBRATION ?? 'false').toLowerCase() === 'true';
  if (!enableBiasCalibration) return null;
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
    { code: 'nws_hourly', raw: sourceDailyMax.nwsHourly },
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

async function recordForecastBiasFromPreviousDay(
  marketId: string,
  targetDate: Date,
  finalMax: number,
  timezone = 'Asia/Shanghai'
) {
  const prevKey = previousLocalDate(targetDate, timezone);
  const { start, end } = localDayRangeUtc(prevKey, timezone);
  const snap = await prisma.snapshot.findFirst({
    where: { marketId, capturedAt: { gte: start, lte: end } },
    orderBy: { capturedAt: 'desc' }
  });
  if (!snap) return;

  const weatherFeatures = fromJsonString<{
    sourceDailyMax?: {
      wundergroundDaily?: number | null;
      nwsHourly?: number | null;
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
    { sourceCode: 'nws_hourly', sourceGroup: 'free', predictedMax: max.nwsHourly },
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

export function enforceStrictWeatherSourceGate(
  decision: ReturnType<typeof runTradingDecision>,
  weatherRawJson: string | null
) {
  const weatherRaw = fromJsonString<{
    raw?: {
      strictReady?: boolean;
      strictRequiredSources?: string[];
      missingSources?: string[];
      openMeteo?: string | null;
      nwsHourly?: string | null;
      aviationweather?: string | null;
      wttr?: string | null;
      metNo?: string | null;
      weatherapi?: string | null;
      qweather?: string | null;
      sourceDailyMax?: {
        wundergroundDaily?: number | null;
        openMeteo?: number | null;
        nwsHourly?: number | null;
        wttr?: number | null;
        metNo?: number | null;
        weatherApi?: number | null;
        qWeather?: number | null;
        cmaChina?: number | null;
      };
    };
  }>(weatherRawJson, {});

  const meta = weatherRaw.raw ?? {};
  const apiStatus = (meta as {
    apiStatus?: Record<string, { status?: string; criticality?: 'settlement_critical' | 'supporting' }>;
  }).apiStatus ?? {};
  const sourceDailyMax = meta.sourceDailyMax;
  // Decision-layer strict gate:
  // supporting sources must not block BUY/WATCH/PASS output.
  // Only settlement-critical source failures are allowed to force PASS.
  const missingSourcesFromApiStatus = Object.entries(apiStatus)
    .filter(([, v]) => v?.criticality === 'settlement_critical' && v?.status !== 'ok')
    .map(([k]) => k);
  const fallbackSettlementMissing =
    missingSourcesFromApiStatus.length === 0 && sourceDailyMax?.wundergroundDaily == null
      ? ['wunderground_daily']
      : [];
  const missingSources = [...missingSourcesFromApiStatus, ...fallbackSettlementMissing];
  const strictReady = missingSources.length === 0;

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

export function enforceWeatherFreshnessGate(
  decision: ReturnType<typeof runTradingDecision>,
  weatherRawJson: string | null,
  now = new Date()
) {
  const maxStaleMinutes = Number(process.env.WEATHER_STALE_MINUTES ?? '15');
  if (!Number.isFinite(maxStaleMinutes) || maxStaleMinutes <= 0) return decision;
  const cadenceGraceMinutes = Number(process.env.WEATHER_WU_CADENCE_GRACE_MINUTES ?? '4');

  const weatherRaw = fromJsonString<{
    raw?: {
      fetchedAtIso?: string;
      nowcasting?: { observedAt?: string };
    };
  }>(weatherRawJson, {});
  const fetchedAtIso = weatherRaw.raw?.fetchedAtIso ?? null;
  const observedAtIso = weatherRaw.raw?.nowcasting?.observedAt ?? null;
  const baselineIso = observedAtIso ?? fetchedAtIso;
  if (!baselineIso) return decision;

  const baseTs = new Date(baselineIso).getTime();
  if (!Number.isFinite(baseTs)) return decision;
  const staleMinutes = (now.getTime() - baseTs) / 60000;
  if (!Number.isFinite(staleMinutes)) return decision;
  const effectiveThreshold = calculateWundergroundFreshnessThresholdMinutes({
    observedAt: new Date(baseTs),
    cadenceGraceMinutes,
    fallbackMaxStaleMinutes: maxStaleMinutes
  });
  if (staleMinutes <= effectiveThreshold) return decision;

  const staleRounded = Math.round(staleMinutes);
  const thresholdRounded = Math.round(effectiveThreshold);
  const zh = `天气数据新鲜度不足（已过 ${staleRounded} 分钟，阈值 ${thresholdRounded} 分钟），系统禁止给出交易推荐，强制 PASS，仓位为 0。`;
  const en = `Weather data is stale (${staleRounded} min old, threshold ${thresholdRounded} min). Trading recommendation is blocked, forced PASS with zero position.`;
  const mergedFlags = Array.from(new Set([...(decision.riskFlags ?? []), 'weather_data_stale', 'low_data_quality']));
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

export function enforceDateAlignmentGate(
  decision: ReturnType<typeof runTradingDecision>,
  marketTargetDate: Date,
  weatherRawJson: string | null,
  timezone = 'Asia/Shanghai'
) {
  const weatherRaw = fromJsonString<{
    raw?: {
      targetDate?: string;
    };
  }>(weatherRawJson, {});
  const weatherTargetDate = weatherRaw.raw?.targetDate ?? null;
  const marketTargetKey = localDateKey(marketTargetDate, timezone);
  if (!weatherTargetDate || weatherTargetDate === marketTargetKey) return decision;

  const zh = `检测到目标日不一致：market=${marketTargetKey}, weather=${weatherTargetDate}。系统禁止给出交易推荐，强制 PASS，仓位为 0。`;
  const en = `Target date mismatch detected: market=${marketTargetKey}, weather=${weatherTargetDate}. Trading recommendation is blocked, forced PASS with zero position.`;
  const mergedFlags = Array.from(new Set([...(decision.riskFlags ?? []), 'weather_market_date_mismatch', 'low_data_quality']));
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

export function enforceWuFutureHoursGate(
  decision: ReturnType<typeof runTradingDecision>,
  params: {
    isTargetDateToday: boolean;
    nowcastingFutureHours?: Array<{ temp?: number | null }> | null;
  }
) {
  if (!params.isTargetDateToday) return decision;
  const future = Array.isArray(params.nowcastingFutureHours) ? params.nowcastingFutureHours : [];
  if (future.length > 0) return decision;

  const zh = 'Wunderground 短临 futureHours 缺失，已按策略中断实时判断并强制 PASS（仓位为 0）。';
  const en = 'Wunderground nowcasting futureHours is missing. Realtime decision flow is interrupted and forced to PASS (position = 0).';
  const mergedFlags = Array.from(new Set([...(decision.riskFlags ?? []), 'wu_future_hours_missing', 'short_term_unavailable']));
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

export async function refreshMarketData(request?: PipelineRequest) {
  const resolved = resolvePipelineRequest(request);
  const locationCfg = getLocationConfig(resolved.locationKey);
  const marketRes = await fetchMarketByLocation({
    locationKey: resolved.locationKey,
    targetDateKey: resolved.targetDate
  });
  const m = marketRes.data;

  const market = await prisma.market.upsert({
    where: { marketSlug: m.marketSlug },
    create: {
      cityName: locationCfg.market.cityName,
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
  // Do not force-close other Shanghai markets locally.
  // Polymarket may have overlapping tradable markets across adjacent dates,
  // and forcibly setting others to inactive can create false PASS decisions.

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

export async function refreshWeatherData(request?: PipelineRequest) {
  const resolved = resolvePipelineRequest(request);
  const targetWhere = resolved.targetDate ? { targetDate: localDayDateFilter(resolved.targetDate, resolved.timezone) } : {};
  const market = await prisma.market.findFirst({
    where: { ...marketWhereByLocation(resolved.locationKey), ...targetWhere, isActive: true },
    orderBy: [{ targetDate: 'desc' }, { updatedAt: 'desc' }]
  });
  if (!market) return null;

  let weatherRes = await fetchWeatherAssistByLocation(resolved.locationKey, market.targetDate, market.id);
  let w = weatherRes.data;

  const sourceStatus = (w.raw as {
    sourceStatus?: {
      apiStatus?: {
        wunderground?: { status?: string };
        wunderground_daily?: { status?: string };
      };
    };
  } | undefined)?.sourceStatus;

  const wuNowStatus = sourceStatus?.apiStatus?.wunderground?.status;
  const wuDailyStatus = sourceStatus?.apiStatus?.wunderground_daily?.status;
  const missingWuKey = !(process.env.WUNDERGROUND_API_KEY?.trim());
  const wuFetchFailed = wuNowStatus === 'fetch_error' || wuDailyStatus === 'fetch_error';

  // Auto-recover path:
  // when WU failed and no configured key exists, try refreshing key once and refetch weather.
  if (missingWuKey && wuFetchFailed) {
    const cfg = getLocationConfig(resolved.locationKey);
    const refreshed = await refreshWuApiKey({
      stationCode: cfg.weather.stationCode,
      stationPath: cfg.weather.wundergroundHistoryPath,
      latitude: cfg.lat,
      longitude: cfg.lon,
      persistEnv: true,
      force: false
    });
    if (refreshed.ok) {
      weatherRes = await fetchWeatherAssistByLocation(resolved.locationKey, market.targetDate, market.id);
      w = weatherRes.data;
    }
  }

  const weatherTargetDate = (w.raw as { targetDate?: string } | undefined)?.targetDate;
  const marketTargetDate = localDateKey(market.targetDate, resolved.timezone);
  if (weatherTargetDate && weatherTargetDate !== marketTargetDate) {
    throw new Error(`天气数据日期不一致：weather=${weatherTargetDate}, market=${marketTargetDate}`);
  }

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
      rawJson: toJsonString({ source: weatherRes.source, raw: { ...(w.raw ?? {}), fetchedAtIso: new Date().toISOString() } })
    }
  });
}

export async function runModelAndDecision(
  totalCapital = 10000,
  maxSingleTradePercent = 0.1,
  request?: PipelineRequest
) {
  const resolved = resolvePipelineRequest(request);
  const targetWhere = resolved.targetDate ? { targetDate: localDayDateFilter(resolved.targetDate, resolved.timezone) } : {};
  const market = await prisma.market.findFirst({
    where: { ...marketWhereByLocation(resolved.locationKey), ...targetWhere },
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
  const marketRawMeta = fromJsonString<{ isActive?: boolean }>(market.rawJson, {});
  const marketActiveEffective = typeof marketRawMeta.isActive === 'boolean' ? marketRawMeta.isActive : market.isActive;
  const priorBuyCount = await prisma.modelRun.count({
    where: { marketId: market.id, decision: 'BUY' }
  });
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
      strictReady?: boolean;
      fetchedAtIso?: string;
      sourceHealth?: Record<string, { healthScore?: number; status?: string }>;
      forecastExplain?: {
        outcomeProbabilities?: Array<{ label?: string; probability?: number }>;
        weightBreakdown?: Array<{ adjusted?: number; weight?: number }>;
      };
    };
  }>(weather.rawJson, {});
  const sourceDailyMax = weatherRaw.raw?.sourceDailyMax as
      | {
        wundergroundDaily?: number | null;
        nwsHourly?: number | null;
        openMeteo?: number | null;
        wttr?: number | null;
        metNo?: number | null;
        weatherApi?: number | null;
        qWeather?: number | null;
        spread?: number | null;
        fusedContinuous?: number | null;
        fusedAnchor?: number | null;
        fused?: number | null;
      }
    | undefined;
  const nowcasting = weatherRaw.raw?.nowcasting;
  const learnedPeakWindow = weatherRaw.raw?.learnedPeakWindow;
  const weatherFreshnessHours = (() => {
    const ts = weatherRaw.raw?.fetchedAtIso ? new Date(weatherRaw.raw.fetchedAtIso).getTime() : NaN;
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, (Date.now() - ts) / 3600000);
  })();
  const avgSourceHealthScore = (() => {
    const rows = Object.values(weatherRaw.raw?.sourceHealth ?? {});
    if (!rows.length) return null;
    const vals = rows.map((x) => x?.healthScore).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();
  const biasAdjusted = await computeBiasAdjustedFusedTarget(sourceDailyMax ?? null);
  const fusedContinuous = biasAdjusted?.fused ?? sourceDailyMax?.fusedContinuous ?? sourceDailyMax?.fused ?? weather.maxTempSoFar;
  const fusedAnchor = sourceDailyMax?.fusedAnchor ?? Math.round(fusedContinuous);
  const isTargetDateToday = resolved.isTargetDateToday;

  const modelCurrentTemp = isTargetDateToday
    ? (nowcasting?.currentTemp ?? weather.temperature2m)
    : weather.temperature2m;
  // Decision summary uses settlement-aligned integer anchor.
  const modelMaxTemp = fusedAnchor;
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
  const observedMaxCandidates = isTargetDateToday
    ? [nowcasting?.todayMaxTemp, weather.maxTempSoFar, modelCurrentTemp]
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
  const observedMaxSource =
    isTargetDateToday && observedMaxCandidates.length > 0
      ? (nowcasting?.todayMaxTemp != null &&
          Number.isFinite(nowcasting.todayMaxTemp) &&
          nowcasting.todayMaxTemp >= weather.maxTempSoFar &&
          nowcasting.todayMaxTemp >= modelCurrentTemp
          ? 'nowcasting.todayMaxTemp'
          : weather.maxTempSoFar >= modelCurrentTemp
            ? 'weather.maxTempSoFar'
            : 'currentTemp_floor')
      : null;
  // Use a single monotonic floor source to avoid L/U jitter between adjacent refreshes.
  // We intentionally take the strongest observed value among nowcasting / weather snapshot / current temp.
  const todayMaxTempStable = observedMaxCandidates.length
    ? Math.max(...observedMaxCandidates)
    : undefined;
  const sourceSpread = sourceDailyMax?.spread;
  const modelConfig = loadModelConfig();

  // Legacy diagnostic projection only.
  // IMPORTANT: this output is NOT fed into runProbabilityEngine(mu/sigma).
  // Production distribution is built by: live adapter (mu/sigma) + constraints (L/U).
  const projectedContinuous = estimateProjectedFinalTemperature({
    currentTemp: modelCurrentTemp,
    maxTempSoFar: isTargetDateToday ? (todayMaxTempStable ?? modelCurrentTemp) : modelCurrentTemp,
    observedMaxTemp: todayMaxTempStable,
    forecastAnchorTemp: fusedAnchor,
    isTargetDateToday,
    nowHourLocal: localHourNow(new Date(), resolved.timezone),
    peakWindowStartHour: learnedPeakWindow?.startHour,
    futureTemp1h: nowcasting?.futureHours?.[0]?.temp,
    futureTemp2h: nowcasting?.futureHours?.[1]?.temp,
    futureTemp3h: nowcasting?.futureHours?.[2]?.temp,
    tempRise1h: modelTempRise1h,
    tempRise2h: modelTempRise2h,
    tempRise3h: modelTempRise3h,
    cloudCover: modelCloudCover,
    precipitationProb: modelPrecipProb,
    windSpeed: modelWindSpeed
  });
  const nowHourLocal = localHourNow(new Date(), resolved.timezone);
  const snapshotBucket = snapshotBucketFromHour(nowHourLocal);
  const learnedStartHour = Number.isFinite(learnedPeakWindow?.startHour) ? Number(learnedPeakWindow?.startHour) : 13;
  const learnedEndHour = Number.isFinite(learnedPeakWindow?.endHour) ? Number(learnedPeakWindow?.endHour) : 16;
  const peakHourLocal = (learnedStartHour + learnedEndHour) / 2;
  const hoursToPeak = peakHourLocal - nowHourLocal;
  const observedVsMuGap = isTargetDateToday && typeof todayMaxTempStable === 'number'
    ? Math.abs(todayMaxTempStable - fusedContinuous)
    : 0;
  const resolvedModelParams = resolveModelParamsForBucket({
    bucket: snapshotBucket,
    modelConfig,
    context: {
      snapshotBucket,
      hoursToPeakBucket: bucketHoursToPeak(hoursToPeak),
      observedVsMuGapBucket: bucketObservedVsMuGap(observedVsMuGap)
    }
  });
  // Future 1-6h temps are passed only into computeConstraintBounds
  // to derive bounding constraints (e.g. maxFutureTemp / upper bound).
  // They are intentionally excluded from direct mu/sigma shaping.
  const futureTemps = (nowcasting?.futureHours ?? [])
    .slice(0, 12)
    .map((x) => x.temp)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const constraints = computeConstraintBounds({
    isTargetDateToday,
    nowHourLocal,
    snapshotBucket,
    learnedPeakWindowStartHour: learnedStartHour,
    learnedPeakWindowEndHour: learnedEndHour,
    observedMaxTemp: isTargetDateToday ? todayMaxTempStable : undefined,
    currentTemp: modelCurrentTemp,
    futureTemps1To6h: isTargetDateToday ? futureTemps : [],
    cloudCover: modelCloudCover,
    windSpeed: modelWindSpeed,
    peakHourLocal,
    observedVsMuGap,
    deltaDistribution: resolvedModelParams.remainingCapDistribution
      ? {
        key: resolvedModelParams.remainingCapDistribution.key,
        q25: resolvedModelParams.remainingCapDistribution.q25,
        q50: resolvedModelParams.remainingCapDistribution.q50,
        q75: resolvedModelParams.remainingCapDistribution.q75,
        q90: resolvedModelParams.remainingCapDistribution.q90,
        q95: resolvedModelParams.remainingCapDistribution.q95,
        mean: resolvedModelParams.remainingCapDistribution.mean,
        std: resolvedModelParams.remainingCapDistribution.std,
        count: resolvedModelParams.remainingCapDistribution.count
      }
      : undefined
  });
  const finalMinAllowedInteger = constraints.minAllowedInteger;
  let maxContinuousForEngine = constraints.maxContinuous;
  let upperBoundStabilization:
    | 'none'
    | 'pre_late_soft_tail_relax_applied'
    | 'pre_late_soft_tail_not_needed' = 'none';
  // Before late-session, keep U from becoming overly tight; otherwise right-tail bins
  // can be mechanically zeroed even when fused forecast still supports mild upside.
  if (
    isTargetDateToday &&
    nowHourLocal < learnedEndHour &&
    typeof todayMaxTempStable === 'number' &&
    Number.isFinite(todayMaxTempStable) &&
    typeof fusedContinuous === 'number' &&
    Number.isFinite(fusedContinuous)
  ) {
    const spreadHint = typeof sourceSpread === 'number' && Number.isFinite(sourceSpread) ? sourceSpread : 1.2;
    const sigmaHint = Math.max(0.9, Math.min(1.35, 0.8 + spreadHint * 0.18));
    const modelTailUpper = fusedContinuous + Math.max(0.55, sigmaHint * 0.55);
    const absoluteUpperCap = todayMaxTempStable + 3.2;
    const relaxedUpper = Math.min(absoluteUpperCap, modelTailUpper);
    const rawUpper = constraints.maxContinuous;
    if (typeof rawUpper === 'number' && Number.isFinite(rawUpper)) {
      if (relaxedUpper > rawUpper) {
        maxContinuousForEngine = relaxedUpper;
        upperBoundStabilization = 'pre_late_soft_tail_relax_applied';
      } else {
        upperBoundStabilization = 'pre_late_soft_tail_not_needed';
      }
    } else {
      maxContinuousForEngine = relaxedUpper;
      upperBoundStabilization = 'pre_late_soft_tail_relax_applied';
    }
  }
  if (
    typeof constraints.minContinuous === 'number' &&
    Number.isFinite(constraints.minContinuous) &&
    typeof maxContinuousForEngine === 'number' &&
    Number.isFinite(maxContinuousForEngine) &&
    maxContinuousForEngine <= constraints.minContinuous
  ) {
    maxContinuousForEngine = constraints.minContinuous + 0.5;
  }
  const maxAllowedInteger =
    typeof maxContinuousForEngine === 'number' && Number.isFinite(maxContinuousForEngine)
      ? Math.floor(maxContinuousForEngine + 0.5)
      : constraints.maxAllowedInteger;
  const beforePeak = isTargetDateToday && nowHourLocal < learnedStartHour;
  const useAsymmetricSigma = (process.env.ENABLE_ASYMMETRIC_SIGMA ?? 'false').toLowerCase() === 'true';
  const distributionMean = isTargetDateToday
    ? Math.max(fusedContinuous, todayMaxTempStable ?? Number.NEGATIVE_INFINITY)
    : fusedContinuous;
  const liveAdapted = liveToProbabilityInput({
    locationKey: resolved.locationKey,
    targetDateKey: resolved.targetDate,
    isTargetDateToday: resolved.isTargetDateToday,
    isFutureDate: resolved.isFutureDate,
    dayOffset: resolved.dayOffset,
    snapshotTime: `${String(nowHourLocal).padStart(2, '0')}:00`,
    marketBins: market.bins.map((b) => ({
      label: b.outcomeLabel,
      marketPrice: b.marketPrice,
      noMarketPrice: b.noMarketPrice ?? undefined,
      bestBid: b.bestBid ?? undefined
    })),
    sourceDailyMax,
    observedMaxSoFar: isTargetDateToday ? todayMaxTempStable : undefined,
    currentTemp: modelCurrentTemp,
    cloudCover: modelCloudCover,
    windSpeed: modelWindSpeed,
    rainProb: modelPrecipProb,
    constraints: {
      minContinuous: constraints.minContinuous,
      maxContinuous: maxContinuousForEngine,
      minAllowedInteger: finalMinAllowedInteger,
      maxAllowedInteger,
      deltaConstraint:
        isTargetDateToday &&
        typeof todayMaxTempStable === 'number' &&
        Number.isFinite(todayMaxTempStable) &&
        constraints.debugSummary.deltaQ50 != null &&
        constraints.debugSummary.deltaStd != null &&
        constraints.debugSummary.deltaQ95 != null
          ? {
            observedMax: todayMaxTempStable,
            deltaMean: Math.max(0.01, Number(constraints.debugSummary.deltaQ50)),
            deltaStd: Math.max(0.35, Number(constraints.debugSummary.deltaStd)),
            deltaUpper: Math.max(0.2, Number(constraints.debugSummary.deltaQ95)),
            source: constraints.debugSummary.remainingCapSource === 'distribution'
              ? 'distribution'
              : constraints.debugSummary.remainingCapSource === 'distribution_fallback'
                ? 'distribution_fallback'
                : 'none'
          }
          : undefined
    },
    fallbackMean: distributionMean,
    fallbackSigma: typeof sourceSpread === 'number' && Number.isFinite(sourceSpread)
      ? Math.max(0.75, Math.min(1.6, 0.78 + sourceSpread * 0.17))
      : 1.05,
    modelConfig
  });
  // Optional asymmetry toggle remains experimental and applied on top of unified adapter output.
  if (useAsymmetricSigma && beforePeak) {
    liveAdapted.engineInput.distribution.sigmaBelowMean = liveAdapted.debug.finalSigma * 0.92;
    liveAdapted.engineInput.distribution.sigmaAboveMean = liveAdapted.debug.finalSigma * 1.08;
  }
  const probabilityOutput = runProbabilityEngine({
    ...liveAdapted.engineInput
  });
  const integerDistribution = probabilityOutput.integerDistribution;
  const distributionDebug = {
    ...probabilityOutput.debugSummary,
    liveAdapter: liveAdapted.debug
  };
  const settlementMean = integerDistribution.reduce((acc, r) => acc + r.temp * r.probability, 0);
  const probs = probabilityOutput.binProbabilities;
  const maxModelProb = probs.length ? Math.max(...probs) : 0;
  const probByLabel = new Map(
    market.bins.map((b, i) => [b.outcomeLabel, probs[i] ?? 0] as const)
  );
  const mostLikelyInteger = pickMostLikelyInteger(integerDistribution);

  const decision = runTradingDecision({
    now: new Date(),
    targetDate: market.targetDate,
    marketEndAt: targetDayEndSettlementAt(market.targetDate),
    marketActive: marketActiveEffective,
    observedMaxTemp: isTargetDateToday ? todayMaxTempStable : undefined,
    futureTemp1h: isTargetDateToday ? nowcasting?.futureHours?.[0]?.temp : undefined,
    futureTemp2h: isTargetDateToday ? nowcasting?.futureHours?.[1]?.temp : undefined,
    futureTemp3h: isTargetDateToday ? nowcasting?.futureHours?.[2]?.temp : undefined,
    futureTemp4h: isTargetDateToday ? nowcasting?.futureHours?.[3]?.temp : undefined,
    futureTemp5h: isTargetDateToday ? nowcasting?.futureHours?.[4]?.temp : undefined,
    futureTemp6h: isTargetDateToday ? nowcasting?.futureHours?.[5]?.temp : undefined,
    learnedPeakWindowStartHour: learnedPeakWindow?.startHour,
    learnedPeakWindowEndHour: learnedPeakWindow?.endHour,
    currentTemp: modelCurrentTemp,
    // Keep decision forecast anchor aligned with model panel (fused settlement anchor),
    // instead of using post-constraint most-likely integer from distribution.
    maxTempSoFar: modelMaxTemp,
    tempRise1h: modelTempRise1h,
    tempRise2h: modelTempRise2h,
    tempRise3h: modelTempRise3h,
    cloudCover: modelCloudCover,
    precipitationProb: modelPrecipProb,
    windSpeed: modelWindSpeed,
    weatherMaturityScore: nowcasting?.weatherMaturityScore,
    scenarioTag: nowcasting?.scenarioTag,
    marketConsensusBin: market.bins.slice().sort((a, b) => b.marketPrice - a.marketPrice)[0]?.outcomeLabel,
    marketConsensusPrice: market.bins.slice().sort((a, b) => b.marketPrice - a.marketPrice)[0]?.marketPrice,
    entryCountForTargetDate: priorBuyCount,
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
    rulesParsed: Boolean(market.resolutionMetadata?.stationCode),
    hasCompleteSources: weatherRaw.raw?.strictReady ?? true,
    weatherFreshnessHours,
    avgSourceHealthScore,
    totalCapital,
    maxSingleTradePercent
  });
  const alignmentGatedDecision = enforceDateAlignmentGate(decision, market.targetDate, weather.rawJson, resolved.timezone);
  const freshnessGatedDecision = enforceWeatherFreshnessGate(alignmentGatedDecision, weather.rawJson);
  const strictDecision = enforceStrictWeatherSourceGate(freshnessGatedDecision, weather.rawJson);
  const wuFutureGatedDecision = enforceWuFutureHoursGate(strictDecision, {
    isTargetDateToday,
    nowcastingFutureHours: nowcasting?.futureHours ?? []
  });
  // Build certainty explanation after trading decision is finalized.
  // v1 contract boundary:
  // Keep this strictly observational (UI/debug/analysis only) and never
  // feed certaintySummary back into BUY/WATCH/PASS hard rules.
  const certaintySummary = summarizeCertainty({
    maxModelProb,
    lowerBound: probabilityOutput.debugSummary.L,
    upperBound: probabilityOutput.debugSummary.U,
    observedMax: isTargetDateToday ? (todayMaxTempStable ?? null) : null,
    currentTemp: isTargetDateToday ? (modelCurrentTemp ?? null) : null,
    remainingCap: isTargetDateToday ? constraints.maxPotentialRise : undefined,
    spreadSigmaRaw: liveAdapted.debug.spreadSigmaRaw
  });
  const finalDecision = {
    ...wuFutureGatedDecision,
    decisionMode: 'realtime' as const,
    isDailyOfficial: false,
    dailyDateKey: localDateKey(new Date(), resolved.timezone),
    reasonMeta: {
      ...(wuFutureGatedDecision as unknown as { reasonMeta?: Record<string, unknown> }).reasonMeta,
      certaintySummary,
      realtimeDebug: {
        snapshotTime: liveAdapted.engineInput.snapshotTime,
        snapshotBucket: liveAdapted.engineInput.snapshotBucket,
        mu: liveAdapted.debug.mu,
        sigmaBase: liveAdapted.debug.sigmaBase,
        spreadSigmaRaw: liveAdapted.debug.spreadSigmaRaw,
        spreadSigmaEffective: liveAdapted.debug.spreadSigmaEffective,
        lambda: liveAdapted.debug.lambda,
        finalSigma: liveAdapted.debug.finalSigma,
        sigmaNarrowFloor: liveAdapted.debug.sigmaNarrowFloor,
        constraintIntervalWidth: liveAdapted.debug.constraintIntervalWidth ?? null,
        configSource: liveAdapted.debug.configSource,
        sourceWeightFallbackUsed: liveAdapted.debug.sourceWeightFallbackUsed,
        spreadSourcePoints: liveAdapted.debug.sourcePoints,
        spreadRemovedSources: liveAdapted.debug.removedSources,
        locationKey: resolved.locationKey,
        targetDate: resolved.targetDate,
        isTargetDateToday: resolved.isTargetDateToday,
        isFutureDate: resolved.isFutureDate,
        dayOffset: resolved.dayOffset,
        observedMaxSoFar: todayMaxTempStable ?? null,
        observedMaxCandidates: observedMaxCandidates.length ? observedMaxCandidates : null,
        observedMaxSource,
        remainingCap: constraints.maxPotentialRise,
        remainingCapSource: constraints.debugSummary.remainingCapSource ?? 'heuristic_realtime_v1',
        hoursToPeak: constraints.debugSummary.hoursToPeak ?? null,
        hoursToPeakBucket: constraints.debugSummary.hoursToPeakBucket ?? null,
        observedVsMuGap: constraints.debugSummary.observedVsMuGap ?? null,
        observedVsMuGapBucket: constraints.debugSummary.observedVsMuGapBucket ?? null,
        deltaDistributionKey: constraints.debugSummary.deltaDistributionKey ?? null,
        deltaMean: constraints.debugSummary.deltaMean ?? null,
        deltaStd: constraints.debugSummary.deltaStd ?? null,
        deltaQ50: constraints.debugSummary.deltaQ50 ?? null,
        deltaQ75: constraints.debugSummary.deltaQ75 ?? null,
        deltaQ90: constraints.debugSummary.deltaQ90 ?? null,
        deltaQ95: constraints.debugSummary.deltaQ95 ?? null,
        upperSupportLow: constraints.debugSummary.upperSupportLow ?? null,
        upperSupportHigh: constraints.debugSummary.upperSupportHigh ?? null,
        remainingCapFinal: constraints.debugSummary.remainingCapFinal ?? null,
        maxFutureTemp: constraints.debugSummary.maxFutureTemp ?? null,
        maxContinuousRaw: constraints.maxContinuous ?? null,
        maxContinuous: maxContinuousForEngine ?? null,
        upperBoundStabilization,
        finalU: probabilityOutput.debugSummary.U ?? null,
        certaintyType: certaintySummary.certaintyType,
        isStructuralCertainty: certaintySummary.isStructuralCertainty,
        structuralReasons: certaintySummary.structuralReasons,
        certaintySummaryZh: certaintySummary.summaryZh,
        certaintySummaryEn: certaintySummary.summaryEn,
        mostLikelyInteger,
        mostLikelyIntegerProbability: mostLikelyInteger != null
          ? integerDistribution.find((d) => d.temp === mostLikelyInteger)?.probability ?? null
          : null,
        p13: probByLabel.get('13°C') ?? null,
        p14: probByLabel.get('14°C') ?? null,
        p15: probByLabel.get('15°C') ?? null
      }
    }
  };

  const modelRun = await prisma.modelRun.create({
    data: {
      marketId: market.id,
      modelVersion: MODEL_BASELINE_VERSION,
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
        todayMaxTemp: todayMaxTempStable,
        observedMaxSource,
        observedMaxCandidates,
        // Short-term future temperatures are persisted for same-run explain/debug.
        // These fields are sourced from nowcasting.futureHours (when available)
        // and are not used to shape mu/sigma directly.
        futureTemp1h: isTargetDateToday ? (nowcasting?.futureHours?.[0]?.temp ?? null) : null,
        futureTemp2h: isTargetDateToday ? (nowcasting?.futureHours?.[1]?.temp ?? null) : null,
        futureTemp3h: isTargetDateToday ? (nowcasting?.futureHours?.[2]?.temp ?? null) : null,
        futureTemp4h: isTargetDateToday ? (nowcasting?.futureHours?.[3]?.temp ?? null) : null,
        futureTemp5h: isTargetDateToday ? (nowcasting?.futureHours?.[4]?.temp ?? null) : null,
        futureTemp6h: isTargetDateToday ? (nowcasting?.futureHours?.[5]?.temp ?? null) : null,
        futureTemp7h: isTargetDateToday ? (nowcasting?.futureHours?.[6]?.temp ?? null) : null,
        futureTemp8h: isTargetDateToday ? (nowcasting?.futureHours?.[7]?.temp ?? null) : null,
        futureTemp9h: isTargetDateToday ? (nowcasting?.futureHours?.[8]?.temp ?? null) : null,
        futureTemp10h: isTargetDateToday ? (nowcasting?.futureHours?.[9]?.temp ?? null) : null,
        futureTemp11h: isTargetDateToday ? (nowcasting?.futureHours?.[10]?.temp ?? null) : null,
        futureTemp12h: isTargetDateToday ? (nowcasting?.futureHours?.[11]?.temp ?? null) : null,
        nowcasting: weatherRaw.raw?.nowcasting ?? null,
        isTargetDateToday,
        recommendedSide: finalDecision.recommendedSide,
        reasonZh: finalDecision.reasonZh,
        reasonEn: finalDecision.reasonEn,
        weatherMaturityScore: nowcasting?.weatherMaturityScore ?? null,
        scenarioTag: nowcasting?.scenarioTag ?? null,
        learnedPeakWindow: learnedPeakWindow ?? null,
        calibratedFusedTemp: fusedAnchor,
        fusedContinuous,
        fusedAnchor,
        settlementMean,
        mostLikelyInteger,
        modelSigma: liveAdapted.debug.finalSigma,
        distributionDebug,
        certaintySummary: (finalDecision as unknown as { reasonMeta?: { certaintySummary?: unknown } }).reasonMeta?.certaintySummary ?? null,
        realtimeDebug: (finalDecision as unknown as { reasonMeta?: { realtimeDebug?: unknown } }).reasonMeta?.realtimeDebug ?? null,
        sourceCalibration: biasAdjusted?.breakdown ?? [],
        dailyDecision: {
          mode: 'realtime',
          isOfficial: false,
          dateKey: localDateKey(new Date(), resolved.timezone),
          lockAt: null
        },
        requestContext: {
          locationKey: resolved.locationKey,
          targetDate: resolved.targetDate,
          isTargetDateToday: resolved.isTargetDateToday,
          isFutureDate: resolved.isFutureDate,
          dayOffset: resolved.dayOffset
        },
        constraints,
        constraintsForEngine: {
          ...constraints,
          maxContinuous: maxContinuousForEngine,
          maxAllowedInteger
        },
        note:
          'Calibration/backtest modules remain decoupled from realtime pipeline in v1. This run uses structural truncated-normal constraints only.'
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
        sourceStatus: fromJsonString<{ raw?: { nwsHourly?: string | null; openMeteo?: string | null; wttr?: string | null; metNo?: string | null; weatherapi?: string | null; qweather?: string | null } }>(weather.rawJson, {}).raw ?? null
      }),
      modelOutputJson: toJsonString(modelRun.outputs),
      tradingOutputJson: toJsonString(finalDecision),
      explanationText: finalDecision.reason,
      riskFlagsJson: toJsonString(finalDecision.riskFlags)
    }
  });

  return { market, weather, modelRun, decision: finalDecision };
}

export async function runFullRefresh(request?: PipelineRequest) {
  const totalCapital = Number(process.env.TOTAL_CAPITAL ?? '10000');
  const maxSingleTradePercent = Number(process.env.MAX_SINGLE_TRADE_PERCENT ?? '0.1');
  await refreshMarketData(request);
  await refreshWeatherData(request);
  const result = await runModelAndDecision(totalCapital, maxSingleTradePercent, request);
  await syncSettledResults();
  return result;
}

export async function syncSettledResults() {
  // v1 baseline settlement sync remains Shanghai-only.
  const markets = await prisma.market.findMany({
    where: { ...marketWhereByLocation('shanghai'), targetDate: { lt: new Date() } },
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
    await recordForecastBiasFromPreviousDay(market.id, market.targetDate, roundedFinalTemp, 'Asia/Shanghai');

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
