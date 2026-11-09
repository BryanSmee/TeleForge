import { create } from 'zustand';
import { secureStorage } from './storage';

/**
 * A configured printer. `baseUrl` is the OctoEverywhere Shared Connection URL —
 * it carries the connection secret in its subdomain, so it's stored in the
 * device secure store, never plain storage.
 */
export interface PrinterConfig {
  id: string;
  name: string;
  baseUrl: string;
  /**
   * Optional direct address on the local network (e.g. `http://192.168.1.50`),
   * used instead of the relay when it answers — see `useEndpoint`.
   */
  lanUrl?: string;
  /**
   * The CC2's access code, when one is set on the printer (its MQTT password on
   * the LAN; without one the default is used).
   */
  lanAccessCode?: string;
}

const STORAGE_KEY = 'teleforge.printers.v1';

interface PrintersState {
  printers: PrinterConfig[];
  hydrated: boolean;
  /** Load persisted printers from secure storage. Call once on app start. */
  hydrate: () => Promise<void>;
  addPrinter: (input: Omit<PrinterConfig, 'id'>) => Promise<PrinterConfig>;
  /** Patch a printer. An empty `lanUrl` or `lanAccessCode` clears it. */
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

/** Normalize an optional URL; blank means "not set". */
function normalizeOptionalUrl(url: string | undefined): string | undefined {
  const normalized = url === undefined ? '' : normalizeBaseUrl(url);
  return normalized || undefined;
}

/** Drop an unset `lanUrl` key so persisted configs stay as they were without one. */
function withLanUrl(p: PrinterConfig, lanUrl: string | undefined): PrinterConfig {
  const { lanUrl: _old, ...rest } = p;
  return lanUrl ? { ...rest, lanUrl } : rest;
}

/** Same for the access code (trimmed; blank means "not set"). */
function withLanAccessCode(p: PrinterConfig, code: string | undefined): PrinterConfig {
  const { lanAccessCode: _old, ...rest } = p;
  const trimmed = code?.trim();
  return trimmed ? { ...rest, lanAccessCode: trimmed } : rest;
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
    const printer = withLanAccessCode(
      withLanUrl(
        { id: newId(), name: input.name.trim(), baseUrl: normalizeBaseUrl(input.baseUrl) },
        normalizeOptionalUrl(input.lanUrl),
      ),
      input.lanAccessCode,
    );
    const printers = [...get().printers, printer];
    set({ printers });
    await persist(printers);
    return printer;
  },

  updatePrinter: async (id, patch) => {
    const printers = get().printers.map((p) => {
      if (p.id !== id) return p;
      const next = {
        ...p,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(patch.baseUrl) } : {}),
      };
      const withUrl = 'lanUrl' in patch ? withLanUrl(next, normalizeOptionalUrl(patch.lanUrl)) : next;
      return 'lanAccessCode' in patch ? withLanAccessCode(withUrl, patch.lanAccessCode) : withUrl;
    });
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
