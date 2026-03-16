export type StationType = 'exact_station' | 'city_level' | 'grid_point';

export type WeatherSourceInput = {
  sourceName: string;
  rawPredictedMaxTemp: number;
  stationType: StationType;
  explicitResolutionStation?: boolean;
};

export type HistoricalCalibration = {
  sourceName: string;
  sampleSize: number;
  bias: number;
  mae: number;
  exactHitRate: number;
  within1CHitRate: number;
};

export type ResolutionContext = {
  cityName: 'Shanghai';
  resolutionStationName: string;
  resolutionSourceName: string;
  precision: 'integer_celsius';
};

export type ScenarioContext = {
  currentTemp: number;
  tempRise1h: number;
  tempRise2h: number;
  cloudCover: number;
  precipitationProb: number;
  windSpeed: number;
  nowHourLocal: number;
  isTargetDateToday?: boolean;
  peakWindowStartHour?: number;
  peakWindowEndHour?: number;
  scenarioTag?: 'stable_sunny' | 'suppressed_heating' | 'neutral';
};

export type SourceBreakdown = {
  sourceName: string;
  rawPredictedMaxTemp: number;
  adjustedPredictedMaxTemp: number;
  matchScore: number;
  stationPenaltyScore?: number;
  accuracyScore: number;
  scenarioScore: number;
  regimeScore?: number;
  finalWeight: number;
};

export type OutcomeProbability = {
  label: string;
  probability: number;
};

export type FusionOutput = {
  fusedTemp: number;
  fusedSigma: number;
  outcomeProbabilities: OutcomeProbability[];
  sourceBreakdown: SourceBreakdown[];
  explanation: string;
};

export type FusionInput = {
  sources: WeatherSourceInput[];
  calibrations: HistoricalCalibration[];
  resolutionContext: ResolutionContext;
  scenarioContext: ScenarioContext;
};
