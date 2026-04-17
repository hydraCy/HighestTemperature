import path from 'node:path';
import { readFile } from 'node:fs/promises';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function isObject(value: JsonValue): value is { [k: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareJson(a: JsonValue, b: JsonValue, tolerance: number, currentPath = '$'): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tolerance ? [] : [`${currentPath}: ${a} !== ${b}`];
  }

  if (typeof a !== typeof b) {
    return [`${currentPath}: type mismatch (${typeof a} vs ${typeof b})`];
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return [`${currentPath}: array length mismatch (${a.length} vs ${b.length})`];
    }
    return a.flatMap((item, idx) => compareJson(item, b[idx], tolerance, `${currentPath}[${idx}]`));
  }

  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const issues: string[] = [];
    for (const key of keys) {
      if (!(key in a)) issues.push(`${currentPath}.${key}: missing in current output`);
      else if (!(key in b)) issues.push(`${currentPath}.${key}: missing in golden output`);
      else issues.push(...compareJson(a[key], b[key], tolerance, `${currentPath}.${key}`));
    }
    return issues;
  }

  return a === b ? [] : [`${currentPath}: ${String(a)} !== ${String(b)}`];
}

async function main() {
  const tolerance = Number(process.env.GOLDEN_TOLERANCE ?? '1e-6');
  const goldenPath = path.resolve(process.cwd(), 'tmp/baseline/golden-backtest-output.json');
  const currentPath = path.resolve(process.cwd(), 'tmp/backtest-output.json');

  const [goldenRaw, currentRaw] = await Promise.all([readFile(goldenPath, 'utf8'), readFile(currentPath, 'utf8')]);
  const golden = JSON.parse(goldenRaw) as JsonValue;
  const current = JSON.parse(currentRaw) as JsonValue;

  const issues = compareJson(current, golden, tolerance);
  if (issues.length) {
    console.error(`Golden baseline check failed (${issues.length} diff(s)).`);
    for (const issue of issues.slice(0, 20)) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`Golden baseline check passed (tolerance=${tolerance}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
