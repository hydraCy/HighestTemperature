import { normalizeProbabilities } from '@/lib/utils/probability';
import { calculateEdge, edgeToScore } from '@/src/lib/trading-engine/edge';
import { calculateTimingScore } from '@/src/lib/trading-engine/timingScore';
import { calculateWeatherStabilityScore } from '@/src/lib/trading-engine/weatherScore';
import { calculateDataQualityScore } from '@/src/lib/trading-engine/dataQuality';
import { buildRiskFlags, calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import type { Side, TradingDecisionOutput, TradingInput } from '@/src/lib/trading-engine/types';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

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
  const { hour, minute } = localHourMinute(input.now, timezone);
  const isTargetDateToday = input.targetDate != null && localDateKey(input.targetDate, timezone) === localDateKey(input.now, timezone);
  const decimalHour = hour + minute / 60;
  const learnedEndHour = Number.isFinite(input.learnedPeakWindowEndHour)
    ? Number(input.learnedPeakWindowEndHour)
    : 16;
  const lockStartHour = Math.max(12.5, learnedEndHour - 1);
  const isLateSession = decimalHour >= lockStartHour;
  const f1 = input.futureTemp1h;
  const f2 = input.futureTemp2h;
  const f3 = input.futureTemp3h;
  const f4 = input.futureTemp4h;
  const f5 = input.futureTemp5h;
  const f6 = input.futureTemp6h;
  const observedMax = input.observedMaxTemp;
  const futureSeq = [f1, f2, f3, f4, f5, f6].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const futureCooling =
    futureSeq.length >= 3 &&
    futureSeq[0] <= input.currentTemp + 0.2 &&
    futureSeq.every((v, i) => (i === 0 ? true : v <= futureSeq[i - 1] + 0.2));
  const lockTriggered =
    isTargetDateToday &&
    isLateSession &&
    observedMax != null &&
    Number.isFinite(observedMax) &&
    observedMax >= input.currentTemp - 0.2 &&
    futureCooling;
  const predictedTargetTemp = Math.round(input.maxTempSoFar);
  const lockedTargetTemp =
    lockTriggered && observedMax != null && Number.isFinite(observedMax)
      ? Math.round(observedMax)
      : predictedTargetTemp;

  const probs = normalizeProbabilities(input.probabilities);
  const minEdgeToTrade = Number(process.env.MIN_EDGE_TO_TRADE ?? '0.03');
  const minUpsideToTrade = Number(process.env.MIN_UPSIDE_TO_TRADE ?? '0.05');
  const minSideProbToTrade = Number(process.env.MIN_SIDE_PROB_TO_TRADE ?? '0.55');
  const secondEntryMinEdge = Number(process.env.SECOND_ENTRY_MIN_EDGE ?? '0.06');
  const secondEntryMinProb = Number(process.env.SECOND_ENTRY_MIN_PROB ?? '0.62');
  const consensusStrongPrice = Number(process.env.MARKET_CONSENSUS_STRONG_PRICE ?? '0.65');
  const fees = Number(process.env.TRADING_FEES ?? process.env.TRADING_COST_PER_TRADE ?? '0.01');
  const slippage = Number(process.env.TRADING_SLIPPAGE ?? '0.005');
  const tradingCost = fees + slippage;
  const skipNearCertainPrice = Number(process.env.SKIP_NEAR_CERTAIN_PRICE ?? '0.95');
  const hasPriorEntry = (input.entryCountForTargetDate ?? 0) >= 1;
  const effectiveMinEdge = hasPriorEntry ? Math.max(minEdgeToTrade, secondEntryMinEdge) : minEdgeToTrade;
  const effectiveMinSideProb = hasPriorEntry ? Math.max(minSideProbToTrade, secondEntryMinProb) : minSideProbToTrade;

  const outputs = input.bins.map((bin, idx) => {
    const parsed = parseTemperatureBin(bin.label);
    const isTargetBin =
      (parsed.min != null && parsed.max != null && lockedTargetTemp >= parsed.min && lockedTargetTemp < parsed.max) ||
      (parsed.min != null && parsed.max == null && lockedTargetTemp >= parsed.min) ||
      (parsed.min == null && parsed.max != null && lockedTargetTemp < parsed.max);
    const modelYes = probs[idx] ?? 0;
    const modelNo = 1 - modelYes;
    const yesPrice = bin.marketPrice;
    const hasExecutableNo = typeof bin.noMarketPrice === 'number' && Number.isFinite(bin.noMarketPrice);
    const fallbackNo = bin.bestBid != null ? 1 - bin.bestBid : 1 - yesPrice;
    const fallbackPenalty = Number(process.env.NO_PRICE_FALLBACK_PENALTY ?? '0.03');
    const noPrice = hasExecutableNo
      ? (bin.noMarketPrice as number)
      : Math.min(0.999, Math.max(0.001, fallbackNo + fallbackPenalty));
    const edgeYes = calculateEdge(modelYes, yesPrice);
    const edgeNo = calculateEdge(modelNo, noPrice);
    const netEdgeYes = edgeYes - tradingCost;
    const netEdgeNo = edgeNo - tradingCost;
    const theoreticalEVYes = edgeYes;
    const theoreticalEVNo = edgeNo;
    const tradableEVYes = modelYes - yesPrice - fees - slippage;
    const tradableEVNo = modelNo - noPrice - fees - slippage;
    // Global mutually-exclusive market logic:
    // only target bin can be YES, all other bins are constrained to NO.
    const bestSide: Side = isTargetBin ? 'YES' : 'NO';
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
      theoreticalEVYes,
      theoreticalEVNo,
      tradableEVYes,
      tradableEVNo,
      hasExecutableNo,
      isTargetBin,
      bestSide,
      edge
    };
  });

  const candidates = outputs
    .map((o) => {
      const chosenSide: Side = o.bestSide;
      const chosenEntry = chosenSide === 'YES' ? o.marketPrice : o.noMarketPrice;
      const chosenProb = chosenSide === 'YES' ? o.modelProbability : o.modelNoProbability;
      const chosenNetEdge = (chosenSide === 'YES' ? o.tradableEVYes : o.tradableEVNo);
      const chosenExecutable = chosenSide === 'YES' ? true : o.hasExecutableNo;
      const nearCertain = chosenEntry >= skipNearCertainPrice;
      const overCertainProb = chosenProb > 0.95;
      return {
        ...o,
        bestSide: chosenSide,
        netEdge: chosenNetEdge,
        upside: 1 - chosenEntry,
        sideProbability: chosenProb,
        sideExecutable: chosenExecutable,
        qualityScore: chosenNetEdge * chosenProb * (o.isTargetBin ? 1 : 0.95),
        lockTriggered,
        nearCertain,
        overCertainProb
      };
    })
    .filter((o) => o.sideExecutable && o.netEdge >= effectiveMinEdge && o.upside >= minUpsideToTrade && o.sideProbability >= effectiveMinSideProb && !o.nearCertain && !o.overCertainProb)
    .sort((a, b) => b.qualityScore - a.qualityScore || b.netEdge - a.netEdge);
  const bestRaw = [...outputs].sort((a, b) => b.edge - a.edge)[0] ?? outputs[0];
  const lockFallback = lockTriggered
    ? outputs
      .map((o) => ({
        ...o,
        sideExecutable: o.bestSide === 'YES' ? true : o.hasExecutableNo,
        netEdge: o.bestSide === 'YES' ? o.tradableEVYes : o.tradableEVNo,
        upside: 1 - (o.bestSide === 'YES' ? o.marketPrice : o.noMarketPrice),
        sideProbability: o.bestSide === 'YES' ? o.modelProbability : o.modelNoProbability,
        qualityScore: (o.bestSide === 'YES' ? o.tradableEVYes : o.tradableEVNo) * (o.bestSide === 'YES' ? o.modelProbability : o.modelNoProbability)
      }))
      .filter((o) => o.sideExecutable)
      .sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null
    : null;
  const bestRawCandidate = bestRaw
    ? {
        ...bestRaw,
        sideExecutable: bestRaw.bestSide === 'YES' ? true : bestRaw.hasExecutableNo,
        netEdge: bestRaw.bestSide === 'YES' ? bestRaw.tradableEVYes : bestRaw.tradableEVNo,
        upside: 1 - (bestRaw.bestSide === 'YES' ? bestRaw.marketPrice : bestRaw.noMarketPrice),
        sideProbability: bestRaw.bestSide === 'YES' ? bestRaw.modelProbability : bestRaw.modelNoProbability,
        qualityScore: bestRaw.edge * (bestRaw.bestSide === 'YES' ? bestRaw.modelProbability : bestRaw.modelNoProbability)
      }
    : null;
  const best = candidates[0] ?? lockFallback ?? (bestRawCandidate?.sideExecutable ? bestRawCandidate : null);
  const edge = best?.netEdge ?? 0;

  const rawTimingScore = calculateTimingScore(hour, minute, {
    startHour: input.learnedPeakWindowStartHour,
    endHour: input.learnedPeakWindowEndHour
  });
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
    modelReady: input.modelReady,
    rulesParsed: input.rulesParsed,
    hasCompleteSources: input.hasCompleteSources,
    weatherFreshnessHours: input.weatherFreshnessHours,
    avgSourceHealthScore: input.avgSourceHealthScore
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
  if (lockTriggered) {
    tradeScore = Math.min(tradeScore, 74);
  }
  if (isClosedByTime || isInactive) {
    tradeScore = 0;
  }

  let decision: TradingDecisionOutput['decision'] =
    edge > 0.06 ? 'BUY' : edge >= 0.02 ? 'WATCH' : 'PASS';
  if (!candidates.length) decision = 'PASS';
  const hasStrongMarketConsensus = (input.marketConsensusPrice ?? 0) >= consensusStrongPrice;
  const isConsensusConflict = Boolean(
    best &&
      hasStrongMarketConsensus &&
      input.marketConsensusBin &&
      best.outcomeLabel !== input.marketConsensusBin
  );
  const consensusDowngraded = decision === 'BUY' && isConsensusConflict;
  if (consensusDowngraded) {
    decision = 'WATCH';
  }
  const finalDecision = isClosedByTime || isInactive ? 'PASS' : decision;
  const decisionZh = finalDecision === 'BUY' ? '买入' : finalDecision === 'WATCH' ? '观察' : '放弃';
  const decisionEn = finalDecision === 'BUY' ? 'BUY' : finalDecision === 'WATCH' ? 'WATCH' : 'PASS';

  const riskFlags = buildRiskFlags({
    cloudCover: input.cloudCover,
    precipitationProb: input.precipitationProb,
    tempRise1h: input.tempRise1h
  });
  if (!candidates.length) riskFlags.push('no_profit_edge');
  if (hasPriorEntry) riskFlags.push('second_entry_guard');
  if (isConsensusConflict) riskFlags.push('market_consensus_conflict');
  if (outputs.some((o) => (o.marketPrice >= skipNearCertainPrice || o.noMarketPrice >= skipNearCertainPrice))) {
    riskFlags.push('market_already_priced');
  }
  if (best && best.sideProbability < effectiveMinSideProb) riskFlags.push('low_confidence');
  if (maturity != null && maturity < 45) riskFlags.push('low_weather_maturity');
  if (input.scenarioTag === 'suppressed_heating') riskFlags.push('suppressed_heating');
  if (lockTriggered) riskFlags.push('temperature_locked');
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
    sideProbability: best?.sideProbability ?? 0,
    entryPrice: best ? (best.bestSide === 'YES' ? best.marketPrice : best.noMarketPrice) : 1,
    riskModifier,
    kellyFraction: Number(process.env.KELLY_FRACTION ?? '0.25'),
    maxSingleRiskPercent: Number(process.env.MAX_SINGLE_RISK_PERCENT ?? '0.02'),
    dailyRiskPercent: Number(process.env.DAILY_RISK_PERCENT ?? '0.05')
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
    ? `当前没有同时满足净利润、胜率与可交易门槛的盘口（最小胜率 ${(effectiveMinSideProb * 100).toFixed(0)}%，近确定性价格已过滤），建议 PASS。`
    : `最高温目标温度按 ${lockedTargetTemp}°C 进行全局联动约束（仅目标bin允许YES，其余为NO）。可交易净Edge约 ${(edge * 100).toFixed(1)}%，优先方向为 ${best?.bestSide ?? '-'}，对应胜率约 ${((best?.sideProbability ?? 0) * 100).toFixed(0)}%。`;
  const profitabilityTipEn = !candidates.length
    ? `No bin meets both net-profit and win-rate thresholds (min win-rate ${(effectiveMinSideProb * 100).toFixed(0)}%); PASS is recommended.`
    : `Global mutually-exclusive constraint is applied with target temperature ${lockedTargetTemp}°C (only target bin can be YES; all others are NO). Tradable net edge is about ${(edge * 100).toFixed(1)}%, preferred side is ${best?.bestSide ?? '-'} with estimated win-rate ${((best?.sideProbability ?? 0) * 100).toFixed(0)}%.`;
  const consensusTip = consensusDowngraded
    ? `当前盘口主共识在 ${input.marketConsensusBin}（价格 ${(input.marketConsensusPrice! * 100).toFixed(1)}%），与模型优先方向冲突，已从 BUY 降级为 WATCH。`
    : isConsensusConflict
      ? `当前盘口主共识在 ${input.marketConsensusBin}（价格 ${(input.marketConsensusPrice! * 100).toFixed(1)}%），与模型优先方向存在冲突，已纳入风控评估。`
      : '';
  const consensusTipEn = consensusDowngraded
    ? `Strong market consensus is ${input.marketConsensusBin} (${((input.marketConsensusPrice ?? 0) * 100).toFixed(1)}%), conflicting with model preference; BUY is downgraded to WATCH.`
    : isConsensusConflict
      ? `Strong market consensus is ${input.marketConsensusBin} (${((input.marketConsensusPrice ?? 0) * 100).toFixed(1)}%), which conflicts with model preference and is included in risk control evaluation.`
      : '';
  const secondEntryTip = hasPriorEntry
    ? `同目标日已存在历史入场，本次启用二次入场保护（最小Edge ${(effectiveMinEdge * 100).toFixed(1)}%，最小胜率 ${(effectiveMinSideProb * 100).toFixed(0)}%）。`
    : '';
  const secondEntryTipEn = hasPriorEntry
    ? `Second-entry guard is active for this target date (min edge ${(effectiveMinEdge * 100).toFixed(1)}%, min win-rate ${(effectiveMinSideProb * 100).toFixed(0)}%).`
    : '';
  const lockTip = lockTriggered ? `已触发“晚盘锁温”规则：当前温度与已观测最高温接近，且未来1-6小时偏降温。` : '';
  const lockTipEn = lockTriggered ? 'Late-session lock rule is active: current temperature is near observed max and next 1-6h trend is cooling.' : '';
  const reasonZh = `目标日全天最高温预测约 ${Math.round(input.maxTempSoFar)}°C，峰值前两小时升温 ${input.tempRise2h.toFixed(1)}°C，时间窗口评分 ${timingScore.toFixed(0)}。模型对 ${best?.outcomeLabel ?? '-'} 的判断已计入价格，${profitabilityTip} 天气稳定度 ${weatherScore.toFixed(0)}，数据质量 ${dataQualityScore.toFixed(0)}，综合建议${decisionZh}。${secondEntryTip}${consensusTip}${lockTip}${mismatchTip}${settleTip}${inactiveTip}`;
  const reasonEn = `Forecast max temperature for target day is about ${Math.round(input.maxTempSoFar)}°C, with ${input.tempRise2h.toFixed(1)}°C rise in the 2 hours before peak and timing score ${timingScore.toFixed(0)}. Model view on ${best?.outcomeLabel ?? '-'} is compared against market pricing; ${profitabilityTipEn} Weather stability is ${weatherScore.toFixed(0)} and data quality is ${dataQualityScore.toFixed(0)}. Overall recommendation: ${decisionEn}. ${secondEntryTipEn}${consensusTipEn}${lockTipEn}${mismatchTipEn}${settleTipEn}${inactiveTipEn}`.trim();
  const reason = `${reasonZh}\nEN: ${reasonEn}`;

  const finalPositionSize = isClosedByTime || isInactive || finalDecision !== 'BUY' ? 0 : positionSize;
  const portfolioEV = edge * finalPositionSize;

  return {
    decision: finalDecision,
    recommendedBin: best?.outcomeLabel ?? '-',
    recommendedSide: best?.bestSide ?? 'YES',
    edge,
    theoreticalEV: best ? (best.bestSide === 'YES' ? best.theoreticalEVYes : best.theoreticalEVNo) : edge,
    tradableEV: edge,
    portfolioEV,
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
      .map((o) => ({
        ...o,
        portfolioEV: (o.bestSide === 'YES' ? o.tradableEVYes : o.tradableEVNo) * finalPositionSize
      }))
  };
}
