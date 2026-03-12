export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getMarketDetail } from '@/lib/services/query';
import { NoteInput } from '@/components/market/note-input';
import { fromJsonString } from '@/lib/utils/json';
import { TempTrendChart, BinEdgeChart } from '@/components/charts/market-charts';
import { riskLabel } from '@/lib/i18n/risk-labels';

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
          warning: 'Warning: data may be incomplete',
          market: 'market',
          weather: 'weather',
          weatherErrors: 'weather source errors',
          refreshHint: 'Please refresh and verify API status.',
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
          assistNote: 'Assist weather data is not final resolution basis. Final resolution follows Polymarket rules and designated source.',
          modelEdgeTable: 'Model / Edge Table',
          ask: 'Executable Ask',
          noPrice: 'No Price',
          bid: 'Bid',
          spread: 'Spread',
          modelYes: 'Model Yes',
          modelNo: 'Model No',
          evYes: 'EV(Yes)',
          evNo: 'EV(No)',
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
          position: 'Position Size',
          twd: 'Timing / Weather / DataQuality',
          tempTrend: 'Temperature Trend',
          binEdge: 'Bin Edge',
          snapshotsNotes: 'Snapshots & Notes',
          score: 'Score'
        }
      : {
          pageTag: '上海 / 市场详情',
          warning: '警告：数据可能不完整',
          market: '市场',
          weather: '天气',
          weatherErrors: '天气源异常',
          refreshHint: '建议先刷新并确认 API 正常。',
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
          assistNote: '辅助天气数据不是最终结算依据，结算以 Polymarket 规则与指定来源为准。',
          modelEdgeTable: '模型 / Edge 表',
          ask: '可成交价(ask)',
          noPrice: 'No价格',
          bid: 'bid',
          spread: 'spread',
          modelYes: '模型Yes',
          modelNo: '模型No',
          evYes: 'EV(Yes)',
          evNo: 'EV(No)',
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
          position: '建议仓位',
          twd: '时点 / 天气 / 数据质量',
          tempTrend: '温度趋势',
          binEdge: '各 Bin Edge',
          snapshotsNotes: '快照与笔记',
          score: '分数'
        };

  const { slug } = await params;
  const data = await getMarketDetail(slug);
  if (!data) return notFound();

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
      bestSide: edgeYes >= edgeNo ? 'YES' : 'NO',
      edge: out?.edge ?? 0
    };
  });
  const topProfit = [...allBins].sort((a, b) => b.edge - a.edge)[0];
  const weatherRaw = fromJsonString<{ raw?: { errors?: string[] } }>(data.latestWeather?.rawJson, {});
  const weatherErrors = weatherRaw.raw?.errors ?? [];

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

      {(data.marketSource !== 'api' || data.weatherSource !== 'api' || weatherErrors.length > 0) && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-300">
            {t.warning}（{t.market}：{data.marketSource}，{t.weather}：{data.weatherSource}）。
            {weatherErrors.length > 0 ? `${t.weatherErrors}：${weatherErrors.join('；')}` : t.refreshHint}
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
          <p className="md:col-span-2 text-xs text-muted-foreground">{t.assistNote}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t.modelEdgeTable}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead>{t.ask}</TableHead>
                  <TableHead>{t.noPrice}</TableHead>
                  <TableHead>{t.bid}</TableHead>
                  <TableHead>{t.spread}</TableHead>
                  <TableHead>{t.modelYes}</TableHead>
                  <TableHead>{t.modelNo}</TableHead>
                  <TableHead>{t.evYes}</TableHead>
                  <TableHead>{t.evNo}</TableHead>
                  <TableHead>{t.prefSide}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allBins.map((o) => (
                  <TableRow key={o.label}>
                    <TableCell>{o.label}</TableCell>
                    <TableCell>{(o.marketPrice * 100).toFixed(1)}%</TableCell>
                    <TableCell>{(o.noMarketPrice * 100).toFixed(1)}%</TableCell>
                    <TableCell>{o.bestBid != null ? `${(o.bestBid * 100).toFixed(1)}%` : '-'}</TableCell>
                    <TableCell>{o.spread != null ? `${(o.spread * 100).toFixed(1)}%` : '-'}</TableCell>
                    <TableCell>{(o.modelProbability * 100).toFixed(1)}%</TableCell>
                    <TableCell>{(o.modelNoProbability * 100).toFixed(1)}%</TableCell>
                    <TableCell className={o.edgeYes >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.edgeYes.toFixed(3)}</TableCell>
                    <TableCell className={o.edgeNo >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.edgeNo.toFixed(3)}</TableCell>
                    <TableCell>{o.bestSide}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.decisionOutput}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
              {t.topEdge}：{topProfit?.label ?? '-'}（Edge {(topProfit?.edge ?? 0).toFixed(3)}）
            </p>
            <p>{t.decision}: {decisionLabel(latestRun?.decision)}</p>
            <p>{t.recBin}: {latestRun?.bestBin ?? '-'}</p>
            <p>{t.recSide}: {fromJsonString<{ recommendedSide?: string }>(latestRun?.rawFeaturesJson, {}).recommendedSide ?? '-'}</p>
            <p>{t.tradeScore}: {latestRun?.tradeScore?.toFixed(2) ?? '-'}</p>
            <p>{t.position}: {latestRun?.recommendedPosition?.toFixed(2) ?? '-'}</p>
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
    </SiteShell>
  );
}
