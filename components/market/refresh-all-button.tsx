'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function RefreshAllButton({ lang = 'zh' }: { lang?: 'zh' | 'en' }) {
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
          await fetch('/api/refresh', { method: 'POST' });
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
