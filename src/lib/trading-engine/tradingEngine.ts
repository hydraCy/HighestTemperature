import { normalizeProbabilities } from '@/lib/utils/probability';
import { calculateEdge, edgeToScore } from '@/src/lib/trading-engine/edge';
import { calculateTimingScore } from '@/src/lib/trading-engine/timingScore';
import { calculateWeatherStabilityScore } from '@/src/lib/trading-engine/weatherScore';
import { calculateDataQualityScore } from '@/src/lib/trading-engine/dataQuality';
import { buildRiskFlags, calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import type { Side, TradingDecisionOutput, TradingInput } from '@/src/lib/trading-engine/types';

function localHourMinute(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

function localDateKey(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

export function runTradingDecision(input: TradingInput, timezone = 'Asia/Shanghai'): TradingDecisionOutput {
  const probs = normalizeProbabilities(input.probabilities);
  const minEdgeToTrade = Number(process.env.MIN_EDGE_TO_TRADE ?? '0.03');
  const minUpsideToTrade = Number(process.env.MIN_UPSIDE_TO_TRADE ?? '0.05');
  const minSideProbToTrade = Number(process.env.MIN_SIDE_PROB_TO_TRADE ?? '0.55');
  const tradingCost = Number(process.env.TRADING_COST_PER_TRADE ?? '0.01');

  const outputs = input.bins.map((bin, idx) => {
    const modelYes = probs[idx] ?? 0;
    const modelNo = 1 - modelYes;
    const yesPrice = bin.marketPrice;
    const fallbackNo = bin.bestBid != null ? 1 - bin.bestBid : 1 - yesPrice;
    const noPrice = bin.noMarketPrice ?? fallbackNo;
    const edgeYes = calculateEdge(modelYes, yesPrice);
    const edgeNo = calculateEdge(modelNo, noPrice);
    const netEdgeYes = edgeYes - tradingCost;
    const netEdgeNo = edgeNo - tradingCost;
    const bestSide: Side = netEdgeYes >= netEdgeNo ? 'YES' : 'NO';
    const edge = bestSide === 'YES' ? netEdgeYes : netEdgeNo;
    return {
      outcomeLabel: bin.label,
      modelProbability: modelYes,
      modelNoProbability: modelNo,
      marketPrice: yesPrice,
      noMarketPrice: noPrice,
      edgeYes,
      edgeNo,
      netEdgeYes,
      netEdgeNo,
      bestSide,
      edge
    };
  });

  const candidates = outputs
    .map((o) => {
      const entryPrice = o.bestSide === 'YES' ? o.marketPrice : o.noMarketPrice;
      const sideProbability = o.bestSide === 'YES' ? o.modelProbability : o.modelNoProbability;
      return {
        ...o,
        netEdge: o.edge,
        upside: 1 - entryPrice,
        sideProbability,
        qualityScore: o.edge * sideProbability
      };
    })
    .filter((o) => o.netEdge >= minEdgeToTrade && o.upside >= minUpsideToTrade && o.sideProbability >= minSideProbToTrade)
    .sort((a, b) => b.qualityScore - a.qualityScore || b.netEdge - a.netEdge);
  const bestRaw = [...outputs].sort((a, b) => b.edge - a.edge)[0] ?? outputs[0];
  const best = candidates[0] ?? (bestRaw ? {
    ...bestRaw,
    netEdge: bestRaw.edge,
    upside: 1 - (bestRaw.bestSide === 'YES' ? bestRaw.marketPrice : bestRaw.noMarketPrice),
    sideProbability: bestRaw.bestSide === 'YES' ? bestRaw.modelProbability : bestRaw.modelNoProbability,
    qualityScore: bestRaw.edge * (bestRaw.bestSide === 'YES' ? bestRaw.modelProbability : bestRaw.modelNoProbability)
  } : null);
  const edge = best?.netEdge ?? 0;

  const { hour, minute } = localHourMinute(input.now, timezone);
  const rawTimingScore = calculateTimingScore(hour, minute);
  const maturity = typeof input.weatherMaturityScore === 'number' ? Math.max(0, Math.min(100, input.weatherMaturityScore)) : null;
  const timingScore = maturity == null
    ? rawTimingScore
    : Math.max(0, Math.min(100, 0.7 * rawTimingScore + 0.3 * maturity));
  const rawWeatherScore = calculateWeatherStabilityScore({
    cloudCover: input.cloudCover,
    precipitationProb: input.precipitationProb,
    tempRise1h: input.tempRise1h
  });
  const weatherScore = maturity == null
    ? rawWeatherScore
    : Math.max(0, Math.min(100, 0.8 * rawWeatherScore + 0.2 * maturity));
  const dataQualityScore = calculateDataQualityScore({
    resolutionReady: input.resolutionReady,
    weatherReady: input.weatherReady,
    marketReady: input.marketReady,
    modelReady: input.modelReady
  });

  const edgeScore = edgeToScore(Math.max(0, edge));
  let tradeScore =
    0.35 * edgeScore +
    0.25 * timingScore +
    0.2 * weatherScore +
    0.2 * dataQualityScore;

  const marketEndMs = input.marketEndAt?.getTime();
  const nowMs = input.now.getTime();
  const minutesToClose = marketEndMs != null ? Math.floor((marketEndMs - nowMs) / 60000) : null;
  const isClosedByTime = marketEndMs != null && nowMs >= marketEndMs;
  const isInactive = input.marketActive === false;

  const isTargetDateMismatch =
    input.targetDate != null && localDateKey(input.targetDate, timezone) !== localDateKey(input.now, timezone);
  if (isTargetDateMismatch) {
    tradeScore = Math.min(tradeScore, 72);
  }
  if (minutesToClose != null && minutesToClose <= 60 && minutesToClose > 0) {
    tradeScore = Math.min(tradeScore, 66);
  }
  if (isClosedByTime || isInactive) {
    tradeScore = 0;
  }

  let decision: TradingDecisionOutput['decision'] =
    tradeScore < 60 ? 'PASS' : tradeScore <= 75 ? 'WATCH' : 'BUY';
  if (!candidates.length) decision = 'PASS';
  const decisionZh = decision === 'BUY' ? '买入' : decision === 'WATCH' ? '观察' : '放弃';
  const decisionEn = decision === 'BUY' ? 'BUY' : decision === 'WATCH' ? 'WATCH' : 'PASS';

  const riskFlags = buildRiskFlags({
    cloudCover: input.cloudCover,
    precipitationProb: input.precipitationProb,
    tempRise1h: input.tempRise1h
  });
  if (!candidates.length) riskFlags.push('no_profit_edge');
  if (best && best.sideProbability < minSideProbToTrade) riskFlags.push('low_confidence');
  if (maturity != null && maturity < 45) riskFlags.push('low_weather_maturity');
  if (input.scenarioTag === 'suppressed_heating') riskFlags.push('suppressed_heating');
  if (isTargetDateMismatch) riskFlags.push('not_target_date');
  if (minutesToClose != null && minutesToClose <= 60 && minutesToClose > 0) riskFlags.push('settlement_soon');
  if (isClosedByTime) riskFlags.push('market_settled');
  if (isInactive) riskFlags.push('market_inactive');
  const riskModifier = calculateRiskModifier({
    cloudCover: input.cloudCover,
    precipitationProb: input.precipitationProb,
    tempRise1h: input.tempRise1h
  });

  const positionSize = calculatePositionSize({
    totalCapital: input.totalCapital,
    maxSingleTradePercent: input.maxSingleTradePercent,
    edge: Math.max(0, edge),
    riskModifier
  });

  const mismatchTip = isTargetDateMismatch ? '当前并非目标结算日，评分已降权，不建议激进仓位。' : '';
  const mismatchTipEn = isTargetDateMismatch ? 'Today is not the target settlement date; score is down-weighted and aggressive sizing is not advised.' : '';
  const settleTip = isClosedByTime
    ? '该市场已到或超过结算时间，停止交易建议。'
    : minutesToClose != null && minutesToClose <= 60 && minutesToClose > 0
      ? `距结算仅剩 ${minutesToClose} 分钟，建议只观察不追单。`
      : '';
  const settleTipEn = isClosedByTime
    ? 'Market has reached or passed settlement time; trading advice is stopped.'
    : minutesToClose != null && minutesToClose <= 60 && minutesToClose > 0
      ? `${minutesToClose} minutes left to settlement; watch-only is recommended.`
      : '';
  const inactiveTip = isInactive ? '该市场已非 active 状态，不建议下单。' : '';
  const inactiveTipEn = isInactive ? 'Market is not active; placing orders is not recommended.' : '';
  const profitabilityTip = !candidates.length
    ? `当前没有同时满足净利润与胜率门槛的盘口（最小胜率 ${(minSideProbToTrade * 100).toFixed(0)}%），建议 PASS。`
    : `可交易净Edge约 ${(edge * 100).toFixed(1)}%，优先方向为 ${best?.bestSide ?? '-'}，对应胜率约 ${((best?.sideProbability ?? 0) * 100).toFixed(0)}%。`;
  const profitabilityTipEn = !candidates.length
    ? `No bin meets both net-profit and win-rate thresholds (min win-rate ${(minSideProbToTrade * 100).toFixed(0)}%); PASS is recommended.`
    : `Tradable net edge is about ${(edge * 100).toFixed(1)}%, preferred side is ${best?.bestSide ?? '-'} with estimated win-rate ${((best?.sideProbability ?? 0) * 100).toFixed(0)}%.`;
  const reasonZh = `目标日全天最高温预测约 ${Math.round(input.maxTempSoFar)}°C，峰值前两小时升温 ${input.tempRise2h.toFixed(1)}°C，时间窗口评分 ${timingScore.toFixed(0)}。模型对 ${best?.outcomeLabel ?? '-'} 的判断已计入价格，${profitabilityTip} 天气稳定度 ${weatherScore.toFixed(0)}，数据质量 ${dataQualityScore.toFixed(0)}，综合建议${decisionZh}。${mismatchTip}${settleTip}${inactiveTip}`;
  const reasonEn = `Forecast max temperature for target day is about ${Math.round(input.maxTempSoFar)}°C, with ${input.tempRise2h.toFixed(1)}°C rise in the 2 hours before peak and timing score ${timingScore.toFixed(0)}. Model view on ${best?.outcomeLabel ?? '-'} is compared against market pricing; ${profitabilityTipEn} Weather stability is ${weatherScore.toFixed(0)} and data quality is ${dataQualityScore.toFixed(0)}. Overall recommendation: ${decisionEn}. ${mismatchTipEn}${settleTipEn}${inactiveTipEn}`.trim();
  const reason = `${reasonZh}\nEN: ${reasonEn}`;

  const finalDecision = isClosedByTime || isInactive ? 'PASS' : decision;
  const finalPositionSize = isClosedByTime || isInactive ? 0 : positionSize;

  return {
    decision: finalDecision,
    recommendedBin: best?.outcomeLabel ?? '-',
    recommendedSide: best?.bestSide ?? 'YES',
    edge,
    tradeScore: Number(tradeScore.toFixed(2)),
    positionSize: finalPositionSize,
    timingScore,
    weatherScore,
    dataQualityScore,
    riskFlags,
    reason,
    reasonZh,
    reasonEn,
    binOutputs: outputs
  };
}
