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

  return (
    <SiteShell currentPath={`/market/${slug}`} lang={lang}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">上海 / 市场详情</p>
          <h1 className="text-xl font-semibold">{data.market.marketTitle}</h1>
        </div>
      </div>

      {(data.marketSource !== 'api' || data.weatherSource !== 'api' || weatherErrors.length > 0) && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-300">
            警告：数据可能不完整（市场：{data.marketSource}，天气：{data.weatherSource}）。{weatherErrors.length > 0 ? `天气源异常：${weatherErrors.join('；')}` : '建议先刷新并确认 API 正常。'}
          </CardContent>
        </Card>
      )}

      {data.marketStatus?.isSettled && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-300">
            该市场已到结算窗口或已关闭（结算时间：{data.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}），不建议继续下单。
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>结算口径标准卡</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>结算站点: {data.market.resolutionMetadata?.stationName ?? '-'}</p>
          <p>站点代码: {data.market.resolutionMetadata?.stationCode ?? '-'}</p>
          <p>来源: {data.market.resolutionMetadata?.sourceName ?? '-'}</p>
          <p>
            来源链接:{' '}
            {data.market.resolutionMetadata?.sourceUrl ? (
              <a href={data.market.resolutionMetadata.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">打开</a>
            ) : '-'}
          </p>
          <p>精度规则: {data.market.resolutionMetadata?.precisionRule ?? '-'}</p>
          <p>最终规则: {data.market.resolutionMetadata?.finalizedRule ?? '-'}</p>
          <p className="md:col-span-2 text-xs text-muted-foreground">辅助天气数据不是最终结算依据，结算以 Polymarket 规则与指定来源为准。</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>模型 / Edge 表</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead>可成交价(ask)</TableHead>
                  <TableHead>No价格</TableHead>
                  <TableHead>bid</TableHead>
                  <TableHead>spread</TableHead>
                  <TableHead>模型Yes</TableHead>
                  <TableHead>模型No</TableHead>
                  <TableHead>EV(Yes)</TableHead>
                  <TableHead>EV(No)</TableHead>
                  <TableHead>优先方向</TableHead>
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
          <CardHeader><CardTitle>决策输出</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
              最高净利润机会：{topProfit?.label ?? '-'}（Edge {(topProfit?.edge ?? 0).toFixed(3)}）
            </p>
            <p>决策: {latestRun?.decision === 'BUY' ? '买入' : latestRun?.decision === 'WATCH' ? '观察' : '放弃'}</p>
            <p>推荐 Bin: {latestRun?.bestBin ?? '-'}</p>
            <p>推荐方向: {fromJsonString<{ recommendedSide?: string }>(latestRun?.rawFeaturesJson, {}).recommendedSide ?? '-'}</p>
            <p>交易评分: {latestRun?.tradeScore?.toFixed(2) ?? '-'}</p>
            <p>建议仓位: {latestRun?.recommendedPosition?.toFixed(2) ?? '-'}</p>
            <p>时点 / 天气 / 数据质量: {latestRun?.timingScore?.toFixed(0) ?? '-'} / {latestRun?.weatherScore?.toFixed(0) ?? '-'} / {latestRun?.dataQualityScore?.toFixed(0) ?? '-'}</p>
            <div className="flex flex-wrap gap-1">
              {fromJsonString<string[]>(latestRun?.riskFlagsJson, []).map((r) => (
                <span key={r} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{r}</span>
              ))}
            </div>
            <p className="rounded border border-border/60 p-2 text-xs">{latestRun?.explanation ?? '-'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>温度趋势</CardTitle></CardHeader>
          <CardContent><TempTrendChart data={tempSeries} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>各 Bin Edge</CardTitle></CardHeader>
          <CardContent>
            <BinEdgeChart data={(latestRun?.outputs ?? []).map((o) => ({ label: o.outcomeLabel, edge: o.edge }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>快照与笔记</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 text-xs">
            {data.snapshots.map((s) => {
              const out = fromJsonString<{ decision?: string; tradeScore?: number }>(s.tradingOutputJson, {});
              return (
                <p key={s.id} className="rounded border border-border/60 px-2 py-1">
                  {format(s.capturedAt, 'yyyy-MM-dd HH:mm')} | {out.decision === 'BUY' ? '买入' : out.decision === 'WATCH' ? '观察' : '放弃'} | 分数 {out.tradeScore?.toFixed?.(2) ?? '-'}
                </p>
              );
            })}
          </div>
          <NoteInput marketId={data.market.id} />
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
