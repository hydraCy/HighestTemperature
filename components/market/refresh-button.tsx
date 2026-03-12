'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function RefreshButton({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(false);

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
      {loading ? '刷新中...' : '刷新该市场'}
    </Button>
  );
}
