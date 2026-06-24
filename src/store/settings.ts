import { create } from 'zustand';
import { secureStorage } from './storage';
import type { LocalePref } from '../i18n';

const STORAGE_KEY = 'teleforge.settings.v1';

interface SettingsState {
  /** Language preference; 'system' follows the device locale. */
  locale: LocalePref;
  hydrated: boolean;
  /** Load persisted settings. Call once on app start. */
  hydrate: () => Promise<void>;
  setLocale: (locale: LocalePref) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  locale: 'system',
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await secureStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<SettingsState>) : {};
      set({ locale: parsed.locale ?? 'system', hydrated: true });
    } catch {
      set({ locale: 'system', hydrated: true });
    }
  },

  setLocale: async (locale) => {
    set({ locale });
    await secureStorage.setItem(STORAGE_KEY, JSON.stringify({ locale }));
  },
}));
