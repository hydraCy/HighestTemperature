'use client';

type DateSelectorProps = {
  lang: 'zh' | 'en';
  locationKey: 'shanghai' | 'hongkong';
  selectedDateKey: string;
  todayKey: string;
  tomorrowKey: string;
  basePath?: '/' | '/three-pm';
  label: string;
};

export function DateSelector({
  lang,
  locationKey,
  selectedDateKey,
  todayKey,
  tomorrowKey,
  basePath = '/',
  label
}: DateSelectorProps) {
  const value = selectedDateKey === tomorrowKey ? tomorrowKey : todayKey;
  const zhToday = `今天（${todayKey}）`;
  const zhTomorrow = `明天（${tomorrowKey}）`;
  const enToday = `Today (${todayKey})`;
  const enTomorrow = `Tomorrow (${tomorrowKey})`;

  return (
    <div className="inline-flex items-center overflow-hidden rounded border border-border text-xs">
      <span className="px-2 py-1 text-muted-foreground">{label}</span>
      <select
        className="border-l border-border bg-background px-2 py-1 text-xs"
        value={value}
        onChange={(e) => {
          const d = e.currentTarget.value;
          window.location.href = `${basePath}?lang=${lang}&l=${locationKey}&d=${d}`;
        }}
      >
        <option value={todayKey}>{lang === 'en' ? enToday : zhToday}</option>
        <option value={tomorrowKey}>{lang === 'en' ? enTomorrow : zhTomorrow}</option>
      </select>
    </div>
  );
}
