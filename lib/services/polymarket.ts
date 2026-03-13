import { z } from 'zod';
import { fetchJsonWithCurlFallback } from '@/lib/utils/http-json';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';

const marketSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string(),
  title: z.string().optional(),
  question: z.string().optional(),
  rules: z.string().optional(),
  description: z.string().optional(),
  volume: z.coerce.number().optional(),
  endDate: z.string().optional(),
  outcomes: z.union([z.array(z.string()), z.string()]).optional(),
  outcomePrices: z.union([z.array(z.string()), z.string()]).optional(),
  bestBid: z.coerce.number().optional(),
  bestAsk: z.coerce.number().optional(),
  resolutionSource: z.string().optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional()
});

const eventSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  resolutionSource: z.string().optional(),
  endDate: z.string().optional(),
  volume: z.coerce.number().optional(),
  markets: z.array(marketSchema).optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional()
});

export type ShanghaiMarketPayload = {
  eventId: string;
  marketSlug: string;
  marketTitle: string;
  rulesText: string;
  volume: number;
  targetDate: Date;
  isActive: boolean;
  isClosed: boolean;
  bins: { label: string; index: number; price: number; noPrice?: number; bestBid?: number; bestAsk?: number; spread?: number }[];
};

export async function fetchShanghaiMarket(): Promise<{ data: ShanghaiMarketPayload; source: 'api' }> {
  const base = process.env.POLYMARKET_API_BASE ?? 'https://gamma-api.polymarket.com';
  const timeoutMs = Number(process.env.POLYMARKET_TIMEOUT_MS ?? '12000');
  const manualEventSlug = process.env.POLYMARKET_EVENT_SLUG?.trim() || null;
  const today = todayInShanghai();
  const tomorrow = addDaysInShanghai(today, 1);
  const todayKey = toDateKeyShanghai(today);
  const tomorrowKey = toDateKeyShanghai(tomorrow);
  const rolloverWindowMinutes = Number(process.env.MARKET_ROLLOVER_WINDOW_MINUTES ?? '240');
  const now = new Date();
  const autoTodaySlugs = buildAutoEventSlugs(today);
  const autoTomorrowSlugs = buildAutoEventSlugs(tomorrow);
  const preferredSlugs = [...new Set([...(manualEventSlug ? [manualEventSlug] : []), ...autoTodaySlugs, ...autoTomorrowSlugs])];
  const urls = [
    ...preferredSlugs.map((slug) => `${base}/events/slug/${encodeURIComponent(slug)}`),
    `${base}/events?limit=400&active=true`,
    `${base}/markets?limit=1200&active=true`,
    `${base}/events?limit=400`,
    `${base}/markets?limit=1200`
  ];

  try {
    const errors: string[] = [];
    let best: { payload: ShanghaiMarketPayload; score: number } | null = null;
    let manualMatch: ShanghaiMarketPayload | null = null;
    for (const url of urls) {
      try {
        const json = await fetchJsonWithCurlFallback(url, timeoutMs);
        const candidates = buildPayloadCandidatesFromApi(json, { fallbackSlug: manualEventSlug ?? autoTodaySlugs[0] ?? null });
        if (manualEventSlug) {
          const exact = candidates.find((c) => c.marketSlug === manualEventSlug);
          if (exact) manualMatch = exact;
        }
        if (candidates.length) {
          const candidate = pickByTradingDayPriority(candidates, {
            todayKey,
            tomorrowKey,
            manualEventSlug,
            now,
            rolloverWindowMinutes
          });
          const score = scorePayload(candidate, { todayKey, tomorrowKey, manualEventSlug });
          if (!best || score > best.score) best = { payload: candidate, score };
          continue;
        }
        errors.push(`${url} -> 未找到上海最高温盘口`);
      } catch (err) {
        errors.push(`${url} -> ${formatFetchError(err)}`);
      }
    }

    if (manualMatch) {
      return { source: 'api', data: manualMatch };
    }

    if (!best) {
      throw new Error(errors.join(' | '));
    }
    return { source: 'api', data: best.payload };
  } catch (error) {
    throw new Error(`Polymarket 实时数据获取失败：${formatFetchError(error)}`);
  }
}

function buildPayloadCandidatesFromApi(
  json: unknown,
  opts: { fallbackSlug: string | null }
): ShanghaiMarketPayload[] {
  const candidates: ShanghaiMarketPayload[] = [];

  const byEvent = tryBuildFromSingleEvent(json, opts.fallbackSlug ?? 'shanghai-auto');
  if (byEvent && isShanghaiTempPayload(byEvent)) candidates.push(byEvent);

  const events = parseEvents(json);
  for (const event of events) {
    if (!isShanghaiTempEvent(event)) continue;
    const payload = buildFromEvent(event, opts.fallbackSlug ?? 'shanghai-auto');
    if (payload?.bins.length) candidates.push(payload);
  }

  const allMarkets = extractLooseMarkets(json);
  const binaries = allMarkets
    .map(toBinaryBin)
    .filter((x): x is NonNullable<ReturnType<typeof toBinaryBin>> => Boolean(x))
    .filter((x) => isShanghaiTempText(`${x.question} ${x.slug}`));
  const scopedBinaries =
    opts.fallbackSlug && opts.fallbackSlug.startsWith('highest-temperature-in-shanghai-on-')
      ? binaries.filter((x) => x.slug.includes(opts.fallbackSlug ?? ''))
      : binaries;
  if (scopedBinaries.length) {
    const bins = sortAndIndex(
      scopedBinaries.map((x) => ({
        label: x.label,
        price: x.price,
        noPrice: x.noPrice,
        bestBid: x.bestBid,
        bestAsk: x.bestAsk,
        spread: x.spread
      }))
    );
    const todayKey = toDateKeyShanghai(todayInShanghai());
    const bestDate = pickBestDate(scopedBinaries.map((x) => x.endDate).filter((x): x is Date => x instanceof Date), todayKey);
    candidates.push({
      eventId: `event_${opts.fallbackSlug ?? 'shanghai-auto'}`,
      marketSlug: opts.fallbackSlug ?? `highest-temperature-in-shanghai-on-${todayKey}`,
      marketTitle: `Highest temperature in Shanghai`,
      rulesText: '',
      volume: 0,
      targetDate: bestDate ?? new Date(),
      isActive: true,
      isClosed: false,
      bins
    });
  }

  return candidates;
}

function parseStringOrArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input !== 'string') return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(input: unknown): number[] {
  const arr = parseStringOrArray(input);
  return arr.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

function tryBuildFromSingleEvent(json: unknown, eventSlug: string) {
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return null;
  return buildFromEvent(parsed.data, eventSlug);
}

function parseEvents(json: unknown): z.infer<typeof eventSchema>[] {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  return events.map((e) => eventSchema.safeParse(e)).filter((x) => x.success).map((x) => x.data);
}

function buildFromEvent(event: z.infer<typeof eventSchema>, fallbackSlug: string): ShanghaiMarketPayload | null {
  const binaries = (event.markets ?? []).map(toBinaryBin).filter((x): x is NonNullable<ReturnType<typeof toBinaryBin>> => Boolean(x));
  if (!binaries.length) return null;
  const hasTradableBinary = binaries.some((x) => x.isActive && !x.isClosed);
  const eventClosed = Boolean(event.closed || event.archived);
  const eventActive = event.active ?? true;
  return {
    eventId: String(event.id ?? `event_${fallbackSlug}`),
    marketSlug: event.slug ?? fallbackSlug,
    marketTitle: event.title ?? 'Highest temperature in Shanghai',
    rulesText: event.description ?? event.resolutionSource ?? '',
    volume: event.volume ?? 0,
    targetDate: event.endDate ? new Date(event.endDate) : new Date(),
    isActive: eventActive && !eventClosed && hasTradableBinary,
    isClosed: eventClosed || !hasTradableBinary,
    bins: sortAndIndex(
      binaries.map((x) => ({
        label: x.label,
        price: x.price,
        noPrice: x.noPrice,
        bestBid: x.bestBid,
        bestAsk: x.bestAsk,
        spread: x.spread
      }))
    )
  };
}

function extractLooseMarkets(json: unknown): z.infer<typeof marketSchema>[] {
  if (Array.isArray(json)) {
    return json.map((x) => marketSchema.safeParse(x)).filter((x) => x.success).map((x) => x.data);
  }
  const markets = (json as { markets?: unknown[] })?.markets;
  if (!Array.isArray(markets)) return [];
  return markets.map((x) => marketSchema.safeParse(x)).filter((x) => x.success).map((x) => x.data);
}

function toBinaryBin(market: z.infer<typeof marketSchema>) {
  const outcomes = parseStringOrArray(market.outcomes);
  const prices = parseNumberArray(market.outcomePrices);
  if (!outcomes.length || !prices.length || outcomes.length !== prices.length) return null;
  const yesIndex = outcomes.findIndex((x) => /^yes$/i.test(String(x).trim()));
  const idx = yesIndex >= 0 ? yesIndex : 0;
  const noIndex = outcomes.findIndex((x) => /^no$/i.test(String(x).trim()));
  const price = prices[idx];
  if (!Number.isFinite(price)) return null;
  const noMid = noIndex >= 0 ? prices[noIndex] : undefined;
  const bestBid = clampOptional01(market.bestBid);
  const bestAsk = clampOptional01(market.bestAsk);
  const executableYesPrice = bestAsk ?? clamp01(price);
  const executableNoPrice = clampOptional01(noMid) ?? (bestBid != null ? clamp01(1 - bestBid) : clamp01(1 - executableYesPrice));
  const question = market.question ?? market.title ?? market.slug;
  return {
    label: extractBinLabel(question),
    price: executableYesPrice,
    noPrice: executableNoPrice,
    bestBid,
    bestAsk,
    spread: bestBid != null && bestAsk != null ? Math.max(0, bestAsk - bestBid) : undefined,
    isActive: market.active ?? true,
    isClosed: Boolean(market.closed || market.archived),
    endDate: market.endDate ? new Date(market.endDate) : null,
    question,
    slug: market.slug
  };
}

function extractBinLabel(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  const range = text.match(/be\s+(\d+(?:\.\d+)?)\s*°?\s*c?\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*°?\s*c?/i);
  if (range) return `${range[1]}-${range[2]}°C`;

  const below = text.match(/be\s+(\d+(?:\.\d+)?)\s*°?\s*c?\s*(?:or below|or less|or under)/i);
  if (below) return `<=${below[1]}°C`;

  const above = text.match(/be\s+(\d+(?:\.\d+)?)\s*°?\s*c?\s*(?:or above|or higher|or more)/i);
  if (above) return `>=${above[1]}°C`;

  const exact = text.match(/be\s+(\d+(?:\.\d+)?)\s*°?\s*c?/i);
  if (exact) return `${exact[1]}°C`;

  const first = text.match(/(\d+(?:\.\d+)?)\s*°?\s*c?/i);
  if (first) return `${first[1]}°C`;
  return text;
}

function sortAndIndex(bins: { label: string; price: number; noPrice?: number; bestBid?: number; bestAsk?: number; spread?: number }[]) {
  const dedup = new Map<string, { price: number; noPrice?: number; bestBid?: number; bestAsk?: number; spread?: number }>();
  for (const b of bins) dedup.set(b.label, { price: b.price, noPrice: b.noPrice, bestBid: b.bestBid, bestAsk: b.bestAsk, spread: b.spread });
  return [...dedup.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => {
      const pa = parseTemperatureBin(a.label);
      const pb = parseTemperatureBin(b.label);
      const av = pa.min ?? (pa.max != null ? pa.max - 100 : Number.MAX_SAFE_INTEGER);
      const bv = pb.min ?? (pb.max != null ? pb.max - 100 : Number.MAX_SAFE_INTEGER);
      if (av !== bv) return av - bv;
      const aMax = pa.max ?? Number.MAX_SAFE_INTEGER;
      const bMax = pb.max ?? Number.MAX_SAFE_INTEGER;
      return aMax - bMax;
    })
    .map((b, index) => ({ label: b.label, index, price: b.price, noPrice: b.noPrice, bestBid: b.bestBid, bestAsk: b.bestAsk, spread: b.spread }));
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function clampOptional01(x: number | undefined) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
  return clamp01(x);
}

function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = error.cause as
    | { code?: string; errno?: number | string; syscall?: string; address?: string; port?: number }
    | undefined;
  const causePart = cause
    ? ` cause(code=${cause.code ?? '-'}, errno=${cause.errno ?? '-'}, syscall=${cause.syscall ?? '-'}, address=${cause.address ?? '-'}, port=${cause.port ?? '-'})`
    : '';
  return `${error.message}${causePart}`;
}

function isShanghaiTempText(text: string) {
  const t = text.toLowerCase();
  const hasShanghai = t.includes('shanghai') || text.includes('上海');
  const hasHighestTemp =
    t.includes('highest temperature') ||
    t.includes('highest-temperature') ||
    t.includes('temperature in shanghai') ||
    t.includes('最高温');
  return hasShanghai && hasHighestTemp;
}

function isShanghaiTempEvent(event: z.infer<typeof eventSchema>) {
  const text = `${event.slug ?? ''} ${event.title ?? ''} ${event.description ?? ''}`;
  return isShanghaiTempText(text);
}

function isShanghaiTempPayload(payload: ShanghaiMarketPayload) {
  return isShanghaiTempText(`${payload.marketSlug} ${payload.marketTitle} ${payload.rulesText}`);
}

function scorePayload(
  payload: ShanghaiMarketPayload,
  opts: { todayKey: string; tomorrowKey: string; manualEventSlug: string | null }
) {
  const payloadKey = toDateKeyShanghai(payload.targetDate);
  let score = 0;
  if (payload.bins.length > 0) score += 10;
  if (payload.isActive) score += 20;
  if (payloadKey === opts.todayKey && payload.isActive && !payload.isClosed) score += 300;
  else if (payloadKey === opts.todayKey) score += 120;
  else if (payloadKey === opts.tomorrowKey && payload.isActive && !payload.isClosed) score += 220;
  else if (payloadKey === opts.tomorrowKey) score += 80;
  if (opts.manualEventSlug && payload.marketSlug === opts.manualEventSlug) score += 8;
  if (isShanghaiTempPayload(payload)) score += 20;
  if (payloadKey < opts.todayKey) score -= 80;
  return score;
}

function toDateKeyShanghai(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

function pickBestDate(dates: Date[], targetDateKey: string) {
  const valid = dates.filter((d) => d instanceof Date && Number.isFinite(d.getTime()));
  if (!valid.length) return null;
  const exact = valid.find((d) => toDateKeyShanghai(d) === targetDateKey);
  if (exact) return exact;
  const targetMid = new Date(`${targetDateKey}T12:00:00+08:00`).getTime();
  return [...valid].sort((a, b) => Math.abs(a.getTime() - targetMid) - Math.abs(b.getTime() - targetMid))[0];
}

function tomorrowInShanghai() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  local.setDate(local.getDate() + 1);
  return local;
}

function todayInShanghai() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

function addDaysInShanghai(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function pickByTradingDayPriority(
  candidates: ShanghaiMarketPayload[],
  opts: {
    todayKey: string;
    tomorrowKey: string;
    manualEventSlug: string | null;
    now: Date;
    rolloverWindowMinutes: number;
  }
) {
  const isTodayInSettlementWindow = (c: ShanghaiMarketPayload) => {
    const key = toDateKeyShanghai(c.targetDate);
    if (key !== opts.todayKey) return false;
    const minutesToSettlement = Math.floor((c.targetDate.getTime() - opts.now.getTime()) / 60000);
    return c.isClosed || !c.isActive || minutesToSettlement <= opts.rolloverWindowMinutes;
  };
  const hasTodayInSettlementWindow = candidates.some((c) => isTodayInSettlementWindow(c));

  if (opts.manualEventSlug) {
    const manual = candidates.find((c) => c.marketSlug === opts.manualEventSlug);
    if (manual && !isTodayInSettlementWindow(manual)) return manual;
  }

  const todayTradable = candidates.filter(
    (c) =>
      toDateKeyShanghai(c.targetDate) === opts.todayKey &&
      c.isActive &&
      !c.isClosed &&
      !isTodayInSettlementWindow(c) &&
      c.bins.length > 0
  );
  if (todayTradable.length) {
    return [...todayTradable].sort((a, b) => scorePayload(b, opts) - scorePayload(a, opts))[0];
  }

  const tomorrowTradable = candidates.filter((c) => toDateKeyShanghai(c.targetDate) === opts.tomorrowKey && c.isActive && !c.isClosed && c.bins.length > 0);
  if (tomorrowTradable.length) {
    return [...tomorrowTradable].sort((a, b) => scorePayload(b, opts) - scorePayload(a, opts))[0];
  }

  if (hasTodayInSettlementWindow) {
    const tomorrowAny = candidates.filter((c) => toDateKeyShanghai(c.targetDate) === opts.tomorrowKey && c.bins.length > 0);
    if (tomorrowAny.length) {
      return [...tomorrowAny].sort((a, b) => scorePayload(b, opts) - scorePayload(a, opts))[0];
    }
  }

  return [...candidates].sort((a, b) => scorePayload(b, opts) - scorePayload(a, opts))[0];
}

function buildAutoEventSlugs(date: Date) {
  const monthLong = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'long' }).format(date).toLowerCase();
  const monthShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'short' }).format(date).toLowerCase();
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', day: 'numeric' }).format(date);
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date);
  return [
    `highest-temperature-in-shanghai-on-${monthLong}-${day}-${year}`,
    `highest-temperature-in-shanghai-on-${monthShort}-${day}-${year}`
  ];
}
