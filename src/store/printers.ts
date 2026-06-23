import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// expo-secure-store has no web implementation, so fall back to localStorage on
// web (dev/testing). On native the secret stays in the OS secure store.
const secureStorage = {
  getItem: (key: string): Promise<string | null> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
      : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web'
      ? Promise.resolve(globalThis.localStorage?.setItem(key, value))
      : SecureStore.setItemAsync(key, value),
};

/**
 * A configured printer. `baseUrl` is the OctoEverywhere Shared Connection URL —
 * it carries the connection secret in its subdomain, so it's stored in the
 * device secure store, never plain storage.
 */
export interface PrinterConfig {
  id: string;
  name: string;
  baseUrl: string;
}

const STORAGE_KEY = 'teleforge.printers.v1';

interface PrintersState {
  printers: PrinterConfig[];
  hydrated: boolean;
  /** Load persisted printers from secure storage. Call once on app start. */
  hydrate: () => Promise<void>;
  addPrinter: (input: Omit<PrinterConfig, 'id'>) => Promise<PrinterConfig>;
  updatePrinter: (id: string, patch: Partial<Omit<PrinterConfig, 'id'>>) => Promise<void>;
  removePrinter: (id: string) => Promise<void>;
  getPrinter: (id: string) => PrinterConfig | undefined;
}

function newId(): string {
  // Good enough for local ids; not security-sensitive.
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(printers: PrinterConfig[]): Promise<void> {
  await secureStorage.setItem(STORAGE_KEY, JSON.stringify(printers));
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const usePrintersStore = create<PrintersState>((set, get) => ({
  printers: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await secureStorage.getItem(STORAGE_KEY);
      const printers = raw ? (JSON.parse(raw) as PrinterConfig[]) : [];
      set({ printers, hydrated: true });
    } catch {
      // Corrupt/missing store: start empty rather than crash.
      set({ printers: [], hydrated: true });
    }
  },

  addPrinter: async (input) => {
    const printer: PrinterConfig = {
      id: newId(),
      name: input.name.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
    };
    const printers = [...get().printers, printer];
    set({ printers });
    await persist(printers);
    return printer;
  },

  updatePrinter: async (id, patch) => {
    const printers = get().printers.map((p) =>
      p.id === id
        ? {
            ...p,
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            ...(patch.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(patch.baseUrl) } : {}),
          }
        : p,
    );
    set({ printers });
    await persist(printers);
  },

  removePrinter: async (id) => {
    const printers = get().printers.filter((p) => p.id !== id);
    set({ printers });
    await persist(printers);
  },

  getPrinter: (id) => get().printers.find((p) => p.id === id),
}));
