import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import type { PrinterState } from '@teleforge/core';
import { usePrinterStatus } from '../usePrinterStatus';

const mockGetStatus = jest.fn<() => Promise<PrinterState>>();
const mockLanGetStatus = jest.fn<() => Promise<PrinterState>>();

jest.mock('@teleforge/core', () => ({
  OctoEverywhereClient: jest.fn().mockImplementation(() => ({ getStatus: mockGetStatus })),
  MoonrakerClient: jest.fn().mockImplementation(() => ({ getStatus: mockLanGetStatus })),
}));

const relay = (url: string) => ({ kind: 'relay' as const, url });

function sampleState(model: PrinterState['model'] = 'cc2'): PrinterState {
  return {
    model,
    connection: 'idle',
    isActive: false,
    extruders: [],
    lights: [],
    capabilities: {
      canPause: false,
      canResume: false,
      canCancel: false,
      canSetTemp: false,
      canSetLight: false,
      canMove: false,
      canHome: false,
      canStart: false,
    },
    lastUpdated: 0,
  };
}

beforeEach(() => {
  mockGetStatus.mockReset();
  mockLanGetStatus.mockReset();
});

describe('usePrinterStatus', () => {
  // A long interval keeps the scheduled re-poll out of the way; we only exercise
  // the immediate first poll and the manual refresh.
  const LONG = 10 ** 7;

  it('waits while the endpoint is unresolved', async () => {
    const { result } = await renderHook(() => usePrinterStatus(undefined, LONG));
    expect(result.current.state).toBeUndefined();
    expect(mockGetStatus).not.toHaveBeenCalled();
    expect(mockLanGetStatus).not.toHaveBeenCalled();
  });

  it('polls immediately on mount and exposes the state', async () => {
    mockGetStatus.mockResolvedValue(sampleState());
    const { result } = await renderHook(() => usePrinterStatus(relay('https://a.octoeverywhere.com'), LONG));

    await waitFor(() => expect(result.current.state).toBeDefined());
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeUndefined();
  });

  it('re-polls when refresh() is called', async () => {
    mockGetStatus.mockResolvedValue(sampleState());
    const { result } = await renderHook(() => usePrinterStatus(relay('https://b.octoeverywhere.com'), LONG));
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(1));

    await act(async () => result.current.refresh());
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(2));
  });

  it('surfaces an error when the poll fails', async () => {
    mockGetStatus.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => usePrinterStatus(relay('https://c.octoeverywhere.com'), LONG));

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
  });

  it('seeds the cached state on a later mount of the same URL', async () => {
    mockGetStatus.mockResolvedValue(sampleState('klipper'));
    const url = 'https://cached.octoeverywhere.com';

    const first = await renderHook(() => usePrinterStatus(relay(url), LONG));
    await waitFor(() => expect(first.result.current.state).toBeDefined());
    first.unmount();

    // The session cache lets the second mount render data without a round-trip.
    const second = await renderHook(() => usePrinterStatus(relay(url), LONG));
    expect(second.result.current.state?.model).toBe('klipper');
  });

  it('polls Moonraker directly on a LAN endpoint', async () => {
    mockLanGetStatus.mockResolvedValue(sampleState('klipper'));
    const { result } = await renderHook(() =>
      usePrinterStatus({ kind: 'lan', url: 'http://192.168.1.50' }, LONG),
    );

    await waitFor(() => expect(result.current.state?.model).toBe('klipper'));
    expect(mockLanGetStatus).toHaveBeenCalledTimes(1);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });
});
