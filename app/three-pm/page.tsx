export const dynamic = 'force-dynamic';

import { format } from 'date-fns';
import { SiteShell } from '@/components/layout/site-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getDashboardData } from '@/lib/services/query';
import { fromJsonString } from '@/lib/utils/json';

type PageSearchParams = Promise<{ lang?: string | string[] }>;
type GateLevel = 'pass' | 'warn' | 'block';

function toShanghaiDateKey(date: Date) {
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
}

export default async function ThreePmPage({ searchParams }: { searchParams: PageSearchParams }) {
  const sp = await searchParams;
  const lang = (Array.isArray(sp?.lang) ? sp.lang[0] : sp?.lang) === 'en' ? 'en' : 'zh';
  const t = lang === 'en'
    ? {
        title: '3PM Scan',
        dateTags: 'Date Tags',
        gates: 'Strategy Gates',
        gate: 'Gate',
        status: 'Status',
        marketTarget: 'Market Target Date',
        weatherTarget: 'Weather Target Date',
        shanghaiToday: 'Shanghai Today',
        settlement: 'Settlement Time',
        decision: 'Decision',
        recBin: 'Recommended Bin',
        recSide: 'Recommended Side',
        edge: 'Edge',
        score: 'Trade Score',
        pass: 'PASS',
        warn: 'WARN',
        block: 'BLOCK',
        gateDate: 'Date Alignment',
        gateFresh: 'Weather Freshness',
        gateSources: 'Source Completeness',
        gateConsensus: 'Consensus Conflict',
        gateSecondEntry: 'Second Entry Guard',
        noData: 'No market data yet.'
      }
    : {
        title: '3PM 扫盘页',
        dateTags: '日期标签',
        gates: '策略门控状态',
        gate: '门控项',
        status: '状态',
        marketTarget: '市场目标日期',
        weatherTarget: '天气目标日期',
        shanghaiToday: '上海当前日期',
        settlement: '结算时间',
        decision: '决策',
        recBin: '推荐 Bin',
        recSide: '推荐方向',
        edge: 'Edge',
        score: '交易评分',
        pass: '通过',
        warn: '告警',
        block: '阻断',
        gateDate: '日期一致性',
        gateFresh: '天气新鲜度',
        gateSources: '数据源完整性',
        gateConsensus: '主共识冲突',
        gateSecondEntry: '二次入场保护',
        noData: '暂无市场数据。'
      };

  const data = await getDashboardData();
  if (!data) {
    return (
      <SiteShell currentPath="/three-pm" lang={lang}>
        <Card><CardContent className="p-4 text-sm">{t.noData}</CardContent></Card>
      </SiteShell>
    );
  }

  const weatherRaw = fromJsonString<{ raw?: { targetDate?: string; fetchedAtIso?: string; nowcasting?: { observedAt?: string }; strictReady?: boolean } }>(
    data.latestWeather?.rawJson,
    {}
  );
  const weatherTargetDate = weatherRaw.raw?.targetDate ?? null;
  const weatherFetchedAt = weatherRaw.raw?.fetchedAtIso ?? null;
  const weatherObservedAt = weatherRaw.raw?.nowcasting?.observedAt ?? null;
  const strictReady = weatherRaw.raw?.strictReady ?? false;
  const weatherFreshnessMinutes = (() => {
    const base = weatherFetchedAt ?? weatherObservedAt;
    if (!base) return null;
    const ts = new Date(base).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((Date.now() - ts) / 60000));
  })();
  const staleLimit = Number(process.env.WEATHER_STALE_MINUTES ?? '15');
  const isWeatherStale = weatherFreshnessMinutes != null && weatherFreshnessMinutes > staleLimit;
  const marketTargetDate = format(data.market.targetDate, 'yyyy-MM-dd');
  const isDateAligned = !weatherTargetDate || weatherTargetDate === marketTargetDate;
  const riskSet = new Set(data.latestDecision?.riskFlags ?? []);

  const gateRank: Record<GateLevel, number> = { pass: 0, warn: 1, block: 2 };
  const gate = (name: string, level: GateLevel) => ({ name, level });
  const gates = [
    gate(t.gateDate, isDateAligned ? 'pass' : 'block'),
    gate(t.gateFresh, isWeatherStale ? 'block' : 'pass'),
    gate(t.gateSources, strictReady ? 'pass' : 'block'),
    gate(t.gateConsensus, riskSet.has('market_consensus_conflict') ? 'warn' : 'pass'),
    gate(t.gateSecondEntry, riskSet.has('second_entry_guard') ? 'warn' : 'pass')
  ].sort((a, b) => gateRank[b.level] - gateRank[a.level]);

  const levelLabel = (l: GateLevel) => (l === 'block' ? t.block : l === 'warn' ? t.warn : t.pass);
  const levelVariant = (l: GateLevel): 'destructive' | 'warning' | 'success' =>
    l === 'block' ? 'destructive' : l === 'warn' ? 'warning' : 'success';

  return (
    <SiteShell currentPath="/three-pm" lang={lang}>
      <h1 className="text-xl font-semibold">{t.title}</h1>

      <Card>
        <CardHeader><CardTitle>{t.dateTags}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-4">
          <p>{t.marketTarget}: {marketTargetDate}</p>
          <p>{t.weatherTarget}: {weatherTargetDate ?? '-'}</p>
          <p>{t.shanghaiToday}: {toShanghaiDateKey(new Date())}</p>
          <p>{t.settlement}: {data.marketStatus?.settlementAt ? format(data.marketStatus.settlementAt, 'yyyy-MM-dd HH:mm') : '-'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.gates}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {gates.map((g) => (
            <p key={g.name} className="flex items-center justify-between rounded border border-border/50 px-2 py-1 text-sm">
              <span>{g.name}</span>
              <Badge variant={levelVariant(g.level)}>{levelLabel(g.level)}</Badge>
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t.decision}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>{t.decision}: {data.latestDecision?.decision ?? '-'}</p>
          <p>{t.recBin}: {data.latestDecision?.recommendedBin ?? '-'}</p>
          <p>{t.recSide}: {data.latestDecision?.recommendedSide ?? '-'}</p>
          <p>{t.edge}: {data.latestDecision?.edge?.toFixed(3) ?? '-'}</p>
          <p>{t.score}: {data.latestDecision?.tradeScore?.toFixed(2) ?? '-'}</p>
        </CardContent>
      </Card>
    </SiteShell>
  );
}
