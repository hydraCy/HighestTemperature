export function shanghaiDateKey(date: Date): string {
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

export function targetDayEndSettlementAt(targetDate: Date): Date {
  const key = shanghaiDateKey(targetDate);
  const dayEnd = new Date(`${key}T00:00:00+08:00`);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return dayEnd;
}
