import { useCallback } from 'react';
import { useSettingsStore } from '../store/settings';
import { resolveLocale, translate, type Locale, type TranslationKey } from './index';

export interface Translator {
  /** Translate a key, optionally filling `{placeholder}`s. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** The resolved active locale (after applying the 'system' preference). */
  locale: Locale;
}

/** Hook into the active locale and a memoized translate function. */
export function useTranslation(): Translator {
  const pref = useSettingsStore((s) => s.locale);
  const locale = resolveLocale(pref);
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );
  return { t, locale };
}
