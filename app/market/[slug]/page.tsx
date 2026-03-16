export const dynamic = 'force-dynamic';

import { notFound, redirect } from 'next/navigation';
import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getMarketDetail } from '@/lib/services/query';
import { NoteInput } from '@/components/market/note-input';
import { fromJsonString } from '@/lib/utils/json';
import { TempTrendChart, BinEdgeChart } from '@/components/charts/market-charts';
import { riskLabel } from '@/lib/i18n/risk-labels';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

type DetailSearchParams = Promise<{ lang?: string | string[] }>;

export default async function MarketDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: DetailSearchParams;
}) {
  const sp = await searchParams;
  const lang = (Array.isArray(sp?.lang) ? sp.lang[0] : sp?.lang) === 'en' ? 'en' : 'zh';
  const t =
    lang === 'en'
      ? {
          pageTag: 'Shanghai / Market Detail',
          dateTags: 'Date Tags',
          gatePanel: 'Strategy Gates',
          gateDate: 'Date Alignment',
          gateFreshness: 'Weather Freshness',
          gateSources: 'Source Completeness',
          gateConsensus: 'Consensus Conflict',
          gateSecondEntry: 'Second Entry Guard',
          gatePass: 'PASS',
          gateWarn: 'WARN',
          gateBlock: 'BLOCK',
          targetDate: 'Market Target Date',
          shanghaiToday: 'Shanghai Today',
          warning: 'Warning: data may be incomplete',
          market: 'market',
          weather: 'weather',
          weatherErrors: 'weather source errors',
          strictBlock: 'Strict mode: incomplete weather sources, recommendation is forced to PASS.',
          strictMissing: 'Missing sources',
          weatherDateMismatch: 'Weather date mismatch',
          refreshHint: 'Please refresh and verify API status.',
          weatherStaleWarn: 'Weather data freshness is insufficient',
          staleThreshold: 'threshold',
          settledWarn: 'This market is in settlement window or closed',
          settlementTime: 'Settlement Time',
          avoidTrade: 'Not recommended to trade further.',
          resolutionCard: 'Resolution Standard Card',
          station: 'Resolution Station',
          stationCode: 'Station Code',
          source: 'Source',
          sourceUrl: 'Source URL',
          open: 'Open',
          precision: 'Precision Rule',
          finalizedRule: 'Finalization Rule',
          weatherTargetDate: 'Weather Target Date',
          weatherObservedAt: 'Weather Observed At',
          weatherFetchedAt: 'Weather Fetched At',
          weatherFreshness: 'Weather Freshness',
          assistNote: 'Assist weather data is not final resolution basis. Final resolution follows Polymarket rules and designated source.',
          modelEdgeTable: 'Model / Edge Table',
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
          prefSide: 'Preferred Side',
          decisionOutput: 'Decision Output',
          topEdge: 'Top net edge opportunity',
          decision: 'Decision',
          buy: 'BUY',
          watch: 'WATCH',
          pass: 'PASS',
          recBin: 'Recommended Bin',
          recSide: 'Recommended Side',
          tradeScore: 'Trade Score',
          edge: 'Edge',
          twd: 'Timing / Weather / DataQuality',
          tempTrend: 'Temperature Trend',
          binEdge: 'Bin Edge',
          snapshotsNotes: 'Snapshots & Notes',
          score: 'Score',
          biasTitle: 'Prev-day Source Bias (vs Settled)',
          biasStatsTitle: 'Source Accuracy Stats (Historical)',
          sourceCode: 'Source',
          sourceGroup: 'Group',
          forecastDate: 'Forecast Date',
          capturedAt: 'Captured At',
          predicted: 'Pred Max',
          settled: 'Settled Max',
          bias: 'Bias',
          absError: 'Abs Error',
          noBias: 'No bias records yet.'
        }
      : {
          pageTag: '上海 / 市场详情',
          dateTags: '日期标签',
          gatePanel: '策略门控状态',
          gateDate: '日期一致性',
          gateFreshness: '天气新鲜度',
          gateSources: '数据源完整性',
          gateConsensus: '主共识冲突',
          gateSecondEntry: '二次入场保护',
          gatePass: '通过',
          gateWarn: '告警',
          gateBlock: '阻断',
          targetDate: '市场目标日期',
          shanghaiToday: '上海当前日期',
          warning: '警告：数据可能不完整',
          market: '市场',
          weather: '天气',
          weatherErrors: '天气源异常',
          strictBlock: '严格模式：天气源不完整，系统强制 PASS。',
          strictMissing: '缺失数据源',
          weatherDateMismatch: '天气日期不匹配',
          refreshHint: '建议先刷新并确认 API 正常。',
          weatherStaleWarn: '天气数据新鲜度不足',
          staleThreshold: '阈值',
          settledWarn: '该市场已到结算窗口或已关闭',
          settlementTime: '结算时间',
          avoidTrade: '不建议继续下单。',
          resolutionCard: '结算口径标准卡',
          station: '结算站点',
          stationCode: '站点代码',
          source: '来源',
          sourceUrl: '来源链接',
          open: '打开',
          precision: '精度规则',
          finalizedRule: '最终规则',
          weatherTargetDate: '天气数据目标日期',
          weatherObservedAt: '天气观测时间',
          weatherFetchedAt: '天气抓取时间',
          weatherFreshness: '天气新鲜度',
          assistNote: '辅助天气数据不是最终结算依据，结算以 Polymarket 规则与指定来源为准。',
          modelEdgeTable: '模型 / Edge 表',
          focusedBins: '聚焦可交易盘口（中心温度±2）',
          tailBins: '尾部盘口（低价值，折叠）',
          centerTemp: '中心温度',
          bin: '盘口',
          ask: '可成交价(ask)',
          noPrice: 'No价格',
          bid: 'bid',
          spread: 'spread',
          modelYes: '模型Yes',
          modelNo: '模型No',
          evConstrained: 'EV(联动)',
          prefSide: '优先方向',
          decisionOutput: '决策输出',
          topEdge: '最高净利润机会',
          decision: '决策',
          buy: '买入',
          watch: '观察',
          pass: '放弃',
          recBin: '推荐 Bin',
          recSide: '推荐方向',
          tradeScore: '交易评分',
          edge: 'Edge',
          twd: '时点 / 天气 / 数据质量',
          tempTrend: '温度趋势',
          binEdge: '各 Bin Edge',
          snapshotsNotes: '快照与笔记',
          score: '分数',
          biasTitle: '前一日各源偏差（对结算）',
          biasStatsTitle: '数据源历史精度统计',
          sourceCode: '数据源',
          sourceGroup: '分组',
          forecastDate: '预测日期',
          capturedAt: '记录时间',
          predicted: '预测最高温',
          settled: '结算最高温',
          bias: '偏差',
          absError: '绝对误差',
          noBias: '暂无偏差记录。'
        };

  const { slug } = await params;
  const data = await getMarketDetail(slug);
  if (!data) return notFound();
  if (!data.isLatestMarket && data.latestMarketSlug) {
    redirect(`/market/${data.latestMarketSlug}?lang=${lang}`);
  }

  const tempSeries = data.market.weatherSnapshots
    .slice()
    .reverse()
    .map((w) => ({ time: format(w.observedAt, 'HH:mm'), temp: w.temperature2m }));

  const latestRun = data.latestRun;
  const outputMap = new Map((latestRun?.outputs ?? []).map((o) => [o.outcomeLabel, o]));
  const allBins = data.market.bins.map((b) => {
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
  const reasonMeta = fromJsonString<{ calibratedFusedTemp?: number; mostLikelyInteger?: number }>(latestRun?.rawFeaturesJson, {});
  const centerTempRaw = reasonMeta.mostLikelyInteger ?? reasonMeta.calibratedFusedTemp;
  const centerTemp = typeof centerTempRaw === 'number' && Number.isFinite(centerTempRaw)
    ? Math.round(centerTempRaw)
    : null;
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
    const grossEdge = side === 'YES' ? b.edgeYes : b.edgeNo;
    const constrainedNetEv = b.engineConstrainedEdge ?? (grossEdge - tradingCost);
    return { ...b, bestSide: side as 'YES' | 'NO', bestEdge: constrainedNetEv, constrainedEv: constrainedNetEv };
  });
  const topProfit = [...allBinsWithGlobalSide].sort((a, b) => b.constrainedEv - a.constrainedEv)[0];
  const focusMin = centerTemp != null ? centerTemp - 2.5 : null;
  const focusMax = centerTemp != null ? centerTemp + 2.5 : null;
  const highProbLabels = new Set(
    allBinsWithGlobalSide
      .filter((b) => b.constrainedEv >= 0.03 || b.label === latestRun?.bestBin)
      .map((b) => b.label),
  );
  const isFocusedBin = (label: string) => {
    if (highProbLabels.has(label)) return true;
    if (focusMin == null || focusMax == null) return true;
    const p = parseTemperatureBin(label);
    if (p.min == null && p.max == null) return true;
    const lo = p.min ?? Number.NEGATIVE_INFINITY;
    const hi = p.max ?? Number.POSITIVE_INFINITY;
    return hi > focusMin && lo < focusMax;
  };
  const focusedBins = allBinsWithGlobalSide.filter((b) => isFocusedBin(b.label));
  const tailBins = allBinsWithGlobalSide.filter((b) => !isFocusedBin(b.label));
  const weatherRaw = fromJsonString<{ raw?: { errors?: string[] } }>(data.latestWeather?.rawJson, {});
  const weatherErrors = weatherRaw.raw?.errors ?? [];
  const weatherTargetDate = (weatherRaw.raw as { targetDate?: string } | undefined)?.targetDate;
  const weatherObservedAt = (weatherRaw.raw as { nowcasting?: { observedAt?: string } } | undefined)?.nowcasting?.observedAt;
  const weatherFetchedAt = (weatherRaw.raw as { fetchedAtIso?: string } | undefined)?.fetchedAtIso;
  const weatherFreshnessMinutes = (() => {
    const base = weatherFetchedAt ?? weatherObservedAt;
    if (!base) return null;
    const ts = new Date(base).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 60000));
  })();
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
  const shanghaiTodayKey = toShanghaiDateKey(new Date());
  const riskSet = new Set(fromJsonString<string[]>(latestRun?.riskFlagsJson, []));
  const marketTargetDateKey = format(data.market.targetDate, 'yyyy-MM-dd');
  const isDateAligned = !weatherTargetDate || marketTargetDateKey === weatherTargetDate;
  const weatherStaleThresholdMinutes = Number(process.env.WEATHER_STALE_MINUTES ?? '15');
  const isWeatherStale = weatherFreshnessMinutes != null
    && Number.isFinite(weatherStaleThresholdMinutes)
    && weatherStaleThresholdMinutes > 0
    && weatherFreshnessMinutes > weatherStaleThresholdMinutes;
  const strictReady = (weatherRaw.raw as { strictReady?: boolean } | undefined)?.strictReady ?? false;
  const missingSources = (weatherRaw.raw as { missingSources?: string[] } | undefined)?.missingSources ?? [];

  const decisionLabel = (d?: string) => (d === 'BUY' ? t.buy : d === 'WATCH' ? t.watch : t.pass);
  const reasonLocalized =
    lang === 'en'
      ? fromJsonString<{ reasonEn?: string }>(latestRun?.rawFeaturesJson, {}).reasonEn ?? latestRun?.explanation ?? '-'
      : fromJsonString<{ reasonZh?: string }>(latestRun?.rawFeaturesJson, {}).reasonZh ?? latestRun?.explanation ?? '-';

  return (
    <SiteShell currentPath={`/market/${slug}`} lang={lang}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t.pageTag}</p>
          <h1 className="text-xl font-semibold">{data.market.marketTitle}</h1>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>{t.dateTags}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-4">
          <p>{t.targetDate}: {format(data.market.targetDate, 'yyyy-MM-dd')}</p>
          <p>{t.weatherTargetDate}: {weatherTargetDate ?? '-'}</p>
          <p>{t.shanghaiToday}: {shanghaiTodayKey}</p>
          <p>{t.settlementTime}: {data.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t.gatePanel}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <div className="flex items-center justify-between rounded border border-border/50 px-2 py-1"><span>{t.gateDate}</span><Badge variant={isDateAligned ? 'success' : 'destructive'}>{isDateAligned ? t.gatePass : t.gateBlock}</Badge></div>
          <div className="flex items-center justify-between rounded border border-border/50 px-2 py-1"><span>{t.gateFreshness}</span><Badge variant={isWeatherStale ? 'destructive' : 'success'}>{isWeatherStale ? t.gateBlock : t.gatePass}</Badge></div>
          <div className="flex items-center justify-between rounded border border-border/50 px-2 py-1"><span>{t.gateSources}</span><Badge variant={strictReady ? 'success' : 'destructive'}>{strictReady ? t.gatePass : t.gateBlock}</Badge></div>
          <div className="flex items-center justify-between rounded border border-border/50 px-2 py-1"><span>{t.gateConsensus}</span><Badge variant={riskSet.has('market_consensus_conflict') ? 'warning' : 'success'}>{riskSet.has('market_consensus_conflict') ? t.gateWarn : t.gatePass}</Badge></div>
          <div className="flex items-center justify-between rounded border border-border/50 px-2 py-1 md:col-span-2"><span>{t.gateSecondEntry}</span><Badge variant={riskSet.has('second_entry_guard') ? 'warning' : 'success'}>{riskSet.has('second_entry_guard') ? t.gateWarn : t.gatePass}</Badge></div>
        </CardContent>
      </Card>

      {(data.marketSource !== 'api' || data.weatherSource !== 'api' || weatherErrors.length > 0 || !strictReady || isWeatherStale) && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-300">
            {t.warning}（{t.market}：{data.marketSource}，{t.weather}：{data.weatherSource}）。
            {weatherErrors.length > 0 ? `${t.weatherErrors}：${weatherErrors.join('；')}` : t.refreshHint}
            {!strictReady ? ` ${t.strictBlock}${missingSources.length ? `（${t.strictMissing}：${missingSources.join(', ')}）` : ''}` : ''}
            {isWeatherStale ? ` ${t.weatherStaleWarn}（${weatherFreshnessMinutes} ${lang === 'en' ? 'min' : '分钟'}，${t.staleThreshold} ${weatherStaleThresholdMinutes} ${lang === 'en' ? 'min' : '分钟'}）` : ''}
            {weatherTargetDate && weatherTargetDate !== format(data.market.targetDate, 'yyyy-MM-dd') ? ` ${t.weatherDateMismatch}: weather=${weatherTargetDate}, market=${format(data.market.targetDate, 'yyyy-MM-dd')}` : ''}
          </CardContent>
        </Card>
      )}

      {data.marketStatus?.isSettled && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-300">
            {t.settledWarn}（{t.settlementTime}：{data.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}），{t.avoidTrade}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t.resolutionCard}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>{t.station}: {data.market.resolutionMetadata?.stationName ?? '-'}</p>
          <p>{t.stationCode}: {data.market.resolutionMetadata?.stationCode ?? '-'}</p>
          <p>{t.source}: {data.market.resolutionMetadata?.sourceName ?? '-'}</p>
          <p>
            {t.sourceUrl}:{' '}
            {data.market.resolutionMetadata?.sourceUrl ? (
              <a href={data.market.resolutionMetadata.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">{t.open}</a>
            ) : '-'}
          </p>
          <p>{t.precision}: {data.market.resolutionMetadata?.precisionRule ?? '-'}</p>
          <p>{t.finalizedRule}: {data.market.resolutionMetadata?.finalizedRule ?? '-'}</p>
          <p>{t.weatherTargetDate}: {weatherTargetDate ?? '-'}</p>
          <p>{t.weatherObservedAt}: {weatherObservedAt ? format(new Date(weatherObservedAt), 'yyyy-MM-dd HH:mm') : '-'}</p>
          <p>{t.weatherFetchedAt}: {weatherFetchedAt ? format(new Date(weatherFetchedAt), 'yyyy-MM-dd HH:mm:ss') : '-'}</p>
          <p>{t.weatherFreshness}: {weatherFreshnessMinutes != null ? `${weatherFreshnessMinutes} ${lang === 'en' ? 'min' : '分钟'}` : '-'}</p>
          <p className="md:col-span-2 text-xs text-muted-foreground">{t.assistNote}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.focusedBins}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.centerTemp}: {centerTemp != null ? `${centerTemp}°C` : '-'}</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.bin}</TableHead>
                  <TableHead>{t.ask}</TableHead>
                  <TableHead>{t.noPrice}</TableHead>
                  <TableHead>{t.bid}</TableHead>
                  <TableHead>{t.spread}</TableHead>
                  <TableHead>{t.modelYes}</TableHead>
                  <TableHead>{t.modelNo}</TableHead>
                  <TableHead>{t.evConstrained}</TableHead>
                  <TableHead>{t.prefSide}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {focusedBins.map((o) => (
                  <TableRow key={o.label}>
                    <TableCell>{o.label}</TableCell>
                    <TableCell>{(o.marketPrice * 100).toFixed(1)}%</TableCell>
                    <TableCell>{(o.noMarketPrice * 100).toFixed(1)}%</TableCell>
                    <TableCell>{o.bestBid != null ? `${(o.bestBid * 100).toFixed(1)}%` : '-'}</TableCell>
                    <TableCell>{o.spread != null ? `${(o.spread * 100).toFixed(1)}%` : '-'}</TableCell>
                    <TableCell>{(o.modelProbability * 100).toFixed(1)}%</TableCell>
                    <TableCell>{(o.modelNoProbability * 100).toFixed(1)}%</TableCell>
                    <TableCell className={o.constrainedEv >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.constrainedEv.toFixed(3)}</TableCell>
                    <TableCell>{o.bestSide}</TableCell>
                  </TableRow>
                ))}
                {tailBins.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-xs text-muted-foreground">
                      {t.tailBins}: {tailBins.map((b) => b.label).join(', ')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.decisionOutput}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
              {t.topEdge}：{topProfit?.label ?? '-'} / {(topProfit?.bestSide ?? '-')}（Edge {(topProfit?.bestEdge ?? 0).toFixed(3)}）
            </p>
            <p>{t.decision}: {decisionLabel(latestRun?.decision)}</p>
            <p>{t.recBin}: {latestRun?.bestBin ?? '-'}</p>
            <p>{t.recSide}: {fromJsonString<{ recommendedSide?: string }>(latestRun?.rawFeaturesJson, {}).recommendedSide ?? '-'}</p>
            <p>{t.edge}: {latestRun?.edge != null ? latestRun.edge.toFixed(3) : '-'}</p>
            <p>{t.tradeScore}: {latestRun?.tradeScore?.toFixed(2) ?? '-'}</p>
            <p>{t.twd}: {latestRun?.timingScore?.toFixed(0) ?? '-'} / {latestRun?.weatherScore?.toFixed(0) ?? '-'} / {latestRun?.dataQualityScore?.toFixed(0) ?? '-'}</p>
            <div className="flex flex-wrap gap-1">
              {fromJsonString<string[]>(latestRun?.riskFlagsJson, []).map((r) => (
                <span key={r} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{riskLabel(r, lang)}</span>
              ))}
            </div>
            <p className="rounded border border-border/60 p-2 text-xs">{reasonLocalized}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t.tempTrend}</CardTitle></CardHeader>
          <CardContent><TempTrendChart data={tempSeries} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t.binEdge}</CardTitle></CardHeader>
          <CardContent>
            <BinEdgeChart data={(latestRun?.outputs ?? []).map((o) => ({ label: o.outcomeLabel, edge: o.edge }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t.snapshotsNotes}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 text-xs">
            {data.snapshots.map((s) => {
              const out = fromJsonString<{ decision?: string; tradeScore?: number }>(s.tradingOutputJson, {});
              return (
                <p key={s.id} className="rounded border border-border/60 px-2 py-1">
                  {format(s.capturedAt, 'yyyy-MM-dd HH:mm')} | {decisionLabel(out.decision)} | {t.score} {out.tradeScore?.toFixed?.(2) ?? '-'}
                </p>
              );
            })}
          </div>
          <NoteInput marketId={data.market.id} lang={lang} />
          <div className="space-y-1 text-xs">
            {data.market.notes.map((n) => (
              <p key={n.id} className="rounded border border-border/60 px-2 py-1">{format(n.createdAt, 'MM-dd HH:mm')} {n.noteText}</p>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.biasTitle}</CardTitle></CardHeader>
        <CardContent>
          {data.market.forecastBiases.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noBias}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.sourceCode}</TableHead>
                  <TableHead>{t.sourceGroup}</TableHead>
                  <TableHead>{t.forecastDate}</TableHead>
                  <TableHead>{t.capturedAt}</TableHead>
                  <TableHead>{t.predicted}</TableHead>
                  <TableHead>{t.settled}</TableHead>
                  <TableHead>{t.bias}</TableHead>
                  <TableHead>{t.absError}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.market.forecastBiases.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.sourceCode}</TableCell>
                    <TableCell>{b.sourceGroup}</TableCell>
                    <TableCell>{format(b.forecastDate, 'yyyy-MM-dd')}</TableCell>
                    <TableCell>{format(b.capturedAt, 'yyyy-MM-dd HH:mm')}</TableCell>
                    <TableCell>{b.predictedMax.toFixed(1)}°C</TableCell>
                    <TableCell>{b.finalMax.toFixed(1)}°C</TableCell>
                    <TableCell className={b.bias >= 0 ? 'text-amber-300' : 'text-sky-300'}>{b.bias.toFixed(1)}°C</TableCell>
                    <TableCell>{b.absError.toFixed(1)}°C</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.biasStatsTitle}</CardTitle></CardHeader>
        <CardContent>
          {data.biasStats.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noBias}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.sourceCode}</TableHead>
                  <TableHead>{t.sourceGroup}</TableHead>
                  <TableHead>N</TableHead>
                  <TableHead>MAE</TableHead>
                  <TableHead>Avg Bias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.biasStats.map((s) => (
                  <TableRow key={`${s.sourceCode}-${s.sourceGroup}`}>
                    <TableCell>{s.sourceCode}</TableCell>
                    <TableCell>{s.sourceGroup}</TableCell>
                    <TableCell>{s._count.sourceCode}</TableCell>
                    <TableCell>{s._avg.absError?.toFixed(2) ?? '-'}°C</TableCell>
                    <TableCell>{s._avg.bias?.toFixed(2) ?? '-'}°C</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </SiteShell>
  );
}
