export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshAllButton } from '@/components/market/refresh-all-button';
import { LiveMarketPoller } from '@/components/market/live-market-poller';
import { getDashboardData } from '@/lib/services/query';
import { fromJsonString } from '@/lib/utils/json';
import { riskLabel } from '@/lib/i18n/risk-labels';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import { calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';

type PageSearchParams = Promise<{ lang?: string | string[] }>;

export default async function HomePage({ searchParams }: { searchParams: PageSearchParams }) {
  const sp = await searchParams;
  const lang = (Array.isArray(sp?.lang) ? sp.lang[0] : sp?.lang) === 'en' ? 'en' : 'zh';
  const t =
    lang === 'en'
      ? {
          mode: 'Research Mode',
          title: 'Decision / Position / Reason',
          city: 'Shanghai',
          warningPrefix: 'Warning: data may be incomplete',
          warningMarket: 'market',
          warningWeather: 'weather',
          weatherErrors: 'weather source errors',
          strictBlock: 'Strict mode: at least one weather source is missing. Forecast and recommendation are blocked.',
          strictMissing: 'Missing sources',
          weatherStaleWarn: 'Weather data freshness is insufficient',
          staleThreshold: 'threshold',
          weatherDateMismatch: 'Weather date mismatch',
          nonDirectResolution: 'Wunderground direct resolution source is not connected yet; proxy weather estimate only.',
          settledTitle: 'Market is in settlement window or closed',
          settledForcePass: 'System output is forced to PASS and position is 0.',
          resolutionCard: 'Resolution Standard Card',
          station: 'Resolution Station',
          stationCode: 'Station Code',
          source: 'Source',
          sourceUrl: 'Source URL',
          open: 'Open',
          precision: 'Precision Rule',
          finalizeRule: 'Finalization Rule',
          marketSource: 'Market Data Source',
          weatherSource: 'Weather Data Source',
          apiStatusTitle: 'Weather API Status',
          status: 'Status',
          reason: 'Reason',
          statusOk: 'ok',
          statusNoData: 'no_data',
          statusFetchError: 'fetch_error',
          statusParseError: 'parse_error',
          statusSkipped: 'skipped',
          statusFallbackProxy: 'fallback_proxy',
          settlementTime: 'Settlement Time',
          minsToSettlement: 'Minutes to Settlement',
          mins: 'min',
          assistNote: 'Assist weather data is not final resolution basis. Final resolution follows Polymarket rules and Wunderground station source.',
          recentSettlement: 'Recent Settlement Result',
          finalTemp: 'Final Max Temp',
          winningBin: 'Winning Bin',
          settledAt: 'Settled At',
          settledSource: 'Settlement Source',
          wuHistory: 'Wunderground History Page',
          marketPanel: 'Market Board',
          marketSlug: 'Market Slug',
          marketTitle: 'Title',
          targetDate: 'Target Date',
          weatherTargetDate: 'Weather Target Date',
          weatherObservedAt: 'Weather Observed At',
          weatherFetchedAt: 'Weather Fetched At',
          weatherFreshness: 'Weather Freshness',
          volume: 'Volume',
          sourceMarketLink: 'Polymarket Link',
          openPolymarket: 'Open Polymarket',
          modelPanel: 'Model Board',
          dayMaxForecast: 'Target Day Max Temp Forecast',
          dayMaxContinuous: 'Fused Continuous',
          dayMaxAnchor: 'Settlement Anchor',
          sourceBreakdown: 'Source Breakdown',
          weightBreakdown: 'Fusion Weight Breakdown',
          sourceCol: 'Source',
          rawTempCol: 'Raw',
          adjTempCol: 'Adjusted',
          weightCol: 'Weight',
          weatherApi: 'WeatherAPI',
          qweather: 'QWeather',
          freeSources: 'Free Sources',
          paidSources: 'Paid Sources',
          nowcastingPanel: 'Nowcasting Panel',
          currentTemp: 'Current Temp',
          todayObservedMax: 'Today Max So Far',
          cloudCover: 'Cloud Cover',
          precipProb: 'Precip Probability',
          wind: 'Wind',
          windDir: 'Wind Dir',
          future1to3h: 'Next 1-3h Forecast',
          scenarioTag: 'Scenario',
          weatherMaturity: 'Weather Maturity Score',
          learnedPeakWindow: 'Learned Peak Window (30d ZSPD)',
          learnedPeakWindowSamples: 'Sample Days',
          apiWuRealtime: 'Wunderground Realtime (ZSPD)',
          apiWuDaily: 'Wunderground Daily Max',
          apiWuHistory: 'Wunderground 30d History',
          apiOpenMeteo: 'Open-Meteo',
          apiWttr: 'wttr',
          apiMetNo: 'met.no',
          apiWeatherApi: 'WeatherAPI',
          apiQweather: 'QWeather',
          stableSunny: 'Stable Sunny',
          suppressedHeating: 'Suppressed Heating',
          neutral: 'Neutral',
          fused: 'Fused',
          whyForecast: 'Why this forecast value',
          resolutionPriorityNote: 'Note: auxiliary weather sources are not final settlement basis. Final settlement follows Wunderground ZSPD.',
          fusionMethod: 'Fusion Method',
          sourceSpread: 'Cross-source Spread',
          confidence: 'Confidence',
          forecastConfidence: { high: 'High', medium: 'Medium', low: 'Low' },
          opportunityRanking: 'Top Profit Opportunities (Net EV)',
          actionableTop3: 'Actionable Priority (Top 3)',
          lockHintTitle: 'Lock-Temperature Gate',
          lockLikely: 'Likely locked near settlement; avoid contrarian bets.',
          lockOpen: 'Not locked yet; keep monitoring intraday updates.',
          lockReason: 'Reason',
          rank: 'Rank',
          side: 'Side',
          modelProb: 'Model Prob',
          marketPx: 'Market Px',
          grossEdge: 'Gross EV',
          netEdge: 'Net EV',
          rise123h: 'Rise before peak 1h/2h/3h',
          peakCloud: 'Cloud cover at peak',
          peakPrecip: 'Precip proxy at peak',
          peakWind: 'Wind speed at peak',
          decisionPanel: 'Trading Decision Board',
          topEdge: 'Top net edge opportunity',
          decision: 'Decision',
          buy: 'BUY',
          watch: 'WATCH',
          pass: 'PASS',
          recBin: 'Recommended Bin',
          recSide: 'Recommended Side',
          edge: 'Edge',
          tradeScore: 'Trade Score',
          position: 'Position Size',
          timingScore: 'Timing Score',
          weatherScore: 'Weather Stability Score',
          dataQualityScore: 'Data Quality Score',
          noDecision: 'No decision yet. Please refresh.',
          bankrollCalc: 'Bankroll Calculator',
          bankrollBase: 'Base Capital',
          bankrollStake: 'Recommended Stake',
          bankrollProb: 'Side Prob',
          bankrollPrice: 'Entry Price',
          sourceBiasTitle: 'Source Bias vs ZSPD (Historical)',
          avgBias: 'Avg Bias',
          mae: 'MAE',
          samples: 'N',
          detail: 'View Details',
          allBins: 'All Bins',
          focusedBins: 'Focused Tradable Bins (Center ±2)',
          tailBins: 'Tail Bins (low-value, collapsed)',
          centerTemp: 'Center Temp',
          bin: 'Bin',
          ask: 'Executable Ask',
          noPrice: 'No Price',
          bid: 'Bid',
          spread: 'Spread',
          modelYes: 'Model Yes',
          modelNo: 'Model No',
          evConstrained: 'EV(Constrained)',
          preferredSide: 'Preferred Side',
          snapshots: 'Recent Snapshots',
          score: 'Score',
          apiLive: 'Live API',
          unknown: 'Unknown'
        }
      : {
          mode: '研究模式',
          title: '决策 / 仓位 / 理由',
          city: '上海（Shanghai）',
          warningPrefix: '警告：当前数据可能不完整',
          warningMarket: '市场',
          warningWeather: '天气',
          weatherErrors: '天气源异常',
          strictBlock: '严格模式：存在缺失天气源，预测与交易建议已禁用。',
          strictMissing: '缺失数据源',
          weatherStaleWarn: '天气数据新鲜度不足',
          staleThreshold: '阈值',
          weatherDateMismatch: '天气日期不匹配',
          nonDirectResolution: '当前尚未直接接入 Wunderground 结算源，只能用代理天气源估算。',
          settledTitle: '当前市场已到结算窗口或已关闭',
          settledForcePass: '系统已强制输出 PASS，仓位为 0。',
          resolutionCard: '结算口径标准卡',
          station: '结算站点',
          stationCode: '站点代码',
          source: '来源',
          sourceUrl: '来源链接',
          open: '打开',
          precision: '精度规则',
          finalizeRule: '最终规则',
          marketSource: '市场数据来源',
          weatherSource: '天气数据来源',
          apiStatusTitle: '天气源状态',
          status: '状态',
          reason: '原因',
          statusOk: '正常',
          statusNoData: '无数据',
          statusFetchError: '拉取失败',
          statusParseError: '解析失败',
          statusSkipped: '未启用',
          statusFallbackProxy: '代理回填',
          settlementTime: '结算时间',
          minsToSettlement: '距结算',
          mins: '分钟',
          assistNote: '辅助天气数据不是最终结算依据，结算以 Polymarket 规则页与 Wunderground 指定站点为准。',
          recentSettlement: '最近结算结果',
          finalTemp: '最终最高温',
          winningBin: '命中盘口',
          settledAt: '结算时间',
          settledSource: '结算来源',
          wuHistory: 'Wunderground 历史页',
          marketPanel: '市场面板',
          marketSlug: '市场标识',
          marketTitle: '标题',
          targetDate: '目标日期',
          weatherTargetDate: '天气数据目标日期',
          weatherObservedAt: '天气观测时间',
          weatherFetchedAt: '天气抓取时间',
          weatherFreshness: '天气新鲜度',
          volume: '成交量',
          sourceMarketLink: '原站盘口',
          openPolymarket: '打开 Polymarket',
          modelPanel: '模型面板',
          dayMaxForecast: '目标日全天最高温预测',
          dayMaxContinuous: '连续融合值',
          dayMaxAnchor: '结算锚点',
          sourceBreakdown: '来源拆解',
          weightBreakdown: '融合权重拆解',
          sourceCol: '来源',
          rawTempCol: '原始',
          adjTempCol: '校准后',
          weightCol: '权重',
          weatherApi: 'WeatherAPI',
          qweather: 'QWeather',
          freeSources: '免费源',
          paidSources: '付费源',
          nowcastingPanel: '短临决策面板',
          currentTemp: '当前温度',
          todayObservedMax: '今日已录得最高温',
          cloudCover: '云量',
          precipProb: '降雨概率',
          wind: '风速',
          windDir: '风向',
          future1to3h: '未来1-3小时',
          scenarioTag: '场景标签',
          weatherMaturity: '天气成熟度评分',
          learnedPeakWindow: '近30天学习峰值窗口(ZSPD)',
          learnedPeakWindowSamples: '样本天数',
          apiWuRealtime: 'Wunderground 实时(ZSPD)',
          apiWuDaily: 'Wunderground 次日最高温',
          apiWuHistory: 'Wunderground 30天历史',
          apiOpenMeteo: 'Open-Meteo',
          apiWttr: 'wttr',
          apiMetNo: 'met.no',
          apiWeatherApi: 'WeatherAPI',
          apiQweather: 'QWeather',
          stableSunny: '稳定升温',
          suppressedHeating: '压温场景',
          neutral: '中性',
          fused: '融合',
          whyForecast: '为什么是这个预测值',
          resolutionPriorityNote: '注意：辅助天气源不是最终结算依据，最终结算以 Wunderground 的 ZSPD 站点为准。',
          fusionMethod: '融合方法',
          sourceSpread: '源间分歧',
          confidence: '置信度',
          forecastConfidence: { high: '高', medium: '中', low: '低' },
          opportunityRanking: '最可能赚钱机会（按净EV）',
          actionableTop3: '可执行优先级（Top 3）',
          lockHintTitle: '锁温门槛提示',
          lockLikely: '接近结算且温度大概率锁定，避免逆向下注。',
          lockOpen: '尚未锁温，继续跟踪盘面与短临变化。',
          lockReason: '依据',
          rank: '排名',
          side: '方向',
          modelProb: '模型概率',
          marketPx: '市场价格',
          grossEdge: '毛EV',
          netEdge: '净EV',
          rise123h: '峰值前升温 1h/2h/3h',
          peakCloud: '峰值时云量',
          peakPrecip: '峰值时降水代理',
          peakWind: '峰值时风速',
          decisionPanel: '交易决策面板',
          topEdge: '最高净利润机会',
          decision: '决策',
          buy: '买入',
          watch: '观察',
          pass: '放弃',
          recBin: '推荐 Bin',
          recSide: '推荐方向',
          edge: 'Edge',
          tradeScore: '交易评分',
          position: '建议仓位',
          timingScore: '时点评分',
          weatherScore: '天气稳定分',
          dataQualityScore: '数据质量分',
          noDecision: '暂无决策，请刷新后查看。',
          bankrollCalc: '资金仓位计算器',
          bankrollBase: '基准本金',
          bankrollStake: '建议下注金额',
          bankrollProb: '方向胜率',
          bankrollPrice: '入场价格',
          sourceBiasTitle: '数据源相对ZSPD历史偏差',
          avgBias: '平均偏差',
          mae: 'MAE',
          samples: '样本数',
          detail: '查看详情',
          allBins: '全部盘口（Bin）',
          focusedBins: '聚焦可交易盘口（中心温度±2）',
          tailBins: '尾部盘口（低价值，折叠）',
          centerTemp: '中心温度',
          bin: '盘口',
          ask: '可成交价(ask)',
          noPrice: '反向价格(No)',
          bid: '买一价(bid)',
          spread: '价差(spread)',
          modelYes: '模型Yes',
          modelNo: '模型No',
          evConstrained: 'EV(联动)',
          preferredSide: '优先方向',
          snapshots: '最近快照',
          score: '分数',
          apiLive: '实时API',
          unknown: '未知'
        };

  const data = await getDashboardData();
  const sourceLabel = (s?: string) => (s === 'api' ? t.apiLive : t.unknown);
  const decisionLabel = (d?: string) => (d === 'BUY' ? t.buy : d === 'WATCH' ? t.watch : t.pass);
  const weatherRaw = fromJsonString<{ raw?: { errors?: string[] } }>(data?.latestWeather?.rawJson, {});
  const weatherErrors = weatherRaw.raw?.errors ?? [];
  const strictReady = (weatherRaw.raw as { strictReady?: boolean } | undefined)?.strictReady ?? false;
  const missingSources = (weatherRaw.raw as { missingSources?: string[] } | undefined)?.missingSources ?? [];
  const sourceDailyMax = (weatherRaw.raw as { sourceDailyMax?: { wundergroundDaily?: number | null; openMeteo?: number | null; wttr?: number | null; metNo?: number | null; weatherApi?: number | null; qWeather?: number | null; cmaChina?: number | null; fused?: number | null; fusedContinuous?: number | null; fusedAnchor?: number | null; spread?: number | null } } | undefined)?.sourceDailyMax;
  const apiStatusMap = (weatherRaw.raw as {
    apiStatus?: Record<string, { status: string; reason?: string; hasData?: boolean }>;
  } | undefined)?.apiStatus ?? {};
  const nowcasting = (weatherRaw.raw as {
    nowcasting?: {
      currentTemp?: number;
      todayMaxTemp?: number;
      tempRise1h?: number;
      tempRise2h?: number;
      tempRise3h?: number;
      cloudCover?: number;
      precipitationProb?: number;
      windSpeed?: number;
      windDirection?: number | null;
      scenarioTag?: string;
      weatherMaturityScore?: number;
      futureHours?: Array<{
        hourOffset: number;
        temp: number;
        cloudCover: number;
        precipitationProb: number;
        windSpeed: number;
        windDirection?: number | null;
      }>;
    };
  } | undefined)?.nowcasting;
  const forecastExplain = (weatherRaw.raw as {
    forecastExplain?: {
      zh?: string;
      en?: string;
      method?: string;
      confidence?: 'high' | 'medium' | 'low';
      weightBreakdown?: Array<{ source: string; raw: number; adjusted: number; weight: number }>;
    };
  } | undefined)?.forecastExplain;
  const learnedPeakWindow = (weatherRaw.raw as { learnedPeakWindow?: { startHour?: number; endHour?: number; sampleDays?: number } } | undefined)?.learnedPeakWindow;
  const resolutionSourceStatus = (weatherRaw.raw as { resolutionSourceStatus?: string } | undefined)?.resolutionSourceStatus;
  const weatherTargetDate = (weatherRaw.raw as { targetDate?: string } | undefined)?.targetDate;
  const weatherObservedAt = (weatherRaw.raw as { nowcasting?: { observedAt?: string } } | undefined)?.nowcasting?.observedAt;
  const weatherFetchedAt = (weatherRaw.raw as { fetchedAtIso?: string } | undefined)?.fetchedAtIso;
  const weatherFreshnessMinutes = (() => {
    const base = weatherFetchedAt ?? weatherObservedAt;
    if (!base) return null;
    const ts = new Date(base).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 60000));
  })();
  const weatherStaleThresholdMinutes = Number(process.env.WEATHER_STALE_MINUTES ?? '15');
  const isWeatherStale = weatherFreshnessMinutes != null
    && Number.isFinite(weatherStaleThresholdMinutes)
    && weatherStaleThresholdMinutes > 0
    && weatherFreshnessMinutes > weatherStaleThresholdMinutes;
  const decisionMeta = (data?.latestDecision?.reasonMeta ?? {}) as {
    calibratedFusedTemp?: number;
    mostLikelyInteger?: number;
    sourceCalibration?: Array<{ code: string; raw: number; bias: number; mae: number; adjusted: number; weight: number; sampleSize: number }>;
  };
  const statusLabel = (s?: string) => {
    if (s === 'ok') return t.statusOk;
    if (s === 'no_data') return t.statusNoData;
    if (s === 'fetch_error') return t.statusFetchError;
    if (s === 'parse_error') return t.statusParseError;
    if (s === 'skipped') return t.statusSkipped;
    if (s === 'fallback_proxy') return t.statusFallbackProxy;
    return s ?? '-';
  };
  const apiRows = [
    { code: 'wunderground', label: t.apiWuRealtime },
    { code: 'wunderground_daily', label: t.apiWuDaily },
    { code: 'wunderground_history', label: t.apiWuHistory },
    { code: 'open_meteo', label: t.apiOpenMeteo },
    { code: 'wttr', label: t.apiWttr },
    { code: 'met_no', label: t.apiMetNo },
    { code: 'weatherapi', label: t.apiWeatherApi },
    { code: 'qweather', label: t.apiQweather }
  ];
  const scenarioLabel = (tag?: string) => {
    if (tag === 'stable_sunny') return t.stableSunny;
    if (tag === 'suppressed_heating') return t.suppressedHeating;
    return t.neutral;
  };
  const outputMap = new Map((data?.latestRun?.outputs ?? []).map((o) => [o.outcomeLabel, o]));
  const allBins = (data?.market.bins ?? []).map((b) => {
    const out = outputMap.get(b.outcomeLabel);
    const modelYes = out?.modelProbability ?? 0;
    const modelNo = 1 - modelYes;
    const noPrice = b.noMarketPrice ?? (1 - b.marketPrice);
    const edgeYes = modelYes - b.marketPrice;
    const edgeNo = modelNo - noPrice;
    return {
      label: b.outcomeLabel,
      marketPrice: b.marketPrice,
      noMarketPrice: noPrice,
      bestBid: b.bestBid ?? null,
      spread: b.spread ?? null,
      modelProbability: modelYes,
      modelNoProbability: modelNo,
      edgeYes,
      edgeNo,
      bestEdge: Math.max(edgeYes, edgeNo),
      bestSide: 'YES' as const,
      edge: out?.edge ?? 0
    };
  });
  const centerTempRaw = decisionMeta.mostLikelyInteger ?? decisionMeta.calibratedFusedTemp ?? sourceDailyMax?.fusedContinuous ?? sourceDailyMax?.fused ?? null;
  const centerTemp = typeof centerTempRaw === 'number' && Number.isFinite(centerTempRaw) ? Math.round(centerTempRaw) : null;
  const isTargetBin = (label: string) => {
    if (centerTemp == null) return false;
    const p = parseTemperatureBin(label);
    if (p.min != null && p.max != null) return centerTemp >= p.min && centerTemp < p.max;
    if (p.min != null && p.max == null) return centerTemp >= p.min;
    if (p.min == null && p.max != null) return centerTemp < p.max;
    return false;
  };
  const allBinsWithGlobalSide = allBins.map((b) => {
    const side = isTargetBin(b.label) ? 'YES' : 'NO';
    const edge = side === 'YES' ? b.edgeYes : b.edgeNo;
    return { ...b, bestSide: side as 'YES' | 'NO', bestEdge: edge, constrainedEv: edge };
  });
  const focusMin = centerTemp != null ? centerTemp - 2.5 : null;
  const focusMax = centerTemp != null ? centerTemp + 2.5 : null;
  const highProbLabels = new Set(
    allBinsWithGlobalSide
      .filter((b) => b.constrainedEv >= 0.03 || b.label === data?.latestDecision?.recommendedBin)
      .map((b) => b.label),
  );
  const isFocusedBin = (label: string) => {
    if (highProbLabels.has(label)) return true;
    if (focusMin == null || focusMax == null) return true;
    const p = parseTemperatureBin(label);
    if (p.min == null && p.max == null) return true;
    const lo = p.min ?? Number.NEGATIVE_INFINITY;
    const hi = p.max ?? Number.POSITIVE_INFINITY;
    return hi > focusMin && lo < focusMax;
  };
  const focusedBins = allBinsWithGlobalSide.filter((b) => isFocusedBin(b.label));
  const tailBins = allBinsWithGlobalSide.filter((b) => !isFocusedBin(b.label));
  const topProfit = [...allBinsWithGlobalSide].sort((a, b) => b.bestEdge - a.bestEdge)[0];
  const tradingCost = Number(process.env.TRADING_COST_PER_TRADE ?? '0.01');
  const rankingBaseBins = focusedBins.length > 0 ? focusedBins : allBinsWithGlobalSide;
  const opportunityRows = [...rankingBaseBins]
    .map((b) => {
      const side = b.bestSide;
      const modelProb = side === 'YES' ? b.modelProbability : b.modelNoProbability;
      const marketPx = side === 'YES' ? b.marketPrice : b.noMarketPrice;
      const grossEdge = b.bestEdge;
      const netEdge = grossEdge - tradingCost;
      return { label: b.label, side, modelProb, marketPx, grossEdge, netEdge };
    })
    .sort((a, b) => b.netEdge - a.netEdge)
    .slice(0, 8);
  const actionableRows = opportunityRows
    .filter((r) => r.netEdge > 0 && r.marketPx >= 0.02 && r.marketPx <= 0.98)
    .slice(0, 3);
  const biasStats = data?.biasStats ?? [];
  const recBin = data?.latestDecision?.recommendedBin;
  const recSide = data?.latestDecision?.recommendedSide;
  const recRow = allBinsWithGlobalSide.find((b) => b.label === recBin);
  const stakeBase = 1000;
  const sideProb = recRow
    ? (recSide === 'NO' ? recRow.modelNoProbability : recRow.modelProbability)
    : 0;
  const entryPrice = recRow
    ? (recSide === 'NO' ? recRow.noMarketPrice : recRow.marketPrice)
    : 1;
  const riskModifier = calculateRiskModifier({
    cloudCover: nowcasting?.cloudCover ?? 0,
    precipitationProb: nowcasting?.precipitationProb ?? 0,
    tempRise1h: nowcasting?.tempRise1h ?? 0
  });
  const bankrollStake = calculatePositionSize({
    totalCapital: stakeBase,
    maxSingleTradePercent: Number(process.env.MAX_SINGLE_TRADE_PERCENT ?? '0.1'),
    edge: Math.max(0, data?.latestDecision?.edge ?? 0),
    sideProbability: sideProb,
    entryPrice,
    riskModifier,
    kellyFraction: Number(process.env.KELLY_FRACTION ?? '0.25'),
    maxSingleRiskPercent: Number(process.env.MAX_SINGLE_RISK_PERCENT ?? '0.02'),
    dailyRiskPercent: Number(process.env.DAILY_RISK_PERCENT ?? '0.05')
  });
  const marketUpdatedAt = (data?.market.bins ?? [])
    .map((b) => b.updatedAt ? new Date(b.updatedAt).getTime() : 0)
    .reduce((acc, x) => Math.max(acc, x), 0);
  const marketUpdatedAtIso = marketUpdatedAt > 0 ? new Date(marketUpdatedAt).toISOString() : null;
  const minutesToSettlement = data?.marketStatus?.minutesToSettlement ?? null;
  const nearSettlement = typeof minutesToSettlement === 'number' && minutesToSettlement <= 180;
  const futureCapped =
    (nowcasting?.futureHours ?? []).slice(0, 3).length > 0 &&
    (nowcasting?.futureHours ?? []).slice(0, 3).every((h) => h.temp <= (nowcasting?.todayMaxTemp ?? Number.POSITIVE_INFINITY) + 0.2);
  const stalledRise = (nowcasting?.tempRise1h ?? 0) <= 0;
  const lockLikely = Boolean(
    data?.marketStatus?.isSettled ||
      (nearSettlement && nowcasting?.todayMaxTemp != null && nowcasting?.currentTemp != null && futureCapped && stalledRise),
  );
  const lockReason = data?.marketStatus?.isSettled
    ? `${t.settledTitle}`
    : `near_settlement=${nearSettlement ? 'yes' : 'no'}, stalled_rise=${stalledRise ? 'yes' : 'no'}, future_not_break_max=${futureCapped ? 'yes' : 'no'}`;

  return (
    <SiteShell currentPath="/" lang={lang}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t.mode}</p>
          <h1 className="text-xl font-semibold">{t.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded border bg-background px-3 text-sm" defaultValue="Shanghai">
            <option value="Shanghai">{t.city}</option>
          </select>
          <RefreshAllButton lang={lang} />
        </div>
      </div>
      <LiveMarketPoller
        lang={lang}
        marketUpdatedAt={marketUpdatedAtIso}
        weatherUpdatedAt={weatherFetchedAt ?? weatherObservedAt ?? null}
      />

      {(data?.marketSource !== 'api' || data?.weatherSource !== 'api' || weatherErrors.length > 0 || resolutionSourceStatus !== 'direct' || !strictReady || isWeatherStale) && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-300">
            {t.warningPrefix}（{t.warningMarket}：{sourceLabel(data?.marketSource)}，{t.warningWeather}：{sourceLabel(data?.weatherSource)}）。
            {weatherErrors.length > 0 ? `${t.weatherErrors}：${weatherErrors.join('；')}` : ''}
            {!strictReady ? ` ${t.strictBlock}${missingSources.length ? `（${t.strictMissing}：${missingSources.join(', ')}）` : ''}` : ''}
            {isWeatherStale ? ` ${t.weatherStaleWarn}（${weatherFreshnessMinutes} ${t.mins}，${t.staleThreshold} ${weatherStaleThresholdMinutes} ${t.mins}）` : ''}
            {resolutionSourceStatus !== 'direct' ? ` ${t.nonDirectResolution}` : ''}
            {weatherTargetDate && data?.market?.targetDate && weatherTargetDate !== format(data.market.targetDate, 'yyyy-MM-dd') ? ` ${t.weatherDateMismatch}: weather=${weatherTargetDate}, market=${format(data.market.targetDate, 'yyyy-MM-dd')}` : ''}
          </CardContent>
        </Card>
      )}

      {data?.marketStatus?.isSettled && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-300">
            {t.settledTitle}（{t.settlementTime}：{data?.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}）。
            {t.settledForcePass}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t.resolutionCard}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>{t.station}: {data?.market.resolutionMetadata?.stationName ?? '-'}</p>
          <p>{t.stationCode}: {data?.market.resolutionMetadata?.stationCode ?? '-'}</p>
          <p>{t.source}: {data?.market.resolutionMetadata?.sourceName ?? '-'}</p>
          <p>
            {t.sourceUrl}:{' '}
            {data?.market.resolutionMetadata?.sourceUrl ? (
              <a className="text-primary underline" href={data.market.resolutionMetadata.sourceUrl} target="_blank" rel="noreferrer">{t.open}</a>
            ) : '-'}
          </p>
          <p>{t.precision}: {data?.market.resolutionMetadata?.precisionRule ?? '-'}</p>
          <p>{t.finalizeRule}: {data?.market.resolutionMetadata?.finalizedRule ?? '-'}</p>
          <p>{t.marketSource}: <span className={data?.marketSource === 'api' ? 'text-emerald-400' : 'text-amber-300'}>{sourceLabel(data?.marketSource)}</span></p>
          <p>{t.weatherSource}: <span className={data?.weatherSource === 'api' ? 'text-emerald-400' : 'text-amber-300'}>{sourceLabel(data?.weatherSource)}（Wunderground + Open-Meteo + wttr.in + met.no）</span></p>
          <p>{t.settlementTime}: {data?.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}</p>
          <p>{t.minsToSettlement}: {typeof data?.marketStatus?.minutesToSettlement === 'number' ? `${data.marketStatus.minutesToSettlement} ${t.mins}` : '-'}</p>
          <p>{t.weatherTargetDate}: {weatherTargetDate ?? '-'}</p>
          <p>{t.weatherObservedAt}: {weatherObservedAt ? format(new Date(weatherObservedAt), 'yyyy-MM-dd HH:mm') : '-'}</p>
          <p>{t.weatherFetchedAt}: {weatherFetchedAt ? format(new Date(weatherFetchedAt), 'yyyy-MM-dd HH:mm:ss') : '-'}</p>
          <p>{t.weatherFreshness}: {weatherFreshnessMinutes != null ? `${weatherFreshnessMinutes} ${t.mins}` : '-'}</p>
          <p className="md:col-span-2">{t.assistNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.nowcastingPanel}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid gap-2 md:grid-cols-3">
            <p>{t.currentTemp}: {nowcasting?.currentTemp != null ? `${nowcasting.currentTemp.toFixed(1)}°C` : '-'}</p>
            <p>{t.todayObservedMax}: {nowcasting?.todayMaxTemp != null ? `${nowcasting.todayMaxTemp.toFixed(1)}°C` : '-'}</p>
            <p>{t.rise123h}: {nowcasting?.tempRise1h?.toFixed(2) ?? '-'} / {nowcasting?.tempRise2h?.toFixed(2) ?? '-'} / {nowcasting?.tempRise3h?.toFixed(2) ?? '-'}</p>
            <p>{t.cloudCover}: {nowcasting?.cloudCover != null ? `${nowcasting.cloudCover.toFixed(0)}%` : '-'}</p>
            <p>{t.precipProb}: {nowcasting?.precipitationProb != null ? `${nowcasting.precipitationProb.toFixed(0)}%` : '-'}</p>
            <p>{t.wind}: {nowcasting?.windSpeed != null ? `${nowcasting.windSpeed.toFixed(1)} km/h` : '-'} / {t.windDir} {nowcasting?.windDirection != null ? `${nowcasting.windDirection.toFixed(0)}°` : '-'}</p>
            <p>{t.scenarioTag}: {scenarioLabel(nowcasting?.scenarioTag)}</p>
            <p>{t.weatherMaturity}: {nowcasting?.weatherMaturityScore != null ? nowcasting.weatherMaturityScore.toFixed(0) : '-'}</p>
            <p>
              {t.learnedPeakWindow}:{' '}
              {learnedPeakWindow?.startHour != null && learnedPeakWindow?.endHour != null
                ? `${learnedPeakWindow.startHour.toFixed(1)}-${learnedPeakWindow.endHour.toFixed(1)}`
                : '-'}
              {' | '}
              {t.learnedPeakWindowSamples}: {learnedPeakWindow?.sampleDays ?? '-'}
            </p>
          </div>
          <div className="rounded border border-border/60 p-2">
            <p className="mb-1 text-xs font-medium">{t.future1to3h}</p>
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
              {(nowcasting?.futureHours ?? []).slice(0, 3).map((f) => (
                <div key={f.hourOffset} className="rounded border border-border/40 p-2 text-xs">
                  <p>+{f.hourOffset}h</p>
                  <p>{f.temp.toFixed(1)}°C</p>
                  <p>{t.cloudCover} {f.cloudCover.toFixed(0)}%</p>
                  <p>{t.precipProb} {f.precipitationProb.toFixed(0)}%</p>
                  <p>{t.wind} {f.windSpeed.toFixed(1)} km/h</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border border-border/60 p-2">
            <p className="mb-1 text-xs font-medium">{t.apiStatusTitle}</p>
            <div className="space-y-1">
              {apiRows.map((r) => {
                const item = apiStatusMap[r.code];
                return (
                  <div key={r.code} className="grid grid-cols-12 gap-2 text-xs">
                    <p className="col-span-3">{r.label}</p>
                    <p className="col-span-3">{t.status}: {statusLabel(item?.status)}</p>
                    <p className="col-span-6 text-muted-foreground">{t.reason}: {item?.reason ?? '-'}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {data?.market.settledResult && (
        <Card>
          <CardHeader><CardTitle>{t.recentSettlement}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <p>{t.finalTemp}: {data.market.settledResult.finalValue.toFixed(0)}°C</p>
            <p>{t.winningBin}: {data.market.settledResult.finalOutcomeLabel}</p>
            <p>{t.settledAt}: {format(data.market.settledResult.settledAt, 'yyyy-MM-dd HH:mm')}</p>
            <p>
              {t.settledSource}:{' '}
              <a className="text-primary underline" href={data.market.settledResult.sourceUrl} target="_blank" rel="noreferrer">
                {t.wuHistory}
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t.marketPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t.marketSlug}: {data?.market.marketSlug ?? '-'}</p>
            <p>{t.marketTitle}: {data?.market.marketTitle ?? '-'}</p>
            <p>{t.targetDate}: {data?.market.targetDate ? format(data.market.targetDate, 'yyyy-MM-dd') : '-'}</p>
            <p>{t.volume}: {data?.market.volume?.toFixed(0) ?? '-'}</p>
            {data?.market?.marketSlug && (
              <p>
                {t.sourceMarketLink}:{' '}
                <a
                  className="text-primary underline"
                  href={`https://polymarket.com/zh/event/${data.market.marketSlug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.openPolymarket}
                </a>
              </p>
            )}
            <div className="space-y-1">
              {data?.market.bins.map((b) => (
                <p key={b.id} className="rounded border border-border/60 px-2 py-1 text-xs">
                  {b.outcomeLabel} | {t.ask} {b.marketPrice.toFixed(3)} | {t.bid} {b.bestBid?.toFixed(3) ?? '-'} | {t.spread} {b.spread?.toFixed(3) ?? '-'}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.modelPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded border border-border/60 bg-card/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t.dayMaxForecast}</p>
                <p className="text-lg font-semibold">{strictReady && sourceDailyMax?.fusedAnchor != null ? `${sourceDailyMax.fusedAnchor.toFixed(0)}°C` : '-'}</p>
              </div>
              <div className="rounded border border-border/60 bg-card/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t.dayMaxContinuous}</p>
                <p className="text-lg font-semibold">{strictReady && sourceDailyMax?.fusedContinuous != null ? `${sourceDailyMax.fusedContinuous.toFixed(1)}°C` : '-'}</p>
              </div>
              <div className="rounded border border-border/60 bg-card/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t.todayObservedMax}</p>
                <p className="text-lg font-semibold">{nowcasting?.todayMaxTemp != null ? `${nowcasting.todayMaxTemp.toFixed(1)}°C` : '-'}</p>
              </div>
              <div className="rounded border border-border/60 bg-card/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t.sourceSpread}</p>
                <p className="text-lg font-semibold">{strictReady && sourceDailyMax?.spread != null ? `${sourceDailyMax.spread.toFixed(2)}°C` : '-'}</p>
              </div>
              <div className="rounded border border-border/60 bg-card/40 p-2">
                <p className="text-[11px] text-muted-foreground">{t.confidence}</p>
                <p className="text-lg font-semibold">{strictReady && forecastExplain?.confidence ? t.forecastConfidence[forecastExplain.confidence] : '-'}</p>
              </div>
            </div>

            <div className="rounded border border-border/60 p-2 text-xs space-y-1">
              <p className="font-medium">{t.whyForecast}</p>
              <p className="leading-relaxed">{strictReady ? (lang === 'en' ? (forecastExplain?.en ?? '-') : (forecastExplain?.zh ?? '-')) : t.strictBlock}</p>
              <p className="text-muted-foreground">
                {t.fusionMethod}: {strictReady ? (forecastExplain?.method ?? '-') : '-'}
              </p>
              <p className="text-amber-300">{t.resolutionPriorityNote}</p>
            </div>

            <div className="rounded border border-border/60 p-2 text-xs space-y-1">
              <p className="font-medium">{t.sourceBreakdown}</p>
              <p>
                <span className="text-muted-foreground">{t.freeSources}</span> | Wunderground {sourceDailyMax?.wundergroundDaily != null ? `${Math.round(sourceDailyMax.wundergroundDaily)}°C` : '-'} / Open‑Meteo {sourceDailyMax?.openMeteo != null ? `${Math.round(sourceDailyMax.openMeteo)}°C` : '-'} / wttr {sourceDailyMax?.wttr != null ? `${Math.round(sourceDailyMax.wttr)}°C` : '-'} / met.no {sourceDailyMax?.metNo != null ? `${Math.round(sourceDailyMax.metNo)}°C` : '-'}
              </p>
              <p>
                <span className="text-muted-foreground">{t.paidSources}</span> | {t.weatherApi} {sourceDailyMax?.weatherApi != null ? `${Math.round(sourceDailyMax.weatherApi)}°C` : '-'} / {t.qweather} {(sourceDailyMax?.qWeather ?? sourceDailyMax?.cmaChina) != null ? `${Math.round((sourceDailyMax?.qWeather ?? sourceDailyMax?.cmaChina) ?? 0)}°C` : '-'}
              </p>
            </div>

            <div className="rounded border border-border/60 p-2 text-xs">
              <p className="mb-2 font-medium">{t.weightBreakdown}</p>
              {!strictReady || !(forecastExplain?.weightBreakdown?.length) ? (
                <p className="text-muted-foreground">-</p>
              ) : (
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left">{t.sourceCol}</th>
                      <th className="text-left">{t.rawTempCol}</th>
                      <th className="text-left">{t.adjTempCol}</th>
                      <th className="text-left">{t.weightCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastExplain.weightBreakdown
                      .slice()
                      .sort((a, b) => b.weight - a.weight)
                      .map((w) => (
                        <tr key={w.source} className="border-t border-border/40">
                          <td>{w.source}</td>
                          <td>{w.raw.toFixed(1)}°C</td>
                          <td>{w.adjusted.toFixed(1)}°C</td>
                          <td>{w.weight.toFixed(1)}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <div className="rounded border border-border/60 p-2 text-xs">
                <p className="text-muted-foreground">{t.rise123h}</p>
                <p>{nowcasting?.tempRise1h?.toFixed(2) ?? '-'} / {nowcasting?.tempRise2h?.toFixed(2) ?? '-'} / {nowcasting?.tempRise3h?.toFixed(2) ?? '-'}</p>
              </div>
              <div className="rounded border border-border/60 p-2 text-xs">
                <p className="text-muted-foreground">{t.peakCloud} / {t.peakPrecip}</p>
                <p>{nowcasting?.cloudCover?.toFixed(0) ?? '-'}% / {nowcasting?.precipitationProb != null ? `${nowcasting.precipitationProb.toFixed(0)}%` : '-'}</p>
              </div>
              <div className="rounded border border-border/60 p-2 text-xs">
                <p className="text-muted-foreground">{t.peakWind}</p>
                <p>{nowcasting?.windSpeed?.toFixed(1) ?? '-'} km/h</p>
              </div>
            </div>

            <div className="rounded border border-border/60 p-2">
              <p className="mb-2 text-xs font-medium">{t.opportunityRanking}</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">{t.rank}</th>
                    <th className="text-left">{t.bin}</th>
                    <th className="text-left">{t.side}</th>
                    <th className="text-left">{t.modelProb}</th>
                    <th className="text-left">{t.marketPx}</th>
                    <th className="text-left">{t.netEdge}</th>
                  </tr>
                </thead>
                <tbody>
                  {strictReady ? opportunityRows.map((r, idx) => (
                    <tr key={`${r.label}-${r.side}`} className="border-t border-border/40">
                      <td>{idx + 1}</td>
                      <td>{r.label}</td>
                      <td>{r.side}</td>
                      <td>{(r.modelProb * 100).toFixed(1)}%</td>
                      <td>{(r.marketPx * 100).toFixed(1)}%</td>
                      <td className={r.netEdge >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.netEdge.toFixed(3)}</td>
                    </tr>
                  )) : (
                    <tr className="border-t border-border/40">
                      <td colSpan={6} className="py-2 text-amber-300">{t.strictBlock}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-border/60 p-2 text-xs">
              <p className="mb-2 font-medium">{t.sourceBiasTitle}</p>
              <div className="space-y-1">
                {(biasStats.length ? biasStats : []).map((s) => (
                  <p key={`${s.sourceCode}-${s.sourceGroup}`} className="grid grid-cols-12 gap-2">
                    <span className="col-span-3">{s.sourceCode}</span>
                    <span className="col-span-3 text-muted-foreground">{t.avgBias}: {s._avg.bias?.toFixed(2) ?? '-'}°C</span>
                    <span className="col-span-3 text-muted-foreground">{t.mae}: {s._avg.absError?.toFixed(2) ?? '-'}°C</span>
                    <span className="col-span-3 text-muted-foreground">{t.samples}: {s._count.sourceCode}</span>
                  </p>
                ))}
                {!biasStats.length && <p className="text-muted-foreground">-</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.decisionPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
              {t.topEdge}：{topProfit?.label ?? '-'} / {(topProfit?.bestSide ?? '-')}（Edge {(topProfit?.bestEdge ?? 0).toFixed(3)}）
            </p>
            <div className={`rounded border p-2 text-xs ${lockLikely ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
              <p className="font-medium">{t.lockHintTitle}</p>
              <p>{lockLikely ? t.lockLikely : t.lockOpen}</p>
              <p className="text-muted-foreground">{t.lockReason}: {lockReason}</p>
            </div>
            <div className="flex items-center gap-2">
              <span>{t.decision}:</span>
              <Badge variant={data?.latestDecision?.decision === 'BUY' ? 'success' : data?.latestDecision?.decision === 'WATCH' ? 'warning' : 'secondary'}>
                {decisionLabel(data?.latestDecision?.decision)}
              </Badge>
            </div>
            <p>{t.recBin}: {data?.latestDecision?.recommendedBin ?? '-'}</p>
            <p>{t.recSide}: {data?.latestDecision?.recommendedSide ?? '-'}</p>
            <p>{t.edge}: {data?.latestDecision?.edge?.toFixed(3) ?? '-'}</p>
            <p>{t.tradeScore}: {data?.latestDecision?.tradeScore?.toFixed(2) ?? '-'}</p>
            <p>{t.timingScore}: {data?.latestDecision?.timingScore?.toFixed(0) ?? '-'}</p>
            <p>{t.weatherScore}: {data?.latestDecision?.weatherScore?.toFixed(0) ?? '-'}</p>
            <p>{t.dataQualityScore}: {data?.latestDecision?.dataQualityScore?.toFixed(0) ?? '-'}</p>
            <div className="rounded border border-border/60 p-2 text-xs space-y-1">
              <p className="font-medium">{t.bankrollCalc}</p>
              <p>{t.bankrollBase}: {stakeBase}u</p>
              <p>{t.bankrollProb}: {(sideProb * 100).toFixed(1)}%</p>
              <p>{t.bankrollPrice}: {(entryPrice * 100).toFixed(1)}%</p>
              <p className="text-emerald-300">{t.bankrollStake}: {bankrollStake.toFixed(2)}u</p>
            </div>
            <div className="rounded border border-border/60 p-2 text-xs space-y-1">
              <p className="font-medium">{t.actionableTop3}</p>
              {strictReady && actionableRows.length > 0 ? actionableRows.map((r, idx) => (
                <p key={`${r.label}-${r.side}`} className="grid grid-cols-12 gap-2">
                  <span className="col-span-1">{idx + 1}</span>
                  <span className="col-span-3">{r.label}</span>
                  <span className="col-span-2">{r.side}</span>
                  <span className="col-span-3">{(r.marketPx * 100).toFixed(1)}%</span>
                  <span className="col-span-3 text-emerald-400">{r.netEdge.toFixed(3)}</span>
                </p>
              )) : (
                <p className="text-muted-foreground">-</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {(data?.latestDecision?.riskFlags ?? []).map((r) => (
                <span key={r} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{riskLabel(r, lang)}</span>
              ))}
            </div>
            <p className="rounded border border-border/60 p-2 text-xs">{(lang === 'en' ? data?.latestDecision?.reasonEn : data?.latestDecision?.reasonZh) ?? t.noDecision}</p>
            {data?.market && <Link className="text-sm text-primary underline" href={`/market/${data.market.marketSlug}?lang=${lang}`}>{t.detail}</Link>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.focusedBins}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.centerTemp}: {centerTemp != null ? `${centerTemp}°C` : '-'}</p>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">{t.bin}</th>
                <th className="text-left">{t.ask}</th>
                <th className="text-left">{t.noPrice}</th>
                <th className="text-left">{t.bid}</th>
                <th className="text-left">{t.spread}</th>
                <th className="text-left">{t.modelYes}</th>
                <th className="text-left">{t.modelNo}</th>
                <th className="text-left">{t.evConstrained}</th>
                <th className="text-left">{t.preferredSide}</th>
              </tr>
            </thead>
            <tbody>
              {focusedBins.map((o) => (
                <tr key={o.label} className="border-t border-border/60">
                  <td>{o.label}</td>
                  <td>{(o.marketPrice * 100).toFixed(1)}%</td>
                  <td>{(o.noMarketPrice * 100).toFixed(1)}%</td>
                  <td>{o.bestBid != null ? `${(o.bestBid * 100).toFixed(1)}%` : '-'}</td>
                  <td>{o.spread != null ? `${(o.spread * 100).toFixed(1)}%` : '-'}</td>
                  <td>{(o.modelProbability * 100).toFixed(1)}%</td>
                  <td>{(o.modelNoProbability * 100).toFixed(1)}%</td>
                  <td className={o.constrainedEv >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.constrainedEv.toFixed(3)}</td>
                  <td>{o.bestSide}</td>
                </tr>
              ))}
              {tailBins.length > 0 && (
                <tr className="border-t border-border/60">
                  <td colSpan={9} className="py-2 text-xs text-muted-foreground">
                    {t.tailBins}: {tailBins.map((b) => b.label).join(', ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.snapshots}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {(data?.snapshots ?? []).slice(0, 8).map((s) => {
            const out = fromJsonString<{ decision?: string; tradeScore?: number; recommendedBin?: string }>(s.tradingOutputJson, {});
            return (
              <p key={s.id} className="rounded border border-border/60 px-2 py-1">
                {format(s.capturedAt, 'yyyy-MM-dd HH:mm')} | {decisionLabel(out.decision)} | {out.recommendedBin ?? '-'} | {t.score} {out.tradeScore?.toFixed?.(2) ?? '-'}
              </p>
            );
          })}
        </CardContent>
      </Card>
    </SiteShell>
  );
}
