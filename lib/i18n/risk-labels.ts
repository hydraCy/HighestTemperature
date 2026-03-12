export type Lang = 'zh' | 'en';

const RISK_LABELS: Record<string, { zh: string; en: string }> = {
  precipitation_risk: { zh: '降水风险', en: 'Precipitation Risk' },
  cloud_risk: { zh: '云量风险', en: 'Cloud Cover Risk' },
  warming_stalled: { zh: '升温停滞', en: 'Warming Stalled' },
  no_profit_edge: { zh: '无净利润边际', en: 'No Net Profit Edge' },
  not_target_date: { zh: '非目标结算日', en: 'Not Target Date' },
  settlement_soon: { zh: '临近结算', en: 'Settlement Soon' },
  market_settled: { zh: '市场已结算', en: 'Market Settled' },
  market_inactive: { zh: '市场非活跃', en: 'Market Inactive' }
};

export function riskLabel(code: string, lang: Lang) {
  const item = RISK_LABELS[code];
  if (!item) return code;
  return item[lang];
}

