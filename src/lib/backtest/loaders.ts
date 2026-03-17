import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  NormalizedSnapshotRow,
  SnapshotBucket,
  SnapshotRow,
  SnapshotTime,
  WeatherSourceName
} from '@/src/lib/backtest/types';

const SOURCE_FIELDS: WeatherSourceName[] = ['ecmwf', 'gfs', 'icon', 'wunderground', 'weatherAPI', 'metNo'];

function parseMaybeNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function mapSnapshotBucket(snapshotTime: string): SnapshotBucket {
  if (snapshotTime.startsWith('08')) return '08';
  if (snapshotTime.startsWith('11')) return '11';
  if (snapshotTime.startsWith('14')) return '14';
  return 'late';
}

function normalizeSnapshotTime(snapshotTime: string): SnapshotTime {
  if (snapshotTime.startsWith('08')) return '08:00';
  if (snapshotTime.startsWith('11')) return '11:00';
  if (snapshotTime.startsWith('14')) return '14:00';
  return '15:30';
}

export function parseSnapshotRowsFromJson(input: string): SnapshotRow[] {
  const raw = JSON.parse(input);
  if (!Array.isArray(raw)) return [];
  return raw as SnapshotRow[];
}

// Minimal CSV parser for flat rows without quoted commas.
export function parseSnapshotRowsFromCsv(input: string): SnapshotRow[] {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: SnapshotRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((c) => c.trim());
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i];
    });
    rows.push(obj as unknown as SnapshotRow);
  }
  return rows;
}

export async function loadSnapshotRowsFromFile(filePath: string): Promise<SnapshotRow[]> {
  const content = await readFile(filePath, 'utf-8');
  if (filePath.endsWith('.json')) return parseSnapshotRowsFromJson(content);
  if (filePath.endsWith('.csv')) return parseSnapshotRowsFromCsv(content);
  throw new Error(`Unsupported dataset extension: ${filePath}`);
}

export async function loadSnapshotRowsFromPath(inputPath: string): Promise<SnapshotRow[]> {
  const st = await stat(inputPath);
  if (st.isFile()) return loadSnapshotRowsFromFile(inputPath);
  if (!st.isDirectory()) throw new Error(`Unsupported path: ${inputPath}`);
  const files = (await readdir(inputPath))
    .map((f) => path.join(inputPath, f))
    .filter((f) => f.endsWith('.json') || f.endsWith('.csv'))
    .sort();
  const out: SnapshotRow[] = [];
  for (const f of files) {
    const rows = await loadSnapshotRowsFromFile(f);
    out.push(...rows);
  }
  return out;
}

export function normalizeSnapshotRows(rows: SnapshotRow[]): NormalizedSnapshotRow[] {
  const normalized: NormalizedSnapshotRow[] = [];
  for (const row of rows) {
    const finalMaxTemp = parseMaybeNumber(row.finalMaxTemp);
    if (finalMaxTemp == null) continue;
    const airport = String(row.airport ?? '').trim();
    const targetDate = String(row.targetDate ?? '').trim();
    const snapshotTimeRaw = String(row.snapshotTime ?? '').trim();
    if (!airport || !targetDate || !snapshotTimeRaw) continue;

    const sources: Partial<Record<WeatherSourceName, number>> = {};
    for (const key of SOURCE_FIELDS) {
      const v = parseMaybeNumber(row[key]);
      if (v != null) sources[key] = v;
    }
    if (Object.keys(sources).length === 0) continue;

    normalized.push({
      airport,
      targetDate,
      snapshotTime: normalizeSnapshotTime(snapshotTimeRaw),
      snapshotBucket: mapSnapshotBucket(row.snapshotBucket || snapshotTimeRaw),
      sources,
      observedMaxSoFar: parseMaybeNumber(row.observedMaxSoFar),
      currentTemp: parseMaybeNumber(row.currentTemp),
      cloudCover: parseMaybeNumber(row.cloudCover),
      windSpeed: parseMaybeNumber(row.windSpeed),
      rainProb: parseMaybeNumber(row.rainProb),
      finalMaxTemp
    });
  }
  return normalized.sort((a, b) => {
    const da = `${a.targetDate} ${a.snapshotTime}`;
    const db = `${b.targetDate} ${b.snapshotTime}`;
    return da.localeCompare(db);
  });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function deterministicJitter(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

export function expandBacktestRows(
  rows: NormalizedSnapshotRow[],
  replicateDays: number
): NormalizedSnapshotRow[] {
  if (replicateDays <= 1) return rows;
  const out: NormalizedSnapshotRow[] = [];
  for (let day = 0; day < replicateDays; day += 1) {
    for (let i = 0; i < rows.length; i += 1) {
      const base = rows[i]!;
      const seed = day * 1000 + i;
      const shift = deterministicJitter(seed) * 0.8;
      const sourceShift = deterministicJitter(seed + 11) * 0.5;
      const sources: NormalizedSnapshotRow['sources'] = {};
      for (const [k, v] of Object.entries(base.sources)) {
        if (typeof v === 'number') sources[k as WeatherSourceName] = v + sourceShift;
      }
      out.push({
        ...base,
        targetDate: addDays(base.targetDate, day),
        finalMaxTemp: base.finalMaxTemp + shift,
        observedMaxSoFar:
          typeof base.observedMaxSoFar === 'number'
            ? Math.max(0, base.observedMaxSoFar + shift * 0.6)
            : undefined,
        currentTemp:
          typeof base.currentTemp === 'number'
            ? base.currentTemp + shift * 0.5
            : undefined,
        sources
      });
    }
  }
  return out.sort((a, b) => {
    const ka = `${a.targetDate} ${a.snapshotTime}`;
    const kb = `${b.targetDate} ${b.snapshotTime}`;
    return ka.localeCompare(kb);
  });
}
