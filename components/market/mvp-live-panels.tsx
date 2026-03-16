'use client';

import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? data?.message ?? `HTTP ${res.status}`);
  return data;
};

export function MvpLivePanels({ lang }: { lang: 'zh' | 'en' }) {
  const { data: market, error: marketError, isLoading: marketLoading } = useSWR('/api/light/market', fetcher, {
    refreshInterval: 60_000
  });
  const { data: weather, error: weatherError, isLoading: weatherLoading } = useSWR('/api/light/weather', fetcher, {
    refreshInterval: 60_000
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{lang === 'en' ? 'Live Market (Read-only)' : '实时盘口（只读）'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {marketLoading ? <p>{lang === 'en' ? 'Loading...' : '加载中...'}</p> : null}
          {marketError ? <p className="text-rose-400">{String(marketError.message ?? marketError)}</p> : null}
          {market?.ok ? (
            <>
              <p>{lang === 'en' ? 'Question' : '问题'}: {market.market?.question ?? '-'}</p>
              <p>{lang === 'en' ? 'Slug' : 'Slug'}: {market.market?.slug ?? '-'}</p>
              <p>{lang === 'en' ? 'Target Date' : '目标日期'}: {market.targetDate ?? '-'}</p>
              <div className="space-y-1">
                {(market.market?.outcomes ?? []).slice(0, 8).map((o: { label: string; price: number }) => (
                  <p key={o.label}>{o.label}: {(Number(o.price) * 100).toFixed(1)}%</p>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{lang === 'en' ? 'Live Weather (Read-only)' : '实时天气（只读）'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {weatherLoading ? <p>{lang === 'en' ? 'Loading...' : '加载中...'}</p> : null}
          {weatherError ? <p className="text-rose-400">{String(weatherError.message ?? weatherError)}</p> : null}
          {weather?.ok ? (
            <>
              <p>
                {lang === 'en' ? 'Now Temp' : '当前温度'}: {weather.now?.temp ?? '-'}°C
              </p>
              <p>
                {lang === 'en' ? 'Tomorrow Max (source)' : '次日最高温（来源）'}: {weather.tomorrowMax ?? '-'}°C
              </p>
              <div className="space-y-1">
                {(weather.next6h ?? []).slice(0, 6).map((h: { time: string; temp: number }) => (
                  <p key={h.time}>{h.time.slice(11, 16)}: {h.temp}°C</p>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
