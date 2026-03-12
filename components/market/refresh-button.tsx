'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function RefreshButton({ slug, lang = 'zh' }: { slug: string; lang?: 'zh' | 'en' }) {
  const [loading, setLoading] = useState(false);
  const t = lang === 'en' ? { loading: 'Refreshing...', idle: 'Refresh Market' } : { loading: '刷新中...', idle: '刷新该市场' };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await fetch(`/api/refresh/market/${slug}`, { method: 'POST' });
          window.location.reload();
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? t.loading : t.idle}
    </Button>
  );
}
