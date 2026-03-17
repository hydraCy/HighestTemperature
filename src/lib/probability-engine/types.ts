export type EngineWeatherSourceName =
  | 'ecmwf'
  | 'gfs'
  | 'icon'
  | 'wunderground'
  | 'weatherAPI'
  | 'metNo'
  | 'openMeteo'
  | 'wttr'
  | 'qWeather'
  | 'nwsHourly';

export type ProbabilityEngineMarketBin = {
  label: string;
  marketPrice?: number;
  noMarketPrice?: number;
  bestBid?: number;
};

export type ProbabilityEngineInputUnified = {
  targetDate: string;
  snapshotTime: string;
  snapshotBucket: '08' | '11' | '14' | 'late';
  sources?: Partial<Record<EngineWeatherSourceName, number>>;
  observedMaxSoFar?: number;
  currentTemp?: number;
  cloudCover?: number;
  windSpeed?: number;
  rainProb?: number;
  marketBins: ProbabilityEngineMarketBin[];
  calibration?: {
    lambda?: number;
    baseSigma?: number;
    spreadSigma?: number;
    source?: 'calibration' | 'model_config' | 'default';
  };
  distribution: {
    mu: number;
    sigma: number;
    minTemp?: number;
    maxTemp?: number;
    minContinuous?: number;
    maxContinuous?: number;
    minAllowedInteger?: number;
    maxAllowedInteger?: number;
    sigmaBelowMean?: number;
    sigmaAboveMean?: number;
  };
};

export type ProbabilityEngineInputLegacy = {
  mu: number;
  sigma: number;
  minTemp?: number;
  maxTemp?: number;
  minContinuous?: number;
  maxContinuous?: number;
  minAllowedInteger?: number;
  maxAllowedInteger?: number;
  sigmaBelowMean?: number;
  sigmaAboveMean?: number;
  binLabels: string[];
};

export type ProbabilityEngineInput = ProbabilityEngineInputUnified | ProbabilityEngineInputLegacy;

export type ProbabilityEngineOutput = {
  integerDistribution: Array<{ temp: number; probability: number }>;
  binProbabilities: number[];
  debugSummary: {
    model: 'truncated_normal_to_integer_rounding';
    mu: number;
    sigma: number;
    L?: number;
    U?: number;
    integerProbabilities: Record<string, number>;
    binProbabilities: Record<string, number>;
    minAllowedInteger?: number;
    maxAllowedInteger?: number;
    inputMode: 'unified' | 'legacy';
    targetDate?: string;
    snapshotTime?: string;
    snapshotBucket?: '08' | '11' | '14' | 'late';
    calibration?: {
      lambda?: number;
      baseSigma?: number;
      spreadSigma?: number;
      source?: 'calibration' | 'model_config' | 'default';
    };
  };
};
