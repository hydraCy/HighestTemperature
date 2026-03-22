'use client';

type LocationSelectorProps = {
  lang: 'zh' | 'en';
  locationKey: 'shanghai' | 'hongkong';
  pageDateKey: string;
};

export function LocationSelector({ lang, locationKey, pageDateKey }: LocationSelectorProps) {
  return (
    <select
      className="h-9 rounded border bg-background px-3 text-sm"
      value={locationKey}
      onChange={(e) => {
        const l = e.currentTarget.value === 'hongkong' ? 'hongkong' : 'shanghai';
        window.location.href = `/?lang=${lang}&l=${l}&d=${pageDateKey}`;
      }}
    >
      <option value="shanghai">{lang === 'en' ? 'Shanghai' : '上海'}</option>
      <option value="hongkong">{lang === 'en' ? 'Hong Kong' : '香港'}</option>
    </select>
  );
}
