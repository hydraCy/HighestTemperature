export type Decision = 'BUY' | 'WATCH' | 'PASS';
export type Side = 'YES' | 'NO';

export type BinInput = {
  label: string;
  marketPrice: number; // executable YES price
  noMarketPrice?: number; // executable NO ask price if available
  bestBid?: number;
};

export type ModelBinOutput = {
  outcomeLabel: string;
  modelProbability: number;
  marketPrice: number;
  noMarketPrice: number;
  modelNoProbability: number;
  edgeYes: number;
  edgeNo: number;
  netEdgeYes: number;
  netEdgeNo: number;
  theoreticalEVYes?: number;
  theoreticalEVNo?: number;
  tradableEVYes?: number;
  tradableEVNo?: number;
  portfolioEV?: number;
  bestSide: Side;
  edge: number;
};

export type TradingInput = {
  now: Date;
  targetDate?: Date;
  marketEndAt?: Date;
  marketActive?: boolean;
  observedMaxTemp?: number;
  futureTemp1h?: number;
  futureTemp2h?: number;
  futureTemp3h?: number;
  futureTemp4h?: number;
  futureTemp5h?: number;
  futureTemp6h?: number;
  learnedPeakWindowStartHour?: number;
  learnedPeakWindowEndHour?: number;
  currentTemp: number;
  maxTempSoFar: number;
  tempRise1h: number;
  tempRise2h: number;
  tempRise3h: number;
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
  weatherMaturityScore?: number;
  scenarioTag?: string;
  marketConsensusBin?: string;
  marketConsensusPrice?: number;
  entryCountForTargetDate?: number;
  bins: BinInput[];
  probabilities: number[];
  resolutionReady: boolean;
  weatherReady: boolean;
  marketReady: boolean;
  modelReady: boolean;
  rulesParsed?: boolean;
  hasCompleteSources?: boolean;
  weatherFreshnessHours?: number | null;
  avgSourceHealthScore?: number | null;
  totalCapital: number;
  maxSingleTradePercent: number;
};

export type TradingDecisionOutput = {
  decision: Decision;
  recommendedBin: string;
  recommendedSide: Side;
  edge: number;
  theoreticalEV?: number;
  tradableEV?: number;
  portfolioEV?: number;
  tradeScore: number;
  positionSize: number;
  timingScore: number;
  weatherScore: number;
  dataQualityScore: number;
  riskFlags: string[];
  reason: string;
  reasonZh: string;
  reasonEn: string;
  decisionMode?: 'realtime' | 'daily_once';
  isDailyOfficial?: boolean;
  dailyLockAt?: string;
  dailyDateKey?: string;
  binOutputs: ModelBinOutput[];
};
