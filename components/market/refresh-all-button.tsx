'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function RefreshAllButton({
  lang = 'zh',
  targetDateKey,
  locationKey = 'shanghai'
}: {
  lang?: 'zh' | 'en';
  targetDateKey?: string;
  locationKey?: 'shanghai' | 'hongkong';
}) {
  const [loading, setLoading] = useState(false);
  const text = lang === 'en' ? { loading: 'Refreshing...', idle: 'Refresh Now' } : { loading: '刷新中...', idle: '立即刷新' };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const q = new URLSearchParams();
          if (targetDateKey) q.set('d', targetDateKey);
          if (locationKey) q.set('l', locationKey);
          const query = q.toString() ? `?${q.toString()}` : '';
          await fetch(`/api/refresh${query}`, { method: 'POST' });
          window.location.reload();
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? text.loading : text.idle}
    </Button>
  );
}
