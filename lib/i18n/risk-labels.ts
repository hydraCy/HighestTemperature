export type Lang = 'zh' | 'en';

const RISK_LABELS: Record<string, { zh: string; en: string }> = {
  precipitation_risk: { zh: '降水风险', en: 'Precipitation Risk' },
  cloud_risk: { zh: '云量风险', en: 'Cloud Cover Risk' },
  warming_stalled: { zh: '升温停滞', en: 'Warming Stalled' },
  no_profit_edge: { zh: '无净利润边际', en: 'No Net Profit Edge' },
  not_target_date: { zh: '非目标结算日', en: 'Not Target Date' },
  settlement_soon: { zh: '临近结算', en: 'Settlement Soon' },
  market_settled: { zh: '市场已结算', en: 'Market Settled' },
  market_inactive: { zh: '市场非活跃', en: 'Market Inactive' },
  weather_source_incomplete: { zh: '天气源不完整', en: 'Weather Sources Incomplete' },
  low_data_quality: { zh: '低数据质量', en: 'Low Data Quality' },
  low_weather_maturity: { zh: '短临成熟度低', en: 'Low Weather Maturity' },
  suppressed_heating: { zh: '压温场景', en: 'Suppressed Heating Scenario' },
  market_already_priced: { zh: '市场已充分定价', en: 'Market Already Priced' },
  temperature_locked: { zh: '温度已接近锁定', en: 'Temperature Locked' }
};

export function riskLabel(code: string, lang: Lang) {
  const item = RISK_LABELS[code];
  if (!item) return code;
  return item[lang];
}
