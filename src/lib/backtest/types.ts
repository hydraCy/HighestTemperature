export type SnapshotTime = '08:00' | '11:00' | '14:00' | '15:30';
export type SnapshotBucket = '08' | '11' | '14' | 'late';

export type SnapshotRow = {
  airport: string;
  targetDate: string;
  snapshotTime: string;
  ecmwf?: number;
  gfs?: number;
  icon?: number;
  wunderground?: number;
  weatherAPI?: number;
  metNo?: number;
  observedMaxSoFar?: number;
  currentTemp?: number;
  cloudCover?: number;
  windSpeed?: number;
  rainProb?: number;
  finalMaxTemp: number;
  snapshotBucket: string;
};

export type NormalizedSnapshotRow = {
  airport: string;
  targetDate: string;
  snapshotTime: SnapshotTime;
  snapshotBucket: SnapshotBucket;
  sources: Partial<Record<WeatherSourceName, number>>;
  observedMaxSoFar?: number;
  currentTemp?: number;
  cloudCover?: number;
  windSpeed?: number;
  rainProb?: number;
  finalMaxTemp: number;
};

export type WeatherSourceName =
  | 'ecmwf'
  | 'gfs'
  | 'icon'
  | 'wunderground'
  | 'weatherAPI'
  | 'metNo';

export type BaseSigmaTable = {
  [bucket in SnapshotBucket]?: number;
};

export type SourceWeightTable = {
  [bucket in SnapshotBucket]?: Partial<Record<WeatherSourceName, number>>;
};

export type RemainingCapTable = {
  [bucket in SnapshotBucket]?: {
    q50: number;
    q75: number;
    q90: number;
    q95: number;
  };
};

export type CalibrationTables = {
  baseSigma: BaseSigmaTable;
  sourceWeights: SourceWeightTable;
  remainingCaps: RemainingCapTable;
  meta: {
    bucketSampleCount: Record<SnapshotBucket, number>;
    sourceSampleCount: Record<SnapshotBucket, Partial<Record<WeatherSourceName, number>>>;
    minSamplesPerBucket: number;
    shrinkageK: number;
    usedSmoothing: boolean;
    debug: {
      baseSigma: Record<
        SnapshotBucket,
        {
          sampleCount: number;
          rawEstimate: number;
          smoothedEstimate: number;
          usedGlobalFallback: boolean;
        }
      >;
      sourceWeights: Record<
        SnapshotBucket,
        Record<
          WeatherSourceName,
          {
            sampleCount: number;
            rawScore: number;
            globalScore: number;
            smoothedScore: number;
            normalizedWeight: number;
            usedGlobalFallback: boolean;
          }
        >
      >;
      remainingCaps: Record<
        SnapshotBucket,
        {
          sampleCount: number;
          rawEstimate: { q50: number; q75: number; q90: number; q95: number };
          smoothedEstimate: { q50: number; q75: number; q90: number; q95: number };
          usedGlobalFallback: boolean;
        }
      >;
    };
  };
};

export type CalibrationConfig = {
  minSamplesPerBucket?: number;
  shrinkageK?: number;
  sigmaFloor?: number;
};

export type BacktestConfig = {
  minTemp?: number;
  maxTemp?: number;
  lambda?: number;
  epsilon?: number;
  sigmaClampMin?: number;
  sigmaClampMax?: number;
  sigmaDecisionThreshold?: number;
  binLabels?: string[];
  priceByLabel?: Record<string, number>;
  modelConfigPath?: string;
};

export type CalibrationCurvePoint = {
  range: string;
  predicted: number;
  actual: number;
  count: number;
};

export type DistributionCheck = {
  targetDate: string;
  snapshotTime: SnapshotTime;
  bucket: SnapshotBucket;
  minContinuous?: number;
  maxContinuous?: number;
  lowerImpossibleMass: number;
  upperImpossibleMass: number;
  pass: boolean;
};

export type BacktestTradeRow = {
  targetDate: string;
  snapshotTime: SnapshotTime;
  bucket: SnapshotBucket;
  label: string;
  probability: number;
  marketPrice: number;
  edge: number;
  decision: 'BUY' | 'WATCH' | 'PASS';
  sigma: number;
};

export type BacktestResult = {
  metrics: {
    brier: number;
    logloss: number;
    calibrationError: {
      meanAbsDeviation: number;
      maxDeviation: number;
      quality: 'GOOD' | 'WARNING' | 'BAD';
    };
    overconfidence: {
      count: number;
      hitRate: number;
    };
  };
  calibrationCurve: CalibrationCurvePoint[];
  distributionChecks: DistributionCheck[];
  summary: {
    avgSigma: number;
    avgSpread: number;
    rows: number;
    sampleCount: number;
    bucketCounts: Record<SnapshotBucket, number>;
    insufficientBuckets: SnapshotBucket[];
    fallbackUsed: boolean;
    fallbackCount: number;
    warnings: string[];
    sigmaStats: {
      min: number;
      max: number;
      avg: number;
    };
    p1Count: number;
    distributionLegality: {
      totalChecks: number;
      passedChecks: number;
      failedChecks: number;
      passRate: number;
    };
  };
  trades: BacktestTradeRow[];
  sampleDistributions: Array<{
    targetDate: string;
    snapshotTime: SnapshotTime;
    bucket: SnapshotBucket;
    mu: number;
    sigmaBase: number;
    spreadSigma: number;
    lambda: number;
    finalSigma: number;
    bucketSampleCount: number;
    smoothedCalibration: boolean;
    sourceWeightFallbackUsed: boolean;
    sigma: number;
    L?: number;
    U?: number;
    integerProbabilities: Record<string, number>;
    binProbabilities: Record<string, number>;
  }>;
};
