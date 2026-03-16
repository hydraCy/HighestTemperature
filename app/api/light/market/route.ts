import { NextResponse } from 'next/server';

type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  outcomes?: string;
  outcomePrices?: string;
};

function shanghaiDatePlus(days: number): string {
  const now = new Date();
  const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shanghaiNow.setDate(shanghaiNow.getDate() + days);
  const y = shanghaiNow.getFullYear();
  const m = String(shanghaiNow.getMonth() + 1).padStart(2, '0');
  const d = String(shanghaiNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toSlugDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const month = dt.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  return `${month}-${d}-${y}`;
}

function parseOutcomes(market: GammaMarket) {
  try {
    const labels = JSON.parse(market.outcomes ?? '[]') as string[];
    const prices = JSON.parse(market.outcomePrices ?? '[]') as Array<string | number>;
    return labels.map((label, i) => ({
      label,
      price: Number(prices[i] ?? 0)
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const base = process.env.POLYMARKET_API_BASE ?? 'https://gamma-api.polymarket.com';
  const dateKey = shanghaiDatePlus(1);
  const slugDate = toSlugDate(dateKey);
  const candidateSlugs = [
    process.env.POLYMARKET_EVENT_SLUG,
    `highest-temperature-in-shanghai-on-${slugDate}`
  ].filter(Boolean) as string[];

  const errors: string[] = [];

  for (const eventSlug of candidateSlugs) {
    const url = `${base}/events/slug/${eventSlug}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        errors.push(`${url} -> ${res.status}`);
        continue;
      }
      const event = (await res.json()) as { title?: string; slug?: string; markets?: GammaMarket[] };
      const market = (event.markets ?? []).find((m) => (m.question ?? '').toLowerCase().includes('highest temperature'));
      if (!market) {
        errors.push(`${url} -> no market`);
        continue;
      }
      return NextResponse.json({
        ok: true,
        source: 'polymarket_gamma',
        targetDate: dateKey,
        event: { title: event.title ?? null, slug: event.slug ?? null },
        market: {
          id: market.id ?? null,
          slug: market.slug ?? null,
          question: market.question ?? null,
          active: Boolean(market.active),
          closed: Boolean(market.closed),
          volume: market.volume ?? null,
          outcomes: parseOutcomes(market)
        }
      });
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : 'fetch failed'}`);
    }
  }

  try {
    const url = `${base}/markets?limit=500&active=true`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return NextResponse.json({ ok: false, source: 'polymarket_gamma', errors: [...errors, `${url} -> ${res.status}`] }, { status: 502 });
    }
    const list = (await res.json()) as GammaMarket[];
    const market = list.find((m) => {
      const q = (m.question ?? '').toLowerCase();
      return q.includes('highest temperature in shanghai') && (q.includes('march') || q.includes('apr') || q.includes('may'));
    });
    if (!market) {
      return NextResponse.json({ ok: false, source: 'polymarket_gamma', errors: [...errors, 'fallback markets search -> not found'] }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      source: 'polymarket_gamma',
      targetDate: dateKey,
      market: {
        id: market.id ?? null,
        slug: market.slug ?? null,
        question: market.question ?? null,
        active: Boolean(market.active),
        closed: Boolean(market.closed),
        volume: market.volume ?? null,
        outcomes: parseOutcomes(market)
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: 'polymarket_gamma',
        errors: [...errors, `fallback markets search -> ${error instanceof Error ? error.message : 'fetch failed'}`]
      },
      { status: 502 }
    );
  }
}
