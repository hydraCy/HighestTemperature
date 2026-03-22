import { z } from 'zod';
import { fetchJsonWithCurlFallback } from '@/lib/utils/http-json';
import { parseTemperatureBin } from '@/lib/utils/bin-parsing';
import { getLocationConfig, type SupportedLocationKey } from '@/lib/config/locations';
import { fetchShanghaiMarket, type ShanghaiMarketPayload } from '@/lib/services/polymarket';

const eventSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  resolutionSource: z.string().optional(),
  endDate: z.string().optional(),
  volume: z.coerce.number().optional(),
  markets: z.array(z.object({
    question: z.string().optional(),
    outcomes: z.union([z.array(z.string()), z.string()]).optional(),
    outcomePrices: z.union([z.array(z.string()), z.string()]).optional(),
    bestBid: z.coerce.number().optional(),
    bestAsk: z.coerce.number().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    archived: z.boolean().optional()
  })).optional(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional()
});

function parseStringArray(input: unknown) {
  if (Array.isArray(input)) return input.map(String);
  if (typeof input !== 'string') return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(input: unknown) {
  return parseStringArray(input).map(Number).filter(Number.isFinite);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function normalizeLabel(question: string) {
  const text = question.replace(/\s+/g, ' ').trim();
  const p = parseTemperatureBin(text);
  if (p.min != null && p.max != null && p.max - p.min === 1) return `${p.min}°C`;
  if (p.min != null && p.max != null) return `${p.min}-${p.max}°C`;
  if (p.min != null) return `>=${p.min}°C`;
  if (p.max != null) return `<=${p.max}°C`;
  const m = text.match(/(\d+(?:\.\d+)?)\s*°?\s*c?/i);
  return m ? `${m[1]}°C` : text;
}

function toDateKeyUtc8(date: Date) {
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

function buildAutoSlugs(eventPrefix: string, date: Date) {
  const monthLong = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'long' }).format(date).toLowerCase();
  const monthShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'short' }).format(date).toLowerCase();
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', day: 'numeric' }).format(date);
  const year = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date);
  return [`${eventPrefix}${monthLong}-${day}-${year}`, `${eventPrefix}${monthShort}-${day}-${year}`];
}

function parseDateKey(input?: string | null) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = new Date(`${input}T12:00:00+08:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildFromEvent(event: z.infer<typeof eventSchema>, fallbackSlug: string, cityName: string): ShanghaiMarketPayload | null {
  const bins = (event.markets ?? [])
    .map((m) => {
      const outcomes = parseStringArray(m.outcomes);
      const prices = parseNumberArray(m.outcomePrices);
      if (!outcomes.length || outcomes.length !== prices.length) return null;
      const yesIdx = outcomes.findIndex((o) => /^yes$/i.test(o.trim()));
      const idx = yesIdx >= 0 ? yesIdx : 0;
      const question = m.question ?? '';
      return {
        label: normalizeLabel(question),
        price: clamp01(prices[idx] ?? 0),
        noPrice: clamp01(1 - clamp01(prices[idx] ?? 0)),
        bestBid: typeof m.bestBid === 'number' ? clamp01(m.bestBid) : undefined,
        bestAsk: typeof m.bestAsk === 'number' ? clamp01(m.bestAsk) : undefined,
        spread: typeof m.bestBid === 'number' && typeof m.bestAsk === 'number'
          ? Math.max(0, clamp01(m.bestAsk) - clamp01(m.bestBid))
          : undefined,
        isActive: m.active ?? true,
        isClosed: Boolean(m.closed || m.archived)
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!bins.length) return null;
  const sorted = bins
    .sort((a, b) => (parseTemperatureBin(a.label).min ?? -999) - (parseTemperatureBin(b.label).min ?? -999))
    .map((b, i) => ({ ...b, index: i }));
  const hasTradable = sorted.some((b) => b.isActive && !b.isClosed);
  return {
    eventId: String(event.id ?? `event_${fallbackSlug}`),
    marketSlug: event.slug ?? fallbackSlug,
    marketTitle: event.title ?? `Highest temperature in ${cityName}`,
    rulesText: event.description ?? event.resolutionSource ?? '',
    volume: event.volume ?? 0,
    targetDate: event.endDate ? new Date(event.endDate) : new Date(),
    isActive: (event.active ?? true) && !Boolean(event.closed || event.archived) && hasTradable,
    isClosed: Boolean(event.closed || event.archived) || !hasTradable,
    bins: sorted.map((b) => ({
      label: b.label,
      index: b.index,
      price: b.price,
      noPrice: b.noPrice,
      bestBid: b.bestBid,
      bestAsk: b.bestAsk,
      spread: b.spread
    }))
  };
}

export async function fetchMarketByLocation(
  options?: { locationKey?: SupportedLocationKey; targetDateKey?: string | null }
): Promise<{ data: ShanghaiMarketPayload; source: 'api' }> {
  const locationKey = options?.locationKey ?? 'shanghai';
  if (locationKey === 'shanghai') {
    return fetchShanghaiMarket({ targetDateKey: options?.targetDateKey ?? null });
  }

  const cfg = getLocationConfig(locationKey);
  const base = process.env.POLYMARKET_API_BASE ?? 'https://gamma-api.polymarket.com';
  const timeoutMs = Number(process.env.POLYMARKET_TIMEOUT_MS ?? '12000');
  const requested = parseDateKey(options?.targetDateKey ?? null) ?? new Date();
  const slugs = buildAutoSlugs(cfg.market.eventPrefix, requested);
  const candidates: ShanghaiMarketPayload[] = [];
  const errors: string[] = [];

  for (const slug of slugs) {
    const url = `${base}/events/slug/${encodeURIComponent(slug)}`;
    try {
      const json = await fetchJsonWithCurlFallback(url, timeoutMs);
      const parsed = eventSchema.safeParse(json);
      if (!parsed.success) {
        errors.push(`${slug}: schema mismatch`);
        continue;
      }
      const payload = buildFromEvent(parsed.data, slug, cfg.nameEn);
      if (payload) candidates.push(payload);
    } catch (e) {
      errors.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!candidates.length) {
    throw new Error(`Polymarket ${cfg.nameEn} market fetch failed: ${errors.join(' | ')}`);
  }

  const targetKey = toDateKeyUtc8(requested);
  const chosen = candidates
    .sort((a, b) => {
      const aKey = toDateKeyUtc8(a.targetDate);
      const bKey = toDateKeyUtc8(b.targetDate);
      const aScore = (aKey === targetKey ? 100 : 0) + (a.isActive ? 20 : 0) + a.bins.length;
      const bScore = (bKey === targetKey ? 100 : 0) + (b.isActive ? 20 : 0) + b.bins.length;
      return bScore - aScore;
    })[0];
  return { source: 'api', data: chosen };
}

