'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function LiveMarketPoller({ lang = 'zh', lastUpdatedAt }: { lang?: Lang; lastUpdatedAt?: string | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const t = useMemo(
    () =>
      lang === 'en'
        ? {
            title: 'Market Live Sync',
            last: 'Last Market Update',
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
            last: '盘口最后更新时间',
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

  const stale = useMemo(() => {
    if (!lastUpdatedAt) return true;
    const ms = Date.now() - new Date(lastUpdatedAt).getTime();
    return !Number.isFinite(ms) || ms > 3 * 60 * 1000;
  }, [lastUpdatedAt]);

  async function doSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: 'market' }) });
      await fetch('/api/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: 'model' }) });
      setLastSyncAt(new Date().toISOString());
      router.refresh();
    } catch {
      setLastSyncAt(t.err);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void doSync();
    }, 45_000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="rounded border border-border/60 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{t.title}</p>
          <p className="text-muted-foreground">{t.last}: {fmt(lastUpdatedAt)}</p>
          <p className={stale ? 'text-amber-300' : 'text-emerald-400'}>{stale ? t.stale : t.fresh}</p>
          <p className="text-muted-foreground">{t.synced}: {lastSyncAt ? (lastSyncAt === t.err ? t.err : fmt(lastSyncAt)) : '-'}</p>
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
