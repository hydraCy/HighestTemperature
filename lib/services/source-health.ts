import { prisma } from '@/lib/db';
import type { SourceHealthStatus } from '@/src/lib/fusion-engine/sourcePolicy';
import { fromJsonString } from '@/lib/utils/json';

type WeatherSourceCode =
  | 'wunderground_daily'
  | 'weather_com'
  | 'aviationweather'
  | 'weatherapi'
  | 'met_no'
  | 'wttr'
  | 'qweather'
  | 'nws_hourly';

export type SourceHealth = {
  sourceCode: WeatherSourceCode | string;
  status: SourceHealthStatus;
  healthScore: number;
  reason: string;
};

function scoreOf(status: SourceHealthStatus) {
  if (status === 'healthy') return 1;
  if (status === 'stale') return 0.6;
  if (status === 'degraded') return 0.4;
  return 0;
}

function normalizeApiOkStatus(status?: string | null) {
  return status === 'ok';
}

export async function computeSourceHealth(
  marketId: string,
  sourceCode: WeatherSourceCode | string,
  currentApiStatus?: string | null,
  forecastAgeHours?: number | null
): Promise<SourceHealth> {
  const [recentSnaps, degradedWindow] = await Promise.all([
    prisma.weatherAssistSnapshot.findMany({
      where: { marketId },
      orderBy: { observedAt: 'desc' },
      take: 5,
      select: { rawJson: true, observedAt: true }
    }),
    prisma.forecastSourceBias.findMany({
      where: {
        marketId,
        sourceCode,
        capturedAt: { gte: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) }
      },
      select: { absError: true }
    })
  ]);

  const consecutiveFails = (() => {
    let n = 0;
    if (currentApiStatus && !normalizeApiOkStatus(currentApiStatus)) n += 1;
    for (const s of recentSnaps) {
      const raw = fromJsonString<{ raw?: Record<string, string | null | undefined> }>(s.rawJson, {});
      const status =
        sourceCode === 'weatherapi'
          ? raw.raw?.weatherapi
          : sourceCode === 'met_no'
            ? raw.raw?.metNo
            : sourceCode === 'wttr'
              ? raw.raw?.wttr
              : sourceCode === 'qweather'
                ? raw.raw?.qweather
                : sourceCode === 'nws_hourly'
                  ? raw.raw?.nwsHourly
                  : sourceCode === 'wunderground_daily'
                    ? raw.raw?.wundergroundDaily
                    : sourceCode === 'aviationweather'
                      ? raw.raw?.aviationweather
                      : null;
      if (normalizeApiOkStatus(status)) break;
      n += 1;
      if (n >= 3) break;
    }
    return n;
  })();

  if (consecutiveFails >= 3) {
    return {
      sourceCode,
      status: 'down',
      healthScore: scoreOf('down'),
      reason: '连续 3 次抓取失败'
    };
  }

  if (forecastAgeHours != null && Number.isFinite(forecastAgeHours) && forecastAgeHours > 18) {
    return {
      sourceCode,
      status: 'stale',
      healthScore: scoreOf('stale'),
      reason: `数据发布时间超过 18 小时（${forecastAgeHours.toFixed(1)}h）`
    };
  }

  if (degradedWindow.length >= 5) {
    const avgAbsError = degradedWindow.reduce((acc, x) => acc + Math.abs(x.absError), 0) / degradedWindow.length;
    if (avgAbsError > 2) {
      return {
        sourceCode,
        status: 'degraded',
        healthScore: scoreOf('degraded'),
        reason: `近 5 天平均偏差 ${avgAbsError.toFixed(2)}°C > 2°C`
      };
    }
  }

  return {
    sourceCode,
    status: 'healthy',
    healthScore: scoreOf('healthy'),
    reason: '-'
  };
}

