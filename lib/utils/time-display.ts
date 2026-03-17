export type TimeMode = 'shanghai' | 'local';

function two(n: number) {
  return String(n).padStart(2, '0');
}

export function parseTimeMode(input: string | string[] | undefined): TimeMode {
  const raw = Array.isArray(input) ? input[0] : input;
  return raw === 'local' ? 'local' : 'shanghai';
}

export function dateKeyByMode(date: Date, mode: TimeMode): string {
  if (mode === 'shanghai') {
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
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function formatDateByMode(date: Date | null | undefined, mode: TimeMode): string {
  if (!date) return '-';
  return dateKeyByMode(date, mode);
}

export function formatDateTimeByMode(date: Date | null | undefined, mode: TimeMode): string {
  if (!date) return '-';
  if (mode === 'shanghai') {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const m = parts.find((p) => p.type === 'month')?.value ?? '00';
    const d = parts.find((p) => p.type === 'day')?.value ?? '00';
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const min = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${y}-${m}-${d} ${h}:${min}`;
  }
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function timeModeTagText(mode: TimeMode, lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    return mode === 'shanghai'
      ? 'Time Label: Shanghai Time (UTC+8) | Settlement rule: target-day end (24:00 Shanghai)'
      : 'Time Label: Local Time | Settlement rule: target-day end (24:00 Shanghai)';
  }
  return mode === 'shanghai'
    ? '时间标签：上海时间（UTC+8）| 结算口径：目标日结束（上海时间24:00）'
    : '时间标签：本地时间 | 结算口径：目标日结束（上海时间24:00）';
}
