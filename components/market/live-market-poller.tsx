'use client';

import { useEffect, useMemo, useState } from 'react';

type Lang = 'zh' | 'en';

function fmt(ts?: string | null) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${mi}:${s}`;
}

export function LiveMarketPoller({
  lang = 'zh',
  marketUpdatedAt,
  weatherUpdatedAt
}: {
  lang?: Lang;
  marketUpdatedAt?: string | null;
  weatherUpdatedAt?: string | null;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const cronHint = process.env.NEXT_PUBLIC_SYNC_SCHEDULE ?? 'open-page refresh + every 5m';

  const t = useMemo(
    () =>
      lang === 'en'
        ? {
            title: 'Data Sync Status',
            marketLast: 'Last Market Update',
            weatherLast: 'Last Weather Update',
            stale: 'Stale',
            fresh: 'Fresh',
            mode: 'Sync Mode',
            modeValue: 'Local Auto Refresh',
            schedule: 'Schedule'
          }
        : {
            title: '数据同步状态',
            marketLast: '盘口最后更新时间',
            weatherLast: '天气最后更新时间',
            stale: '过期',
            fresh: '正常',
            mode: '同步方式',
            modeValue: '本地自动刷新',
            schedule: '调度周期'
          },
    [lang]
  );

  useEffect(() => {
    setHydrated(true);
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const marketStale = useMemo(() => {
    if (!hydrated || nowMs == null) return false;
    if (!marketUpdatedAt) return true;
    const ms = nowMs - new Date(marketUpdatedAt).getTime();
    return !Number.isFinite(ms) || ms > 3 * 60 * 1000;
  }, [hydrated, marketUpdatedAt, nowMs]);
  const weatherStale = useMemo(() => {
    if (!hydrated || nowMs == null) return false;
    if (!weatherUpdatedAt) return true;
    const ms = nowMs - new Date(weatherUpdatedAt).getTime();
    return !Number.isFinite(ms) || ms > 15 * 60 * 1000;
  }, [hydrated, nowMs, weatherUpdatedAt]);
  const stale = marketStale || weatherStale;

  return (
    <div className="rounded border border-border/60 px-3 py-2 text-xs">
      <div className="space-y-1">
        <p className="font-medium">{t.title}</p>
        <p className="text-muted-foreground">{t.marketLast}: {hydrated ? fmt(marketUpdatedAt) : '-'}</p>
        <p className="text-muted-foreground">{t.weatherLast}: {hydrated ? fmt(weatherUpdatedAt) : '-'}</p>
        <p className={stale ? 'text-amber-300' : 'text-emerald-400'}>{hydrated ? (stale ? t.stale : t.fresh) : '-'}</p>
        <p className="text-muted-foreground">{t.mode}: {t.modeValue}</p>
        <p className="text-muted-foreground">{t.schedule}: {cronHint}</p>
      </div>
    </div>
  );
}
