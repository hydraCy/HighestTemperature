'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

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
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const t = useMemo(
    () =>
      lang === 'en'
        ? {
            title: 'Market Live Sync',
            marketLast: 'Last Market Update',
            weatherLast: 'Last Weather Update',
            stale: 'Stale',
            fresh: 'Fresh',
            start: 'Start Auto Sync',
            stop: 'Stop Auto Sync',
            syncing: 'Syncing...',
            synced: 'Last Sync',
            err: 'sync failed'
          }
        : {
            title: '盘口实时同步',
            marketLast: '盘口最后更新时间',
            weatherLast: '天气最后更新时间',
            stale: '过期',
            fresh: '正常',
            start: '开启自动同步',
            stop: '关闭自动同步',
            syncing: '同步中...',
            synced: '最近同步',
            err: '同步失败'
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

  async function postJob(job: 'market' | 'weather' | 'model') {
    const res = await fetch('/api/jobs/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job })
    });
    if (!res.ok) {
      let reason = `${res.status}`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) reason = data.message;
      } catch {}
      throw new Error(`${job} ${reason}`);
    }
  }

  const doSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await postJob('market');
      await postJob('weather');
      await postJob('model');
      setLastSyncAt(new Date().toISOString());
      router.refresh();
    } catch {
      setLastSyncAt(t.err);
    } finally {
      setSyncing(false);
    }
  }, [router, syncing, t.err]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void doSync();
    }, 45_000);
    return () => clearInterval(id);
  }, [doSync, running]);

  return (
    <div className="rounded border border-border/60 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{t.title}</p>
          <p className="text-muted-foreground">{t.marketLast}: {hydrated ? fmt(marketUpdatedAt) : '-'}</p>
          <p className="text-muted-foreground">{t.weatherLast}: {hydrated ? fmt(weatherUpdatedAt) : '-'}</p>
          <p className={stale ? 'text-amber-300' : 'text-emerald-400'}>{hydrated ? (stale ? t.stale : t.fresh) : '-'}</p>
          <p className="text-muted-foreground">{t.synced}: {hydrated ? (lastSyncAt ? (lastSyncAt === t.err ? t.err : fmt(lastSyncAt)) : '-') : '-'}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRunning((v) => !v)}
          disabled={syncing}
        >
          {syncing ? t.syncing : running ? t.stop : t.start}
        </Button>
      </div>
    </div>
  );
}
