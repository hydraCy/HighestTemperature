export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshAllButton } from '@/components/market/refresh-all-button';
import { LiveMarketPoller } from '@/components/market/live-market-poller';
import { AutoRefreshTrigger } from '@/components/market/auto-refresh-trigger';
import { DecisionCard } from '@/components/decision/decision-card';
import { ProbabilitySection } from '@/components/decision/probability-section';
import { MarketComparison } from '@/components/decision/market-comparison';
import { ContextSummary } from '@/components/decision/context-summary';
import { ExpandableDebug } from '@/components/decision/expandable-debug';
import { fromJsonString } from '@/lib/utils/json';
import { parseWeatherRaw } from '@/lib/utils/weather-raw';
import { riskLabel } from '@/lib/i18n/risk-labels';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { buildFocusBins } from '@/lib/utils/focus-bins';
import { formatDateByMode, formatDateTimeByMode } from '@/lib/utils/time-display';
import { calculatePositionSize } from '@/src/lib/trading-engine/positionSizer';
import { calculateRiskModifier } from '@/src/lib/trading-engine/riskEngine';

type PageSearchParams = Promise<{ lang?: string | string[]; d?: string | string[] }>;

export default async function HomePage({ searchParams }: { searchParams: PageSearchParams }) {
  const toShanghaiDateKey = (date: Date) => {
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
  };
  const sp = await searchParams;
  const lang = (Array.isArray(sp?.lang) ? sp.lang[0] : sp?.lang) === 'en' ? 'en' : 'zh';
  const selectedDate = Array.isArray(sp?.d) ? sp.d[0] : sp?.d;
  const selectedDateKey = typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? selectedDate
    : toShanghaiDateKey(new Date());
  const t =
    lang === 'en'
      ? {
          mode: 'Research Mode',
          title: 'Decision / Position / Reason',
          dateTags: 'Date Tags',
          dateMode: 'Target Date',
          datePrev: 'Prev Day',
          dateNext: 'Next Day',
          gatePanel: 'Strategy Gates',
          gateName: 'Gate',
          gateStatus: 'Status',
          gateDate: 'Date Alignment',
          gateFreshness: 'Weather Freshness',
          gateSources: 'Source Completeness',
          gateConsensus: 'Consensus Conflict',
          gateSecondEntry: 'Second Entry Guard',
          gatePass: 'PASS',
          gateWarn: 'WARN',
          gateBlock: 'BLOCK',
          shanghaiToday: 'Shanghai Today',
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
          apiDate: 'Date',
          reason: 'Reason',
          statusOk: 'ok',
          statusNoData: 'no_data',
          statusFetchError: 'fetch_error',
          statusParseError: 'parse_error',
          statusSkipped: 'skipped',
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
          future1to3h: 'Next 1-6h Forecast',
          scenarioTag: 'Scenario',
          weatherMaturity: 'Weather Maturity Score',
          learnedPeakWindow: 'Learned Peak Window (30d ZSPD)',
          learnedPeakWindowSamples: 'Sample Days',
          apiWuRealtime: 'Wunderground Realtime (ZSPD)',
          apiWuDaily: 'Wunderground Target-day Max',
          apiWuHistory: 'Wunderground 30d History',
          apiAviation: 'AviationWeather (METAR/TAF)',
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
          coveragePanel: 'Coverage Arbitrage (Near Peak)',
          coverageDesc: 'Buy adjacent YES bins near target temperature. If total ask < 1 after costs, basket can be profitable.',
          coverageLegs: 'Legs',
          coverageCost: 'Total Ask',
          coverageProb: 'Cover Prob',
          coverageGross: 'Gross EV',
          coverageNet: 'Net EV',
          coveragePayout: 'Win Payout',
          coverageBest: 'Best Coverage',
          coverageNoEdge: 'No positive coverage edge currently.',
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
          dateTags: '日期标签',
          dateMode: '目标日期',
          datePrev: '前一天',
          dateNext: '后一天',
          gatePanel: '策略门控状态',
          gateName: '门控项',
          gateStatus: '状态',
          gateDate: '日期一致性',
          gateFreshness: '天气新鲜度',
          gateSources: '数据源完整性',
          gateConsensus: '主共识冲突',
          gateSecondEntry: '二次入场保护',
          gatePass: '通过',
          gateWarn: '告警',
          gateBlock: '阻断',
          shanghaiToday: '上海当前日期',
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
          apiDate: '日期',
          reason: '原因',
          statusOk: '正常',
          statusNoData: '无数据',
          statusFetchError: '拉取失败',
          statusParseError: '解析失败',
          statusSkipped: '未启用',
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
          future1to3h: '未来1-6小时',
          scenarioTag: '场景标签',
          weatherMaturity: '天气成熟度评分',
          learnedPeakWindow: '近30天学习峰值窗口(ZSPD)',
          learnedPeakWindowSamples: '样本天数',
          apiWuRealtime: 'Wunderground 实时(ZSPD)',
          apiWuDaily: 'Wunderground 目标日最高温',
          apiWuHistory: 'Wunderground 30天历史',
          apiAviation: 'AviationWeather（METAR/TAF）',
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
          coveragePanel: '覆盖套利（峰值附近）',
          coverageDesc: '买入目标温度附近相邻 YES 盘口。若总 ask 在扣成本后低于 1，组合有机会盈利。',
          coverageLegs: '覆盖组合',
          coverageCost: '总成本',
          coverageProb: '覆盖概率',
          coverageGross: '毛EV',
          coverageNet: '净EV',
          coveragePayout: '命中回款',
          coverageBest: '最佳覆盖',
          coverageNoEdge: '当前暂无正净EV的覆盖组合。',
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
  const { getDashboardData } = await import('@/lib/services/query');
  const data = await getDashboardData(selectedDateKey);
  if (!data) {
    return (
      <SiteShell currentPath="/" lang={lang}>
        <AutoRefreshTrigger targetDateKey={selectedDateKey} />
        <Card>
          <CardHeader>
            <CardTitle>{lang === 'en' ? 'No Data Yet' : '暂无数据'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {lang === 'en'
                ? 'No market snapshots are available yet.'
                : '当前还没有市场快照数据。'}
            </p>
          </CardContent>
        </Card>
      </SiteShell>
    );
  }
  const decisionLabel = (d?: string) => (d === 'BUY' ? t.buy : d === 'WATCH' ? t.watch : t.pass);
  const weatherParsed = parseWeatherRaw(data?.latestWeather?.rawJson);
  const weatherRaw = weatherParsed.raw;
  const weatherErrors = (weatherRaw.errors as string[] | undefined) ?? [];
  const strictReadyRaw = (weatherRaw as { strictReady?: boolean } | undefined)?.strictReady ?? false;
  const missingSources = (weatherRaw as { missingSources?: string[] } | undefined)?.missingSources ?? [];
  const sourceDailyMax = (weatherRaw as { sourceDailyMax?: { wundergroundDaily?: number | null; nwsHourly?: number | null; openMeteo?: number | null; wttr?: number | null; metNo?: number | null; weatherApi?: number | null; qWeather?: number | null; cmaChina?: number | null; fused?: number | null; fusedContinuous?: number | null; fusedAnchor?: number | null; spread?: number | null } } | undefined)?.sourceDailyMax;
  const apiStatusMap = (weatherRaw as {
    apiStatus?: Record<string, { status: string; reason?: string; hasData?: boolean; dateLabel?: string }>;
  } | undefined)?.apiStatus ?? {};
  const nowcasting = (weatherRaw as {
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
  const forecastExplain = (weatherRaw as {
    forecastExplain?: {
      zh?: string;
      en?: string;
      method?: string;
      confidence?: 'high' | 'medium' | 'low';
      weightBreakdown?: Array<{ source: string; raw: number; adjusted: number; weight: number }>;
    };
  } | undefined)?.forecastExplain;
  const learnedPeakWindow = (weatherRaw as { learnedPeakWindow?: { startHour?: number; endHour?: number; sampleDays?: number } } | undefined)?.learnedPeakWindow;
  const resolutionSourceStatusRaw = (weatherRaw as { resolutionSourceStatus?: string } | undefined)?.resolutionSourceStatus;
  const weatherTargetDate = (weatherRaw as { targetDate?: string } | undefined)?.targetDate;
  const weatherObservedAt = weatherParsed.observedAt;
  const weatherFetchedAt = weatherParsed.fetchedAtIso;
  const weatherFreshnessMinutes = (() => {
    const base = weatherFetchedAt ?? weatherObservedAt;
    if (!base) return null;
    const ts = new Date(base).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 60000));
  })();
  const isTargetDateToday = data?.market?.targetDate
    ? toShanghaiDateKey(new Date(data.market.targetDate)) === toShanghaiDateKey(new Date())
    : false;
  const shanghaiTodayKey = toShanghaiDateKey(new Date());
  const pageDateKey = selectedDateKey;
  const selectedDayDate = new Date(`${pageDateKey}T00:00:00+08:00`);
  const prevDay = new Date(selectedDayDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const nextDay = new Date(selectedDayDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const prevDayKey = toShanghaiDateKey(prevDay);
  const nextDayKey = toShanghaiDateKey(nextDay);
  const riskSet = new Set(data?.latestDecision?.riskFlags ?? []);
  const marketTargetDateKey = data?.market?.targetDate ? toShanghaiDateKey(new Date(data.market.targetDate)) : null;
  const isDateAligned = !marketTargetDateKey || !weatherTargetDate || marketTargetDateKey === weatherTargetDate;
  const selectedSettlementLabel = `${pageDateKey} 24:00`;
  const weatherStaleThresholdMinutes = Number(process.env.WEATHER_STALE_MINUTES ?? '15');
  const isWeatherStale = weatherFreshnessMinutes != null
    && Number.isFinite(weatherStaleThresholdMinutes)
    && weatherStaleThresholdMinutes > 0
    && weatherFreshnessMinutes > weatherStaleThresholdMinutes;
  const strictReady = strictReadyRaw;
  const resolutionSourceStatus = resolutionSourceStatusRaw;
  const weatherErrorsEffective = weatherErrors;
  const sourceLabel = (s?: string) => {
    if (s === 'api') return t.apiLive;
    return t.unknown;
  };
  const decisionMeta = (data?.latestDecision?.reasonMeta ?? {}) as {
    calibratedFusedTemp?: number;
    mostLikelyInteger?: number;
    settlementMean?: number;
    sourceCalibration?: Array<{ code: string; raw: number; bias: number; mae: number; adjusted: number; weight: number; sampleSize: number }>;
  };
  const decisionForecastInteger =
    typeof decisionMeta.mostLikelyInteger === 'number' && Number.isFinite(decisionMeta.mostLikelyInteger)
      ? Math.round(decisionMeta.mostLikelyInteger)
      : null;
  const decisionForecastContinuous =
    typeof decisionMeta.settlementMean === 'number' && Number.isFinite(decisionMeta.settlementMean)
      ? decisionMeta.settlementMean
      : null;
  const hasLatestDecision = Boolean(data?.latestDecision);
  const panelForecastInteger =
    hasLatestDecision
      ? decisionForecastInteger
      : (typeof sourceDailyMax?.fusedAnchor === 'number' && Number.isFinite(sourceDailyMax.fusedAnchor)
          ? Math.round(sourceDailyMax.fusedAnchor)
          : null);
  const panelForecastContinuous =
    hasLatestDecision
      ? decisionForecastContinuous
      : (typeof sourceDailyMax?.fusedContinuous === 'number' && Number.isFinite(sourceDailyMax.fusedContinuous)
          ? sourceDailyMax.fusedContinuous
          : null);
  const statusLabel = (s?: string) => {
    if (s === 'ok') return t.statusOk;
    if (s === 'no_data') return t.statusNoData;
    if (s === 'fetch_error') return t.statusFetchError;
    if (s === 'parse_error') return t.statusParseError;
    if (s === 'skipped') return t.statusSkipped;
    return s ?? '-';
  };
  const apiRows = [
    { code: 'wunderground', label: t.apiWuRealtime },
    { code: 'wunderground_daily', label: t.apiWuDaily },
    { code: 'wunderground_history', label: t.apiWuHistory },
    { code: 'aviationweather', label: t.apiAviation },
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
      edge: out?.edge ?? 0,
      engineConstrainedEdge: typeof out?.edge === 'number' ? out.edge : null
    };
  });
  const tradingCost = Number(process.env.TRADING_COST_PER_TRADE ?? '0.01');
  const skipNearCertainPrice = Number(process.env.SKIP_NEAR_CERTAIN_PRICE ?? '0.95');
  const settlementAnchorTemp =
    typeof decisionMeta.mostLikelyInteger === 'number' && Number.isFinite(decisionMeta.mostLikelyInteger)
      ? Math.round(decisionMeta.mostLikelyInteger)
      : (typeof panelForecastInteger === 'number' && Number.isFinite(panelForecastInteger) ? Math.round(panelForecastInteger) : null);
  const fusedAnchorTemp =
    typeof sourceDailyMax?.fusedAnchor === 'number' && Number.isFinite(sourceDailyMax.fusedAnchor)
      ? Math.round(sourceDailyMax.fusedAnchor)
      : null;
  const muTempRaw =
    typeof decisionMeta.settlementMean === 'number' && Number.isFinite(decisionMeta.settlementMean)
      ? decisionMeta.settlementMean
      : (typeof sourceDailyMax?.fusedContinuous === 'number' && Number.isFinite(sourceDailyMax.fusedContinuous)
          ? sourceDailyMax.fusedContinuous
          : null);
  const centerTemp =
    settlementAnchorTemp
      ?? fusedAnchorTemp
      ?? (typeof muTempRaw === 'number' ? Math.round(muTempRaw) : null);
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
    const entryPx = side === 'YES' ? b.marketPrice : b.noMarketPrice;
    const isNearCertain = entryPx >= skipNearCertainPrice;
    if (isNearCertain) {
      return {
        ...b,
        bestSide: 'SKIP' as const,
        bestEdge: Number.NEGATIVE_INFINITY,
        constrainedEv: null as number | null,
        isNearCertain
      };
    }
    const grossEdge = side === 'YES' ? b.edgeYes : b.edgeNo;
    const constrainedNetEv = b.engineConstrainedEdge ?? (grossEdge - tradingCost);
    return { ...b, bestSide: side as 'YES' | 'NO', bestEdge: constrainedNetEv, constrainedEv: constrainedNetEv, isNearCertain };
  });
  const focusLabels = centerTemp != null ? buildFocusBins(centerTemp) : [];
  const mapLabelToRow = (focusLabel: string) => {
    const exact = allBinsWithGlobalSide.find((b) => b.label === focusLabel);
    if (exact) return exact;

    const parsedFocus = parseTemperatureBin(focusLabel);
    return allBinsWithGlobalSide.find((b) => {
      const parsed = parseTemperatureBin(b.label);
      const minSame =
        (parsed.min == null && parsedFocus.min == null)
        || (parsed.min != null && parsedFocus.min != null && Math.abs(parsed.min - parsedFocus.min) < 0.01);
      const maxSame =
        (parsed.max == null && parsedFocus.max == null)
        || (parsed.max != null && parsedFocus.max != null && Math.abs(parsed.max - parsedFocus.max) < 0.01);
      return minSame && maxSame;
    }) ?? null;
  };
  const focusRows = focusLabels.map((label) => {
    const row = mapLabelToRow(label);
    return {
      label,
      modelProbability: row?.modelProbability ?? 0,
      marketPriceYes: row?.marketPrice ?? 0,
      marketPriceNo: row?.noMarketPrice ?? 1,
      edge: row?.edgeYes ?? 0,
      constrainedEv: row?.constrainedEv ?? Number.NEGATIVE_INFINITY,
      preferredSide: (row?.bestSide ?? '-') as 'YES' | 'NO' | 'SKIP' | '-'
    };
  });
  const focusedLabelSet = new Set(focusLabels);
  const focusedBins = allBinsWithGlobalSide.filter((b) => focusedLabelSet.has(b.label));
  const topProfit = [...allBinsWithGlobalSide].sort((a, b) => (b.constrainedEv ?? Number.NEGATIVE_INFINITY) - (a.constrainedEv ?? Number.NEGATIVE_INFINITY))[0];
  const rankingBaseBins = focusedBins.length > 0 ? focusedBins : allBinsWithGlobalSide;
  const coverageBaseBins = (focusedBins.length > 0 ? focusedBins : allBinsWithGlobalSide)
    .filter((b) => b.marketPrice < skipNearCertainPrice && b.noMarketPrice < skipNearCertainPrice)
    .map((b, idx) => ({
      ...b,
      idx,
      parsed: parseTemperatureBin(b.label),
    }));
  const binRepTemp = (label: string) => {
    const p = parseTemperatureBin(label);
    if (p.min != null && p.max != null) return (p.min + p.max) / 2;
    if (p.min != null && p.max == null) return p.min + 1;
    if (p.min == null && p.max != null) return p.max - 1;
    return null;
  };
  const coverageRows = [2, 3]
    .flatMap((windowSize) => {
      if (coverageBaseBins.length < windowSize) return [];
      const rows: Array<{
        labels: string[];
        cost: number;
        coverProb: number;
        grossEdge: number;
        netEdge: number;
        payoutIfHit: number;
        dist: number;
      }> = [];
      for (let i = 0; i <= coverageBaseBins.length - windowSize; i += 1) {
        const legs = coverageBaseBins.slice(i, i + windowSize);
        const labels = legs.map((x) => x.label);
        const cost = legs.reduce((s, x) => s + x.marketPrice, 0);
        const coverProb = legs.reduce((s, x) => s + x.modelProbability, 0);
        const grossEdge = coverProb - cost;
        const netEdge = grossEdge - tradingCost * windowSize;
        const payoutIfHit = 1 - cost;
        const reps = labels.map((l) => binRepTemp(l)).filter((x): x is number => typeof x === 'number');
        const center = reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : Number.POSITIVE_INFINITY;
        const dist = centerTemp != null && Number.isFinite(center) ? Math.abs(center - centerTemp) : 0;
        rows.push({ labels, cost, coverProb, grossEdge, netEdge, payoutIfHit, dist });
      }
      return rows;
    })
    .filter((r) => r.cost > 0 && r.cost < 1.2)
    .sort((a, b) => b.netEdge - a.netEdge || a.dist - b.dist || a.cost - b.cost)
    .slice(0, 8);
  const bestCoverage = coverageRows.find((r) => r.netEdge > 0) ?? null;
  const opportunityRows = [...rankingBaseBins]
    .filter((b) => b.bestSide === 'YES' || b.bestSide === 'NO')
    .map((b) => {
      const side = b.bestSide;
      const modelProb = side === 'YES' ? b.modelProbability : b.modelNoProbability;
      const marketPx = side === 'YES' ? b.marketPrice : b.noMarketPrice;
      const netEdge = b.constrainedEv ?? Number.NEGATIVE_INFINITY;
      const grossEdge = netEdge + tradingCost;
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
    (nowcasting?.futureHours ?? []).slice(0, 6).length > 0 &&
    (nowcasting?.futureHours ?? []).slice(0, 6).every((h) => h.temp <= (nowcasting?.todayMaxTemp ?? Number.POSITIVE_INFINITY) + 0.2);
  const stalledRise = (nowcasting?.tempRise1h ?? 0) <= 0;
  const lockLikely = Boolean(
    data?.marketStatus?.isSettled ||
      (nearSettlement && nowcasting?.todayMaxTemp != null && nowcasting?.currentTemp != null && futureCapped && stalledRise),
  );
  const lockReason = data?.marketStatus?.isSettled
    ? `${t.settledTitle}`
    : `near_settlement=${nearSettlement ? 'yes' : 'no'}, stalled_rise=${stalledRise ? 'yes' : 'no'}, future_not_break_max=${futureCapped ? 'yes' : 'no'}`;
  const settledReasonText =
    data?.marketStatus?.settledReason === 'time_elapsed'
      ? (lang === 'en' ? 'Reason: settlement time elapsed' : '原因：已到结算时间')
      : data?.marketStatus?.settledReason === 'market_inactive'
        ? (lang === 'en' ? 'Reason: market is inactive/closed' : '原因：市场已 inactive/closed')
        : (lang === 'en' ? 'Reason: unknown' : '原因：未知');
  const decisionMain = data?.latestDecision;
  const decisionReasonRaw = (lang === 'en' ? decisionMain?.reasonEn : decisionMain?.reasonZh) ?? decisionMain?.reason ?? '';
  const warmingForecastPeak = (() => {
    const vals = [
      nowcasting?.currentTemp,
      nowcasting?.todayMaxTemp,
      ...(nowcasting?.futureHours ?? []).slice(0, 6).map((h) => h.temp)
    ].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (!vals.length) return null;
    return Math.max(...vals);
  })();
  const probabilityRows = focusRows;
  const compareRows = [...focusRows]
    .sort((a, b) => b.constrainedEv - a.constrainedEv)
    .slice(0, 3)
    .map((row) => ({
      label: row.label,
      modelProbability: row.modelProbability,
      marketPriceYes: row.marketPriceYes,
      marketPriceNo: row.marketPriceNo,
      edge: row.edge
    }));
  const remainingCap = (decisionMeta as { constraints?: { maxPotentialRise?: number } }).constraints?.maxPotentialRise;
  const compactStatus = [
    `${t.currentTemp}: ${nowcasting?.currentTemp != null ? `${nowcasting.currentTemp.toFixed(1)}°C` : '-'}`,
    `${t.todayObservedMax}: ${isTargetDateToday && nowcasting?.todayMaxTemp != null ? `${nowcasting.todayMaxTemp.toFixed(0)}°C` : '-'}`,
    `${lang === 'en' ? 'Remaining cap' : '剩余上限'}: ${typeof remainingCap === 'number' ? `+${remainingCap.toFixed(1)}°C` : '-'}`,
    `${t.scenarioTag}: ${scenarioLabel(nowcasting?.scenarioTag)}`
  ].join(' | ');
  const contextWarningText =
    (data?.marketSource !== 'api' || data?.weatherSource !== 'api' || weatherErrorsEffective.length > 0 || resolutionSourceStatus !== 'direct' || !strictReady || isWeatherStale)
      ? `${t.warningPrefix}（${t.warningMarket}：${sourceLabel(data?.marketSource)}，${t.warningWeather}：${sourceLabel(data?.weatherSource)}）`
      : '';
  const contextSettledText = data?.marketStatus?.isSettled
    ? `${t.settledTitle}（${t.settlementTime}：${selectedSettlementLabel}）。${settledReasonText} ${t.settledForcePass}`
    : '';

  return (
    <SiteShell currentPath="/" lang={lang}>
      <AutoRefreshTrigger targetDateKey={pageDateKey} />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t.mode}</p>
          <h1 className="text-xl font-semibold">{t.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded border bg-background px-3 text-sm" defaultValue="Shanghai">
            <option value="Shanghai">{t.city}</option>
          </select>
          <div className="inline-flex items-center overflow-hidden rounded border border-border text-xs">
            <span className="px-2 py-1 text-muted-foreground">{t.dateMode}</span>
            <Link
              href={`/?lang=${lang}&d=${prevDayKey}`}
              className="border-l border-border px-2 py-1 text-muted-foreground"
            >
              {t.datePrev}
            </Link>
            <span className="border-l border-border px-2 py-1">{pageDateKey}</span>
            <Link
              href={`/?lang=${lang}&d=${nextDayKey}`}
              className="border-l border-border px-2 py-1 text-muted-foreground"
            >
              {t.dateNext}
            </Link>
          </div>
          <RefreshAllButton lang={lang} targetDateKey={pageDateKey} />
        </div>
      </div>
      <LiveMarketPoller
        lang={lang}
        marketUpdatedAt={marketUpdatedAtIso}
        weatherUpdatedAt={weatherFetchedAt ?? weatherObservedAt ?? null}
      />
      <DecisionCard
        title={lang === 'en' ? 'Decision Card' : '决策卡'}
        actionLabel={decisionLabel(decisionMain?.decision)}
        actionVariant={decisionMain?.decision === 'BUY' ? 'success' : decisionMain?.decision === 'WATCH' ? 'warning' : 'secondary'}
        bestLabel={decisionMain?.recommendedBin ?? '-'}
        bestSide={decisionMain?.recommendedSide ?? '-'}
        edge={decisionMain?.edge?.toFixed(3) ?? '-'}
        modelProb={`${((((decisionMain?.recommendedSide === 'NO' ? recRow?.modelNoProbability : recRow?.modelProbability) ?? 0) * 100)).toFixed(1)}%`}
        marketPrice={`${((((decisionMain?.recommendedSide === 'NO' ? recRow?.noMarketPrice : recRow?.marketPrice) ?? 0) * 100)).toFixed(1)}%`}
        tradeScore={decisionMain?.tradeScore?.toFixed(2) ?? '-'}
        warmingForecast={warmingForecastPeak != null ? `${warmingForecastPeak.toFixed(1)}°C（+1~6h峰值）` : '-'}
        reasonTitle={lang === 'en' ? 'Why (short)' : '为什么（简要）'}
        fullReason={decisionReasonRaw}
        labels={{
          recBin: t.recBin,
          recSide: t.recSide,
          edge: t.edge,
          modelProb: t.modelProb,
          marketPx: t.marketPx,
          tradeScore: t.tradeScore,
          warmingForecast: lang === 'en' ? 'Warming Model Forecast' : '升温模型预测'
        }}
      />

      <ProbabilitySection
        title={`${lang === 'en' ? 'Probability (Focus Bins)' : '概率分布（动态聚焦）'}${centerTemp != null ? ` · ${t.centerTemp} ${centerTemp}°C` : ''}`}
        headers={{
          bin: t.bin,
          modelYes: t.modelYes,
          marketPriceYes: t.ask,
          marketPriceNo: t.noPrice,
          edge: t.netEdge,
          preferredSide: t.preferredSide
        }}
        rows={probabilityRows}
      />

      <MarketComparison
        title={lang === 'en' ? 'Model vs Market (Top Relevance)' : '模型 vs 市场（重点对比）'}
        headers={{
          bin: t.bin,
          modelProb: t.modelProb,
          marketPriceYes: t.ask,
          marketPriceNo: t.noPrice,
          edge: t.netEdge
        }}
        rows={compareRows}
      />

      <ContextSummary
        title={lang === 'en' ? 'Context Summary' : '上下文摘要'}
        summary={compactStatus}
        warningText={contextWarningText}
        settledText={contextSettledText}
      />

      <ExpandableDebug
        title={lang === 'en' ? 'Debug (Collapsed)' : '调试信息（折叠）'}
        apiStatusTitle={t.apiStatusTitle}
        apiDateLabel={t.apiDate}
        statusLabel={t.status}
        reasonLabel={t.reason}
        apiRows={apiRows}
        apiStatusMap={apiStatusMap}
        statusText={statusLabel}
        weightTitle={t.weightBreakdown}
        sourceCol={t.sourceCol}
        rawCol={t.rawTempCol}
        adjustedCol={t.adjTempCol}
        weightCol={t.weightCol}
        strictReady={strictReady}
        weightBreakdown={forecastExplain?.weightBreakdown}
        detailTitle={lang === 'en' ? 'Detailed Explanation' : '详细解释'}
        detailText={strictReady ? (lang === 'en' ? (forecastExplain?.en ?? '-') : (forecastExplain?.zh ?? '-')) : t.strictBlock}
        fusionMethodLabel={t.fusionMethod}
        fusionMethod={strictReady ? (forecastExplain?.method ?? '-') : '-'}
        resolutionNote={t.resolutionPriorityNote}
        sourceBiasTitle={t.sourceBiasTitle}
        avgBiasLabel={t.avgBias}
        maeLabel={t.mae}
        samplesLabel={t.samples}
        biasStats={biasStats}
      />
    </SiteShell>
  );
}
