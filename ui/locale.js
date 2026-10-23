// Shared by the local service and browser: the ten languages the app can display.
export const SUPPORTED_LOCALES = ['en', 'ko', 'ja', 'zh-Hant', 'ru', 'de', 'fr', 'es', 'pt-BR', 'th'];

export function matchLocale(languages) {
  for (const language of languages) {
    if (typeof language !== 'string') continue;
    const tag = language.replace(/_/g, '-').toLowerCase();
    if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(tag)) return 'zh-Hant';
    if (/^pt(?:-|$)/.test(tag)) return 'pt-BR';
    const base = tag.split('-')[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return 'en';
}

export const resolveLocale = (preference, system) => SUPPORTED_LOCALES.includes(preference) ? preference : matchLocale([system]);
