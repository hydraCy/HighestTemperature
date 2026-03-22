export type SupportedLocationKey = 'shanghai' | 'hongkong';

export type LocationConfig = {
  key: SupportedLocationKey;
  nameZh: string;
  nameEn: string;
  timezone: string;
  lat: number;
  lon: number;
  settlementSource: {
    provider: string;
    stationId?: string;
    queryName?: string;
  };
  market: {
    slugKeyword: string;
    titleKeyword: string;
    eventPrefix: string;
    cityName: string;
  };
  weather: {
    stationName: string;
    stationCode: string;
    wttrQuery: string;
    wundergroundHistoryPath: string;
  };
};

export const LOCATION_CONFIGS: Record<SupportedLocationKey, LocationConfig> = {
  shanghai: {
    key: 'shanghai',
    nameZh: '上海',
    nameEn: 'Shanghai',
    timezone: 'Asia/Shanghai',
    lat: 31.1443,
    lon: 121.8083,
    settlementSource: {
      provider: 'Wunderground',
      stationId: 'ZSPD',
      queryName: 'Shanghai Pudong International Airport Station'
    },
    market: {
      slugKeyword: 'highest-temperature-in-shanghai',
      titleKeyword: 'Highest temperature in Shanghai',
      eventPrefix: 'highest-temperature-in-shanghai-on-',
      cityName: 'Shanghai'
    },
    weather: {
      stationName: 'Shanghai Pudong International Airport Station',
      stationCode: 'ZSPD',
      wttrQuery: 'Shanghai',
      wundergroundHistoryPath: 'cn/shanghai'
    }
  },
  hongkong: {
    key: 'hongkong',
    nameZh: '香港',
    nameEn: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    lat: 22.3080,
    lon: 113.9185,
    settlementSource: {
      provider: 'Wunderground',
      stationId: 'VHHH',
      queryName: 'Hong Kong International Airport'
    },
    market: {
      slugKeyword: 'highest-temperature-in-hong-kong',
      titleKeyword: 'Highest temperature in Hong Kong',
      eventPrefix: 'highest-temperature-in-hong-kong-on-',
      cityName: 'Hong Kong'
    },
    weather: {
      stationName: 'Hong Kong International Airport',
      stationCode: 'VHHH',
      wttrQuery: 'Hong Kong',
      wundergroundHistoryPath: 'hk/hong-kong'
    }
  }
};

export function normalizeLocationKey(input?: string | null): SupportedLocationKey {
  return input === 'hongkong' ? 'hongkong' : 'shanghai';
}

export function getLocationConfig(locationKey?: string | null): LocationConfig {
  return LOCATION_CONFIGS[normalizeLocationKey(locationKey)];
}

