export type Decision = 'BUY' | 'WATCH' | 'PASS';
export type Side = 'YES' | 'NO';

export type BinInput = {
  label: string;
  marketPrice: number; // executable YES price
  noMarketPrice?: number; // executable/approx NO price
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
  bestSide: Side;
  edge: number;
};

export type TradingInput = {
  now: Date;
  targetDate?: Date;
  marketEndAt?: Date;
  marketActive?: boolean;
  currentTemp: number;
  maxTempSoFar: number;
  tempRise1h: number;
  tempRise2h: number;
  tempRise3h: number;
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
  bins: BinInput[];
  probabilities: number[];
  resolutionReady: boolean;
  weatherReady: boolean;
  marketReady: boolean;
  modelReady: boolean;
  totalCapital: number;
  maxSingleTradePercent: number;
};

export type TradingDecisionOutput = {
  decision: Decision;
  recommendedBin: string;
  recommendedSide: Side;
  edge: number;
  tradeScore: number;
  positionSize: number;
  timingScore: number;
  weatherScore: number;
  dataQualityScore: number;
  riskFlags: string[];
  reason: string;
  reasonZh: string;
  reasonEn: string;
  binOutputs: ModelBinOutput[];
};
