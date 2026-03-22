import { PrismaClient } from '@prisma/client';
import { liveToProbabilityInput } from '@/src/lib/adapters/live-to-engine';
import { runProbabilityEngine } from '@/src/lib/probability-engine/engine';
import { computeConstraintBounds } from '@/src/lib/trading-engine/constraints';
import { loadModelConfig } from '@/src/lib/model-config';
import type { CertaintyReason, CertaintySummary, CertaintyType } from '@/src/lib/explainability/types';
import {
  CERTAINTY_CONTRACT_VERSION,
  MODEL_BASELINE_VERSION
} from '@/src/lib/explainability/baseline';

const prisma = new PrismaClient();

type Candidate = {
  capturedAt: Date;
  weather: Record<string, unknown>;
  marketBins: Array<{ label: string; marketPrice?: number; noMarketPrice?: number; bestBid?: number }>;
  snapshotTime: string;
  snapshotBucket: '08' | '11' | '14' | 'late';
  spreadRawSimple: number;
  missingCoreSources: number;
  observedVsMuGapPre: number;
  remainingCap: number;
};

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stat(arr: number[]) {
  if (!arr.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...arr),
    max: Math.max(...arr),
    avg: arr.reduce((a, b) => a + b, 0) / arr.length
  };
}

function hourToBucket(hour: number): '08' | '11' | '14' | 'late' {
  if (hour < 10) return '08';
  if (hour < 13) return '11';
  if (hour < 16) return '14';
  return 'late';
}

function localHourAsiaShanghai(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(date));
}

function weightedStd(values: number[]) {
  if (values.length < 2) return 0;
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mu) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function pickDiverse(candidates: Candidate[], limit: number) {
  const pools = {
    lowDiv: candidates.filter((c) => c.spreadRawSimple > 0 && c.spreadRawSimple <= 0.8 && c.missingCoreSources === 0),
    medDiv: candidates.filter((c) => c.spreadRawSimple > 0.8 && c.spreadRawSimple <= 1.8),
    highDiv: candidates.filter((c) => c.spreadRawSimple > 1.8),
    missing: candidates.filter((c) => c.missingCoreSources > 0),
    mismatch: candidates.filter((c) => c.observedVsMuGapPre >= 1.0),
    capLow: candidates.filter((c) => c.remainingCap <= 0.7),
    capMid: candidates.filter((c) => c.remainingCap > 0.7 && c.remainingCap <= 1.1),
    capHigh: candidates.filter((c) => c.remainingCap > 1.1)
  };

  const picked: Candidate[] = [];
  const seen = new Set<string>();
  const keys = Object.keys(pools) as Array<keyof typeof pools>;
  let cursor = 0;
  while (picked.length < limit && cursor < limit * 8) {
    const k = keys[cursor % keys.length];
    const pool = pools[k];
    const next = pool.shift();
    if (next) {
      const sig = `${next.capturedAt.toISOString()}|${next.snapshotTime}|${next.spreadRawSimple.toFixed(3)}|${next.missingCoreSources}|${next.observedVsMuGapPre.toFixed(2)}|${next.remainingCap.toFixed(2)}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        picked.push(next);
      }
    }
    cursor += 1;
  }

  if (picked.length < limit) {
    for (const c of candidates) {
      if (picked.length >= limit) break;
      const sig = `${c.capturedAt.toISOString()}|${c.snapshotTime}|${c.spreadRawSimple.toFixed(3)}|${c.missingCoreSources}|${c.observedVsMuGapPre.toFixed(2)}|${c.remainingCap.toFixed(2)}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        picked.push(c);
      }
    }
  }

  return picked.slice(0, limit);
}

async function main() {
  const limitArg = process.argv.find((x) => x.startsWith('--limit='));
  const limit = limitArg ? Math.max(10, Number(limitArg.split('=')[1])) : 30;
  const modelConfig = loadModelConfig();

  const rows = await prisma.snapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 1200,
    select: {
      capturedAt: true,
      weatherFeaturesJson: true,
      marketPricesJson: true
    }
  });

  const candidates: Candidate[] = [];
  for (const r of rows) {
    let weather: Record<string, unknown>;
    let prices: Array<{ label: string; price?: number; noPrice?: number; bestBid?: number }>;
    try {
      weather = JSON.parse(r.weatherFeaturesJson || '{}');
      prices = JSON.parse(r.marketPricesJson || '[]');
    } catch {
      continue;
    }

    const sourceDailyMax = (weather.sourceDailyMax ?? {}) as Record<string, unknown>;
    const coreValues = [
      finite(sourceDailyMax.wundergroundDaily),
      finite(sourceDailyMax.wttr),
      finite(sourceDailyMax.metNo),
      finite(sourceDailyMax.weatherApi),
      finite(sourceDailyMax.openMeteo)
    ];
    const validValues = coreValues.filter((v): v is number => v != null);
    if (validValues.length < 2) continue;

    const missingCoreSources = coreValues.length - validValues.length;
    const muSimple = validValues.reduce((a, b) => a + b, 0) / validValues.length;
    const spreadRawSimple = weightedStd(validValues);
    const observed = finite(weather.maxTempSoFar);
    const observedVsMuGapPre = observed == null ? 0 : Math.abs(observed - muSimple);
    const nowcasting = (weather.nowcasting ?? {}) as Record<string, unknown>;
    const futureHours = Array.isArray(nowcasting.futureHours) ? nowcasting.futureHours as Array<Record<string, unknown>> : [];
    const futureTemps = futureHours.slice(0, 6).map((h) => finite(h.temp)).filter((v): v is number => v != null);
    const hour = localHourAsiaShanghai(r.capturedAt);
    const constraints = computeConstraintBounds({
      isTargetDateToday: true,
      nowHourLocal: hour,
      observedMaxTemp: observed ?? undefined,
      currentTemp: finite(weather.currentTemp) ?? observed ?? 0,
      futureTemps1To6h: futureTemps,
      cloudCover: finite(weather.cloudCover) ?? 0,
      windSpeed: finite(weather.windSpeed) ?? 0
    });

    const marketBins = prices
      .filter((p) => typeof p.label === 'string')
      .map((p) => ({
        label: p.label,
        marketPrice: finite(p.price) ?? undefined,
        noMarketPrice: finite(p.noPrice) ?? undefined,
        bestBid: finite(p.bestBid) ?? undefined
      }));
    if (!marketBins.length) continue;

    candidates.push({
      capturedAt: r.capturedAt,
      weather,
      marketBins,
      snapshotTime: `${String(hour).padStart(2, '0')}:00`,
      snapshotBucket: hourToBucket(hour),
      spreadRawSimple,
      missingCoreSources,
      observedVsMuGapPre,
      remainingCap: constraints.maxPotentialRise
    });
  }

  const picked = pickDiverse(candidates, limit);
  const table = picked.map((c) => {
    const w = c.weather;
    const sourceDailyMax = (w.sourceDailyMax ?? {}) as Record<string, unknown>;
    const nowcasting = (w.nowcasting ?? {}) as Record<string, unknown>;
    const futureHours = Array.isArray(nowcasting.futureHours) ? nowcasting.futureHours as Array<Record<string, unknown>> : [];
    const futureTemps = futureHours.slice(0, 6).map((h) => finite(h.temp)).filter((v): v is number => v != null);
    const observed = finite(w.maxTempSoFar);
    const constraints = computeConstraintBounds({
      isTargetDateToday: true,
      nowHourLocal: Number(c.snapshotTime.slice(0, 2)),
      observedMaxTemp: observed ?? undefined,
      currentTemp: finite(w.currentTemp) ?? observed ?? 0,
      futureTemps1To6h: futureTemps,
      cloudCover: finite(w.cloudCover) ?? 0,
      windSpeed: finite(w.windSpeed) ?? 0
    });
    const adapted = liveToProbabilityInput({
      locationKey: 'shanghai',
      targetDateKey: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(c.capturedAt),
      isTargetDateToday: true,
      isFutureDate: false,
      dayOffset: 0,
      snapshotTime: c.snapshotTime,
      marketBins: c.marketBins,
      sourceDailyMax: {
        wundergroundDaily: finite(sourceDailyMax.wundergroundDaily),
        openMeteo: finite(sourceDailyMax.openMeteo),
        wttr: finite(sourceDailyMax.wttr),
        metNo: finite(sourceDailyMax.metNo),
        weatherApi: finite(sourceDailyMax.weatherApi),
        qWeather: finite(sourceDailyMax.qWeather),
        nwsHourly: finite(sourceDailyMax.nwsHourly),
        spread: finite(sourceDailyMax.spread),
        fusedContinuous: finite(sourceDailyMax.fusedContinuous),
        fused: finite(sourceDailyMax.fused)
      },
      observedMaxSoFar: observed ?? undefined,
      currentTemp: finite(w.currentTemp) ?? undefined,
      cloudCover: finite(w.cloudCover) ?? undefined,
      windSpeed: finite(w.windSpeed) ?? undefined,
      rainProb: finite(w.precipitation) ?? undefined,
      constraints: {
        minContinuous: constraints.minContinuous,
        maxContinuous: constraints.maxContinuous,
        minAllowedInteger: constraints.minAllowedInteger,
        maxAllowedInteger: constraints.maxAllowedInteger
      },
      fallbackMean: finite(sourceDailyMax.fusedContinuous) ?? finite(sourceDailyMax.fused) ?? finite(w.currentTemp) ?? observed ?? 0,
      fallbackSigma: 1.05,
      modelConfig
    });
    const out = runProbabilityEngine(adapted.engineInput);
    const labelProb = new Map(c.marketBins.map((b, i) => [b.label, out.binProbabilities[i] ?? 0]));
    const most = out.integerDistribution.reduce((best, x) => (x.probability > best.probability ? x : best), { temp: 0, probability: 0 });
    return {
      capturedAt: c.capturedAt,
      snapshotTime: c.snapshotTime,
      snapshotBucket: c.snapshotBucket,
      locationKey: out.debugSummary.locationKey ?? null,
      targetDate: out.debugSummary.targetDate ?? null,
      isTargetDateToday: out.debugSummary.isTargetDateToday ?? null,
      isFutureDate: out.debugSummary.isFutureDate ?? null,
      dayOffset: out.debugSummary.dayOffset ?? null,
      mu: adapted.debug.mu,
      sigmaBase: adapted.debug.sigmaBase,
      spreadSigmaRaw: adapted.debug.spreadSigmaRaw,
      spreadSigmaEffective: adapted.debug.spreadSigmaEffective,
      lambda: adapted.debug.lambda,
      finalSigma: adapted.debug.finalSigma,
      observedMaxSoFar: observed,
      remainingCap: constraints.maxPotentialRise,
      finalU: out.debugSummary.U ?? null,
      p13: labelProb.get('13°C') ?? null,
      p14: labelProb.get('14°C') ?? null,
      p15: labelProb.get('15°C') ?? null,
      mostLikelyInteger: most.temp,
      mostLikelyIntegerProbability: most.probability,
      missingCoreSources: c.missingCoreSources,
      observedVsMuGap: observed != null ? Math.abs(observed - adapted.debug.mu) : null,
      L: out.debugSummary.L ?? null,
      spreadSourcePoints: adapted.debug.sourcePoints,
      spreadRemovedSources: adapted.debug.removedSources
    };
  });

  const vals = (k: keyof (typeof table)[number]) =>
    table.map((r) => finite(r[k])).filter((v): v is number => v != null);
  const bucketCounts = table.reduce<Record<string, number>>((acc, r) => {
    acc[r.snapshotBucket] = (acc[r.snapshotBucket] || 0) + 1;
    return acc;
  }, {});
  const mostLikelyDist = table.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.mostLikelyInteger}°C`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const over90Count = table.filter((r) => (r.mostLikelyIntegerProbability ?? 0) > 0.9).length;
  const p15PositiveCount = table.filter((r) => (r.p15 ?? 0) > 0).length;
  const over95Rows = table
    .filter((r) => (r.mostLikelyIntegerProbability ?? 0) >= 0.95)
    .map((r) => {
      const widthFromL = finite(r.finalU) != null && finite(r.L) != null
        ? Number(r.finalU) - Number(r.L)
        : null;
      const uMinusObserved = finite(r.finalU) != null && finite(r.observedMaxSoFar) != null
        ? Number(r.finalU) - Number(r.observedMaxSoFar)
        : null;
      const factors: CertaintyReason[] = [];
      if (widthFromL != null && widthFromL <= 0.9) factors.push('narrow_truncation_window');
      if (uMinusObserved != null && uMinusObserved <= 0.8) factors.push('tight_upside_cap');
      if ((r.observedMaxSoFar ?? -999) >= (r.mu ?? 999) - 0.2) factors.push('observed_floor_active');
      if ((r.spreadSigmaRaw ?? 99) <= 0.35) factors.push('high_source_consensus');
      const certaintyType: CertaintyType = factors.length > 0 ? 'structural' : 'model';
      const certaintySummary: CertaintySummary = {
        isStructuralCertainty: factors.length > 0,
        certaintyType,
        structuralReasons: factors,
        summaryZh: factors.length > 0
          ? `高置信主要来自结构性约束：${factors.join(' + ')}。`
          : '高置信主要来自模型形状，缺少结构性约束支撑。',
        summaryEn: factors.length > 0
          ? `High confidence is structural: ${factors.join(' + ')}.`
          : 'High confidence is mainly model-shaped without strong structural constraints.',
        widthFromL
      };
      return {
        capturedAt: r.capturedAt,
        snapshotTime: r.snapshotTime,
        snapshotBucket: r.snapshotBucket,
        mostLikelyInteger: r.mostLikelyInteger,
        mostLikelyIntegerProbability: r.mostLikelyIntegerProbability,
        mu: r.mu,
        observedMaxSoFar: r.observedMaxSoFar,
        finalSigma: r.finalSigma,
        spreadSigmaRaw: r.spreadSigmaRaw,
        L: r.L,
        finalU: r.finalU,
        widthFromL,
        uMinusObserved,
        certaintySummary,
        acceptableInBusinessView: certaintySummary.isStructuralCertainty
      };
    });
  const bucketOver90Counts = table.reduce<Record<string, number>>((acc, r) => {
    if ((r.mostLikelyIntegerProbability ?? 0) > 0.9) {
      acc[r.snapshotBucket] = (acc[r.snapshotBucket] || 0) + 1;
    }
    return acc;
  }, {});
  const uMinusObservedSeries = table
    .map((r) => finite(r.finalU) != null && finite(r.observedMaxSoFar) != null ? Number(r.finalU) - Number(r.observedMaxSoFar) : null)
    .filter((v): v is number => v != null);
  const uMinusLSeries = table
    .map((r) => finite(r.finalU) != null && finite(r.L) != null ? Number(r.finalU) - Number(r.L) : null)
    .filter((v): v is number => v != null);

  const isNarrow = (r: (typeof table)[number]) =>
    finite(r.finalU) != null && finite(r.L) != null && Number(r.finalU) - Number(r.L) <= 0.9;
  const over90StructuralCount = table.filter((r) => (r.mostLikelyIntegerProbability ?? 0) > 0.9 && isNarrow(r)).length;
  const over90NonStructuralCount = table.filter((r) => (r.mostLikelyIntegerProbability ?? 0) > 0.9 && !isNarrow(r)).length;
  const over95StructuralCount = over95Rows.filter((r) => r.widthFromL != null && r.widthFromL <= 0.9).length;
  const over95NonStructuralCount = over95Rows.length - over95StructuralCount;

  const out = {
    contract: {
      certaintyContractVersion: CERTAINTY_CONTRACT_VERSION,
      modelBaselineVersion: MODEL_BASELINE_VERSION
    },
    sampleCount: table.length,
    summary: {
      bucketCounts,
      spreadSigmaRaw: stat(vals('spreadSigmaRaw')),
      spreadSigmaEffective: stat(vals('spreadSigmaEffective')),
      finalSigma: stat(vals('finalSigma')),
      observedVsMuGap: stat(vals('observedVsMuGap')),
      finalUMinusObserved: stat(uMinusObservedSeries),
      finalUMinusL: stat(uMinusLSeries),
      remainingCap: stat(vals('remainingCap')),
      p15PositiveCount,
      over90Count,
      over95Count: over95Rows.length,
      over90StructuralCount,
      over90NonStructuralCount,
      over95StructuralCount,
      over95NonStructuralCount,
      bucketOver90Counts,
      mostLikelyDistribution: mostLikelyDist
    },
    highProbabilityRows: over95Rows,
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
