import { en, type TranslationKey } from './locales/en';
import { fr } from './locales/fr';

export type { TranslationKey };

/** Locales with a full translation. English is the fallback. */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** User preference: an explicit locale, or follow the device. */
export type LocalePref = 'system' | Locale;

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en, fr };

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Best-effort device language via the Intl API (Hermes ships it; no extra dep). */
export function detectDeviceLocale(): Locale {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
    const lang = tag.split('-')[0].toLowerCase();
    return isLocale(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

export function resolveLocale(pref: LocalePref): Locale {
  return pref === 'system' ? detectDeviceLocale() : pref;
}

/** Translate a key, filling `{placeholder}`s and falling back to English then the key. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = DICTS[locale]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}
