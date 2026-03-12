export function parseResolutionMetadata(rulesText: string) {
  const stationCode = rulesText.match(/\b[A-Z]{4}\b/)?.[0] ?? 'ZSPD';
  const stationName =
    rulesText.match(/shanghai\s+pudong\s+international\s+airport\s+station/i)?.[0] ??
    'Shanghai Pudong International Airport Station';
  const precisionRule =
    rulesText.match(/measures temperatures to[^.]+/i)?.[0] ??
    rulesText.match(/precision[^.]+/i)?.[0] ??
    '结算精度以规则页说明为准（通常为整数摄氏度）';
  const finalizedRule =
    rulesText.match(/can not resolve[^.]+finalized[^.]+/i)?.[0] ??
    rulesText.match(/once information is finalized[^.]+/i)?.[0] ??
    '数据最终定稿后才可结算';
  const revisionRule =
    rulesText.match(/revisions?[^.]+not be considered[^.]+/i)?.[0] ??
    '若源站在定稿后修订，不纳入该市场结算';
  const urlMatch = rulesText.match(/https?:\/\/[^\s)]+/i);

  return {
    stationName,
    stationCode,
    sourceName: 'Wunderground',
    sourceUrl: urlMatch?.[0] ?? 'https://www.wunderground.com/history/daily/cn/shanghai/ZSPD',
    precisionRule,
    finalizedRule,
    revisionRule
  };
}
