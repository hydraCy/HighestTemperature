export type ParsedBin = {
  raw: string;
  min: number | null;
  max: number | null;
};

export function parseTemperatureBin(label: string): ParsedBin {
  const normalized = label.replace(/°|c|C/g, '').trim();
  const between = normalized.match(/(-?\d+(?:\.\d+)?)\s*[-~]\s*(-?\d+(?:\.\d+)?)/);
  if (between) {
    return {
      raw: label,
      min: Number(between[1]),
      max: Number(between[2])
    };
  }

  const over = normalized.match(/(?:>=|>|above|over|\+)\s*(-?\d+(?:\.\d+)?)/i);
  if (over) {
    return {
      raw: label,
      min: Number(over[1]),
      max: null
    };
  }

  const under = normalized.match(/(?:<=|<|below|under)\s*(-?\d+(?:\.\d+)?)/i);
  if (under) {
    return {
      raw: label,
      min: null,
      max: Number(under[1])
    };
  }

  const single = normalized.match(/-?\d+(?:\.\d+)?/);
  if (single) {
    const n = Number(single[0]);
    return {
      raw: label,
      min: n,
      max: n + 1
    };
  }

  return { raw: label, min: null, max: null };
}

export function extractCityAndDate(input: string): { city: string | null; date: string | null } {
  const cityMatch = input.match(/highest temperature in\s+(.+?)\s+on/i);
  const dateMatch = input.match(/on\s+([a-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)/i);
  return {
    city: cityMatch?.[1]?.trim() ?? null,
    date: dateMatch?.[1]?.trim() ?? null
  };
}

export function extractResolutionStation(rulesText: string): string | null {
  const station = rulesText.match(/(?:station|airport|wunderground)[:\s-]+([A-Za-z0-9\-\s]+)/i);
  return station?.[1]?.trim() ?? null;
}
