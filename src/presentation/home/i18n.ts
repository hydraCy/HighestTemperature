export type UiLang = 'zh' | 'en';

export function resolveUiLang(lang: string | string[] | undefined): UiLang {
  const value = Array.isArray(lang) ? lang[0] : lang;
  return value === 'en' ? 'en' : 'zh';
}
