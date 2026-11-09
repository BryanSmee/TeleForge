import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useEndpoint } from '../useEndpoint';

type Probe = (printer: { lanUrl?: string; lanAccessCode?: string }) => Promise<'moonraker' | 'cc2' | undefined>;
const mockProbe = jest.fn<Probe>();

jest.mock('../../lib/endpoint', () => ({
  probeLan: (printer: { lanUrl?: string }) => mockProbe(printer),
}));

const RELAY = 'https://shared-u1.octoeverywhere.com';
// A long recheck keeps the periodic re-probe out of the way; tests trigger it via recheck().
const LONG = { recheckMs: 10 ** 7 };

beforeEach(() => {
  mockProbe.mockReset();
});

describe('useEndpoint', () => {
  it('uses the relay immediately when no LAN URL is set', async () => {
    const { result } = await renderHook(() => useEndpoint({ baseUrl: RELAY }, LONG));
    expect(result.current.endpoint).toEqual({ kind: 'relay', url: RELAY });
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it('is unresolved without a printer', async () => {
    const { result } = await renderHook(() => useEndpoint(undefined, LONG));
    expect(result.current.endpoint).toBeUndefined();
  });

  it('uses the LAN URL when Moonraker answers there', async () => {
    mockProbe.mockResolvedValue('moonraker');
    const lanUrl = 'http://192.168.1.50';
    const { result } = await renderHook(() => useEndpoint({ baseUrl: RELAY, lanUrl }, LONG));

    await waitFor(() =>
      expect(result.current.endpoint).toEqual({ kind: 'lan', url: lanUrl, protocol: 'moonraker' }),
    );
    expect(mockProbe).toHaveBeenCalledWith(expect.objectContaining({ lanUrl }));
  });

  it('uses the LAN URL when the CC2 answers there over MQTT, with its access code', async () => {
    mockProbe.mockResolvedValue('cc2');
    const lanUrl = 'http://192.168.1.240';
    const { result } = await renderHook(() =>
      useEndpoint({ baseUrl: RELAY, lanUrl, lanAccessCode: '4242' }, LONG),
    );

    await waitFor(() => expect(result.current.endpoint).toEqual({ kind: 'lan', url: lanUrl, protocol: 'cc2' }));
    expect(mockProbe).toHaveBeenCalledWith({ baseUrl: RELAY, lanUrl, lanAccessCode: '4242' });
  });

  it('falls back to the relay when the LAN URL does not answer', async () => {
    mockProbe.mockResolvedValue(undefined);
    const { result } = await renderHook(() =>
      useEndpoint({ baseUrl: RELAY, lanUrl: 'http://192.168.1.51' }, LONG),
    );
    await waitFor(() => expect(result.current.endpoint).toEqual({ kind: 'relay', url: RELAY }));
  });

  it('switches back to the relay on recheck after leaving the LAN', async () => {
    mockProbe.mockResolvedValueOnce('moonraker').mockResolvedValue(undefined);
    const lanUrl = 'http://192.168.1.52';
    const { result } = await renderHook(() => useEndpoint({ baseUrl: RELAY, lanUrl }, LONG));
    await waitFor(() => expect(result.current.endpoint?.kind).toBe('lan'));

    await act(async () => result.current.recheck());
    await waitFor(() => expect(result.current.endpoint).toEqual({ kind: 'relay', url: RELAY }));
  });

  it('re-probes on its own after recheckMs', async () => {
    mockProbe.mockResolvedValueOnce(undefined).mockResolvedValue('moonraker');
    const lanUrl = 'http://192.168.1.53';
    const { result } = await renderHook(() =>
      useEndpoint({ baseUrl: RELAY, lanUrl }, { recheckMs: 10 }),
    );
    await waitFor(() => expect(result.current.endpoint?.kind).toBe('lan'));
    expect(mockProbe.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves instantly from the last probe on a later mount', async () => {
    mockProbe.mockResolvedValue('moonraker');
    const lanUrl = 'http://192.168.1.54';
    const first = await renderHook(() => useEndpoint({ baseUrl: RELAY, lanUrl }, LONG));
    await waitFor(() => expect(first.result.current.endpoint?.kind).toBe('lan'));
    first.unmount();

    mockProbe.mockImplementation(() => new Promise(() => {})); // never settles
    const second = await renderHook(() => useEndpoint({ baseUrl: RELAY, lanUrl }, LONG));
    expect(second.result.current.endpoint).toEqual({ kind: 'lan', url: lanUrl, protocol: 'moonraker' });
  });
});
