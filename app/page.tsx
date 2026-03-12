export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshAllButton } from '@/components/market/refresh-all-button';
import { getDashboardData } from '@/lib/services/query';
import { fromJsonString } from '@/lib/utils/json';
import { riskLabel } from '@/lib/i18n/risk-labels';

type PageSearchParams = Promise<{ lang?: string | string[] }>;

export default async function HomePage({ searchParams }: { searchParams: PageSearchParams }) {
  const sp = await searchParams;
  const lang = (Array.isArray(sp?.lang) ? sp.lang[0] : sp?.lang) === 'en' ? 'en' : 'zh';
  const t =
    lang === 'en'
      ? {
          mode: 'Research Mode',
          title: 'Decision / Position / Reason',
          city: 'Shanghai',
          warningPrefix: 'Warning: data may be incomplete',
          warningMarket: 'market',
          warningWeather: 'weather',
          weatherErrors: 'weather source errors',
          nonDirectResolution: 'Wunderground direct resolution source is not connected yet; proxy weather estimate only.',
          settledTitle: 'Market is in settlement window or closed',
          settledForcePass: 'System output is forced to PASS and position is 0.',
          resolutionCard: 'Resolution Standard Card',
          station: 'Resolution Station',
          stationCode: 'Station Code',
          source: 'Source',
          sourceUrl: 'Source URL',
          open: 'Open',
          precision: 'Precision Rule',
          finalizeRule: 'Finalization Rule',
          marketSource: 'Market Data Source',
          weatherSource: 'Weather Data Source',
          settlementTime: 'Settlement Time',
          minsToSettlement: 'Minutes to Settlement',
          mins: 'min',
          assistNote: 'Assist weather data is not final resolution basis. Final resolution follows Polymarket rules and Wunderground station source.',
          recentSettlement: 'Recent Settlement Result',
          finalTemp: 'Final Max Temp',
          winningBin: 'Winning Bin',
          settledAt: 'Settled At',
          settledSource: 'Settlement Source',
          wuHistory: 'Wunderground History Page',
          marketPanel: 'Market Board',
          marketSlug: 'Market Slug',
          marketTitle: 'Title',
          targetDate: 'Target Date',
          volume: 'Volume',
          sourceMarketLink: 'Polymarket Link',
          openPolymarket: 'Open Polymarket',
          modelPanel: 'Model Board',
          dayMaxForecast: 'Target Day Max Temp Forecast',
          sourceBreakdown: 'Source Breakdown',
          chinaWeather: 'China Weather',
          fused: 'Fused',
          rise123h: 'Rise before peak 1h/2h/3h',
          peakCloud: 'Cloud cover at peak',
          peakPrecip: 'Precip proxy at peak',
          peakWind: 'Wind speed at peak',
          decisionPanel: 'Trading Decision Board',
          topEdge: 'Top net edge opportunity',
          decision: 'Decision',
          buy: 'BUY',
          watch: 'WATCH',
          pass: 'PASS',
          recBin: 'Recommended Bin',
          recSide: 'Recommended Side',
          edge: 'Edge',
          tradeScore: 'Trade Score',
          position: 'Position Size',
          timingScore: 'Timing Score',
          weatherScore: 'Weather Stability Score',
          dataQualityScore: 'Data Quality Score',
          noDecision: 'No decision yet. Please refresh.',
          detail: 'View Details',
          allBins: 'All Bins',
          bin: 'Bin',
          ask: 'Executable Ask',
          noPrice: 'No Price',
          bid: 'Bid',
          spread: 'Spread',
          modelYes: 'Model Yes',
          modelNo: 'Model No',
          evYes: 'EV(Yes)',
          evNo: 'EV(No)',
          preferredSide: 'Preferred Side',
          snapshots: 'Recent Snapshots',
          score: 'Score',
          apiLive: 'Live API',
          unknown: 'Unknown'
        }
      : {
          mode: '研究模式',
          title: '决策 / 仓位 / 理由',
          city: '上海（Shanghai）',
          warningPrefix: '警告：当前数据可能不完整',
          warningMarket: '市场',
          warningWeather: '天气',
          weatherErrors: '天气源异常',
          nonDirectResolution: '当前尚未直接接入 Wunderground 结算源，只能用代理天气源估算。',
          settledTitle: '当前市场已到结算窗口或已关闭',
          settledForcePass: '系统已强制输出 PASS，仓位为 0。',
          resolutionCard: '结算口径标准卡',
          station: '结算站点',
          stationCode: '站点代码',
          source: '来源',
          sourceUrl: '来源链接',
          open: '打开',
          precision: '精度规则',
          finalizeRule: '最终规则',
          marketSource: '市场数据来源',
          weatherSource: '天气数据来源',
          settlementTime: '结算时间',
          minsToSettlement: '距结算',
          mins: '分钟',
          assistNote: '辅助天气数据不是最终结算依据，结算以 Polymarket 规则页与 Wunderground 指定站点为准。',
          recentSettlement: '最近结算结果',
          finalTemp: '最终最高温',
          winningBin: '命中盘口',
          settledAt: '结算时间',
          settledSource: '结算来源',
          wuHistory: 'Wunderground 历史页',
          marketPanel: '市场面板',
          marketSlug: '市场标识',
          marketTitle: '标题',
          targetDate: '目标日期',
          volume: '成交量',
          sourceMarketLink: '原站盘口',
          openPolymarket: '打开 Polymarket',
          modelPanel: '模型面板',
          dayMaxForecast: '目标日全天最高温预测',
          sourceBreakdown: '来源拆解',
          chinaWeather: '中国天气',
          fused: '融合',
          rise123h: '峰值前升温 1h/2h/3h',
          peakCloud: '峰值时云量',
          peakPrecip: '峰值时降水代理',
          peakWind: '峰值时风速',
          decisionPanel: '交易决策面板',
          topEdge: '最高净利润机会',
          decision: '决策',
          buy: '买入',
          watch: '观察',
          pass: '放弃',
          recBin: '推荐 Bin',
          recSide: '推荐方向',
          edge: 'Edge',
          tradeScore: '交易评分',
          position: '建议仓位',
          timingScore: '时点评分',
          weatherScore: '天气稳定分',
          dataQualityScore: '数据质量分',
          noDecision: '暂无决策，请刷新后查看。',
          detail: '查看详情',
          allBins: '全部盘口（Bin）',
          bin: '盘口',
          ask: '可成交价(ask)',
          noPrice: 'No价格',
          bid: 'bid',
          spread: 'spread',
          modelYes: '模型Yes',
          modelNo: '模型No',
          evYes: 'EV(Yes)',
          evNo: 'EV(No)',
          preferredSide: '优先方向',
          snapshots: '最近快照',
          score: '分数',
          apiLive: '实时API',
          unknown: '未知'
        };

  const data = await getDashboardData();
  const sourceLabel = (s?: string) => (s === 'api' ? t.apiLive : t.unknown);
  const decisionLabel = (d?: string) => (d === 'BUY' ? t.buy : d === 'WATCH' ? t.watch : t.pass);
  const weatherRaw = fromJsonString<{ raw?: { errors?: string[] } }>(data?.latestWeather?.rawJson, {});
  const weatherErrors = weatherRaw.raw?.errors ?? [];
  const sourceDailyMax = (weatherRaw.raw as { sourceDailyMax?: { openMeteo?: number | null; wttr?: number | null; metNo?: number | null; cmaChina?: number | null; fused?: number | null } } | undefined)?.sourceDailyMax;
  const resolutionSourceStatus = (weatherRaw.raw as { resolutionSourceStatus?: string } | undefined)?.resolutionSourceStatus;
  const outputMap = new Map((data?.latestRun?.outputs ?? []).map((o) => [o.outcomeLabel, o]));
  const allBins = (data?.market.bins ?? []).map((b) => {
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

  return (
    <SiteShell currentPath="/" lang={lang}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t.mode}</p>
          <h1 className="text-xl font-semibold">{t.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded border bg-background px-3 text-sm" defaultValue="Shanghai">
            <option value="Shanghai">{t.city}</option>
          </select>
          <RefreshAllButton lang={lang} />
        </div>
      </div>

      {(data?.marketSource !== 'api' || data?.weatherSource !== 'api' || weatherErrors.length > 0 || resolutionSourceStatus !== 'direct') && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4 text-sm text-amber-300">
            {t.warningPrefix}（{t.warningMarket}：{sourceLabel(data?.marketSource)}，{t.warningWeather}：{sourceLabel(data?.weatherSource)}）。
            {weatherErrors.length > 0 ? `${t.weatherErrors}：${weatherErrors.join('；')}` : ''}
            {resolutionSourceStatus !== 'direct' ? ` ${t.nonDirectResolution}` : ''}
          </CardContent>
        </Card>
      )}

      {data?.marketStatus?.isSettled && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-300">
            {t.settledTitle}（{t.settlementTime}：{data?.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}）。
            {t.settledForcePass}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t.resolutionCard}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>{t.station}: {data?.market.resolutionMetadata?.stationName ?? '-'}</p>
          <p>{t.stationCode}: {data?.market.resolutionMetadata?.stationCode ?? '-'}</p>
          <p>{t.source}: {data?.market.resolutionMetadata?.sourceName ?? '-'}</p>
          <p>
            {t.sourceUrl}:{' '}
            {data?.market.resolutionMetadata?.sourceUrl ? (
              <a className="text-primary underline" href={data.market.resolutionMetadata.sourceUrl} target="_blank" rel="noreferrer">{t.open}</a>
            ) : '-'}
          </p>
          <p>{t.precision}: {data?.market.resolutionMetadata?.precisionRule ?? '-'}</p>
          <p>{t.finalizeRule}: {data?.market.resolutionMetadata?.finalizedRule ?? '-'}</p>
          <p>{t.marketSource}: <span className={data?.marketSource === 'api' ? 'text-emerald-400' : 'text-amber-300'}>{sourceLabel(data?.marketSource)}</span></p>
          <p>{t.weatherSource}: <span className={data?.weatherSource === 'api' ? 'text-emerald-400' : 'text-amber-300'}>{sourceLabel(data?.weatherSource)}（Open-Meteo + wttr.in）</span></p>
          <p>{t.settlementTime}: {data?.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}</p>
          <p>{t.minsToSettlement}: {typeof data?.marketStatus?.minutesToSettlement === 'number' ? `${data.marketStatus.minutesToSettlement} ${t.mins}` : '-'}</p>
          <p className="md:col-span-2">{t.assistNote}</p>
        </CardContent>
      </Card>

      {data?.market.settledResult && (
        <Card>
          <CardHeader><CardTitle>{t.recentSettlement}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <p>{t.finalTemp}: {data.market.settledResult.finalValue.toFixed(0)}°C</p>
            <p>{t.winningBin}: {data.market.settledResult.finalOutcomeLabel}</p>
            <p>{t.settledAt}: {format(data.market.settledResult.settledAt, 'yyyy-MM-dd HH:mm')}</p>
            <p>
              {t.settledSource}:{' '}
              <a className="text-primary underline" href={data.market.settledResult.sourceUrl} target="_blank" rel="noreferrer">
                {t.wuHistory}
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>{t.marketPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t.marketSlug}: {data?.market.marketSlug ?? '-'}</p>
            <p>{t.marketTitle}: {data?.market.marketTitle ?? '-'}</p>
            <p>{t.targetDate}: {data?.market.targetDate ? format(data.market.targetDate, 'yyyy-MM-dd') : '-'}</p>
            <p>{t.volume}: {data?.market.volume?.toFixed(0) ?? '-'}</p>
            {data?.market?.marketSlug && (
              <p>
                {t.sourceMarketLink}:{' '}
                <a
                  className="text-primary underline"
                  href={`https://polymarket.com/zh/event/${data.market.marketSlug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.openPolymarket}
                </a>
              </p>
            )}
            <div className="space-y-1">
              {data?.market.bins.map((b) => (
                <p key={b.id} className="rounded border border-border/60 px-2 py-1 text-xs">
                  {b.outcomeLabel} | {t.ask} {b.marketPrice.toFixed(3)} | {t.bid} {b.bestBid?.toFixed(3) ?? '-'} | {t.spread} {b.spread?.toFixed(3) ?? '-'}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.modelPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t.dayMaxForecast}: {data?.latestWeather?.maxTempSoFar?.toFixed(1) ?? '-'}°C</p>
            <p className="text-xs text-muted-foreground">
              {t.sourceBreakdown}: Open‑Meteo {sourceDailyMax?.openMeteo != null ? `${sourceDailyMax.openMeteo.toFixed(1)}°C` : '-'} / wttr {sourceDailyMax?.wttr != null ? `${sourceDailyMax.wttr.toFixed(1)}°C` : '-'} / met.no {sourceDailyMax?.metNo != null ? `${sourceDailyMax.metNo.toFixed(1)}°C` : '-'} / {t.chinaWeather} {sourceDailyMax?.cmaChina != null ? `${sourceDailyMax.cmaChina.toFixed(1)}°C` : '-'} / {t.fused} {sourceDailyMax?.fused != null ? `${sourceDailyMax.fused.toFixed(1)}°C` : '-'}
            </p>
            <p>{t.rise123h}: {data?.latestWeather?.tempRise1h?.toFixed(2) ?? '-'} / {data?.latestWeather?.tempRise2h?.toFixed(2) ?? '-'} / {data?.latestWeather?.tempRise3h?.toFixed(2) ?? '-'}</p>
            <p>{t.peakCloud}: {data?.latestWeather?.cloudCover?.toFixed(0) ?? '-'}%</p>
            <p>{t.peakPrecip}: {data?.latestWeather?.precipitation?.toFixed(2) ?? '-'}</p>
            <p>{t.peakWind}: {data?.latestWeather?.windSpeed?.toFixed(1) ?? '-'} km/h</p>
            <div className="space-y-1">
              {data?.latestRun?.outputs.map((o) => (
                <p key={o.id} className="rounded border border-border/60 px-2 py-1 text-xs">
                  {o.outcomeLabel}: {t.modelYes} {(o.modelProbability * 100).toFixed(1)}% / {t.marketSource} {(o.marketPrice * 100).toFixed(1)}% / Edge {o.edge.toFixed(3)}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t.decisionPanel}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
              {t.topEdge}：{topProfit?.label ?? '-'}（Edge {(topProfit?.edge ?? 0).toFixed(3)}）
            </p>
            <div className="flex items-center gap-2">
              <span>{t.decision}:</span>
              <Badge variant={data?.latestDecision?.decision === 'BUY' ? 'success' : data?.latestDecision?.decision === 'WATCH' ? 'warning' : 'secondary'}>
                {decisionLabel(data?.latestDecision?.decision)}
              </Badge>
            </div>
            <p>{t.recBin}: {data?.latestDecision?.recommendedBin ?? '-'}</p>
            <p>{t.recSide}: {data?.latestDecision?.recommendedSide ?? '-'}</p>
            <p>{t.edge}: {data?.latestDecision?.edge?.toFixed(3) ?? '-'}</p>
            <p>{t.tradeScore}: {data?.latestDecision?.tradeScore?.toFixed(2) ?? '-'}</p>
            <p>{t.position}: {data?.latestDecision?.positionSize?.toFixed(2) ?? '0.00'}</p>
            <p>{t.timingScore}: {data?.latestDecision?.timingScore?.toFixed(0) ?? '-'}</p>
            <p>{t.weatherScore}: {data?.latestDecision?.weatherScore?.toFixed(0) ?? '-'}</p>
            <p>{t.dataQualityScore}: {data?.latestDecision?.dataQualityScore?.toFixed(0) ?? '-'}</p>
            <div className="flex flex-wrap gap-1">
              {(data?.latestDecision?.riskFlags ?? []).map((r) => (
                <span key={r} className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">{riskLabel(r, lang)}</span>
              ))}
            </div>
            <p className="rounded border border-border/60 p-2 text-xs">{(lang === 'en' ? data?.latestDecision?.reasonEn : data?.latestDecision?.reasonZh) ?? t.noDecision}</p>
            {data?.market && <Link className="text-sm text-primary underline" href={`/market/${data.market.marketSlug}?lang=${lang}`}>{t.detail}</Link>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t.allBins}</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">{t.bin}</th>
                <th className="text-left">{t.ask}</th>
                <th className="text-left">{t.noPrice}</th>
                <th className="text-left">{t.bid}</th>
                <th className="text-left">{t.spread}</th>
                <th className="text-left">{t.modelYes}</th>
                <th className="text-left">{t.modelNo}</th>
                <th className="text-left">{t.evYes}</th>
                <th className="text-left">{t.evNo}</th>
                <th className="text-left">{t.preferredSide}</th>
              </tr>
            </thead>
            <tbody>
              {allBins.map((o) => (
                <tr key={o.label} className="border-t border-border/60">
                  <td>{o.label}</td>
                  <td>{(o.marketPrice * 100).toFixed(1)}%</td>
                  <td>{(o.noMarketPrice * 100).toFixed(1)}%</td>
                  <td>{o.bestBid != null ? `${(o.bestBid * 100).toFixed(1)}%` : '-'}</td>
                  <td>{o.spread != null ? `${(o.spread * 100).toFixed(1)}%` : '-'}</td>
                  <td>{(o.modelProbability * 100).toFixed(1)}%</td>
                  <td>{(o.modelNoProbability * 100).toFixed(1)}%</td>
                  <td className={o.edgeYes >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.edgeYes.toFixed(3)}</td>
                  <td className={o.edgeNo >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{o.edgeNo.toFixed(3)}</td>
                  <td>{o.bestSide}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.snapshots}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {(data?.snapshots ?? []).slice(0, 8).map((s) => {
            const out = fromJsonString<{ decision?: string; tradeScore?: number; recommendedBin?: string }>(s.tradingOutputJson, {});
            return (
              <p key={s.id} className="rounded border border-border/60 px-2 py-1">
                {format(s.capturedAt, 'yyyy-MM-dd HH:mm')} | {decisionLabel(out.decision)} | {out.recommendedBin ?? '-'} | {t.score} {out.tradeScore?.toFixed?.(2) ?? '-'}
              </p>
            );
          })}
        </CardContent>
      </Card>
    </SiteShell>
  );
}
