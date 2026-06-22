import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { usePrintersStore } from '../printers';

// In-memory mock of expo-secure-store. The variable must be `mock`-prefixed for
// jest to allow referencing it inside the hoisted mock factory.
const mockMem = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockMem.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockMem.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockMem.delete(k);
  }),
}));

const STORAGE_KEY = 'teleforge.printers.v1';

beforeEach(() => {
  mockMem.clear();
  usePrintersStore.setState({ printers: [], hydrated: false });
});

describe('printers store', () => {
  it('adds a printer, normalizing name and URL, and persists it', async () => {
    const p = await usePrintersStore.getState().addPrinter({
      name: '  CC2  ',
      baseUrl: 'https://shared-abc.octoeverywhere.com/',
    });

    expect(p.name).toBe('CC2');
    expect(p.baseUrl).toBe('https://shared-abc.octoeverywhere.com'); // trailing slash trimmed
    expect(p.id).toMatch(/^p_/);
    expect(usePrintersStore.getState().printers).toHaveLength(1);

    // Persisted to (mock) secure store.
    expect(JSON.parse(mockMem.get(STORAGE_KEY)!)).toHaveLength(1);
  });

  it('hydrates from secure storage', async () => {
    mockMem.set(
      STORAGE_KEY,
      JSON.stringify([{ id: 'p_x', name: 'U1', baseUrl: 'https://shared-u1.octoeverywhere.com' }]),
    );

    await usePrintersStore.getState().hydrate();
    const { printers, hydrated } = usePrintersStore.getState();

    expect(hydrated).toBe(true);
    expect(printers).toHaveLength(1);
    expect(printers[0].name).toBe('U1');
  });

  it('hydrates to empty on corrupt storage rather than throwing', async () => {
    mockMem.set(STORAGE_KEY, 'not json');
    await usePrintersStore.getState().hydrate();
    expect(usePrintersStore.getState().printers).toEqual([]);
    expect(usePrintersStore.getState().hydrated).toBe(true);
  });

  it('removes a printer and persists the change', async () => {
    const a = await usePrintersStore.getState().addPrinter({ name: 'A', baseUrl: 'https://a.octoeverywhere.com' });
    await usePrintersStore.getState().addPrinter({ name: 'B', baseUrl: 'https://b.octoeverywhere.com' });

    await usePrintersStore.getState().removePrinter(a.id);

    const { printers } = usePrintersStore.getState();
    expect(printers.map((p) => p.name)).toEqual(['B']);
    expect(JSON.parse(mockMem.get(STORAGE_KEY)!)).toHaveLength(1);
  });
});
