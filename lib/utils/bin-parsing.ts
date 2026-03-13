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

  const over = normalized.match(/(>=|>|above|over|\+)\s*(-?\d+(?:\.\d+)?)/i);
  if (over) {
    const op = over[1];
    const base = Number(over[2]);
    return {
      raw: label,
      min: op === '>' ? base + 0.5 : base - 0.5,
      max: null
    };
  }

  const under = normalized.match(/(<=|<|below|under)\s*(-?\d+(?:\.\d+)?)/i);
  if (under) {
    const op = under[1];
    const base = Number(under[2]);
    return {
      raw: label,
      min: null,
      max: op === '<' ? base - 0.5 : base + 0.5
    };
  }

  const single = normalized.match(/-?\d+(?:\.\d+)?/);
  if (single) {
    const n = Number(single[0]);
    return {
      raw: label,
      min: n - 0.5,
      max: n + 0.5
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
