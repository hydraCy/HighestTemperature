'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefreshTrigger({
  intervalMs = 5 * 60 * 1000,
  targetDateKey
}: {
  intervalMs?: number;
  targetDateKey?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const runRefresh = async () => {
      try {
        const query = targetDateKey ? `?d=${encodeURIComponent(targetDateKey)}` : '';
        const resp = await fetch(`/api/refresh${query}`, { method: 'POST' });
        if (!resp.ok) return;
        if (!cancelled) router.refresh();
      } catch {
        // keep silent and non-blocking
      }
    };

    void runRefresh();
    const id = setInterval(() => void runRefresh(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, router, targetDateKey]);

  return null;
}
