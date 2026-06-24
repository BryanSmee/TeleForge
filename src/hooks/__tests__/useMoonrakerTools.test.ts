import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { MoonrakerTools } from '@teleforge/core';
import { useMoonrakerTools } from '../useMoonrakerTools';

const mockGetTools = jest.fn<() => Promise<MoonrakerTools>>();

jest.mock('@teleforge/core', () => ({
  MoonrakerClient: jest.fn().mockImplementation(() => ({ getTools: mockGetTools })),
}));

const TOOLS: MoonrakerTools = {
  extruders: [{ index: 0, label: 'Nozzle', actual: 25, target: 0, settable: true, active: true }],
  fans: [{ key: 'fan', label: 'Part cooling', speedPct: 0, settable: true }],
};

beforeEach(() => {
  mockGetTools.mockReset();
});

describe('useMoonrakerTools', () => {
  const LONG = 10 ** 7;

  it('does not fetch when disabled', async () => {
    mockGetTools.mockResolvedValue(TOOLS);
    const { result } = await renderHook(() => useMoonrakerTools('https://u1.octoeverywhere.com', false, LONG));
    expect(result.current).toBeUndefined();
    expect(mockGetTools).not.toHaveBeenCalled();
  });

  it('fetches and returns tools when enabled', async () => {
    mockGetTools.mockResolvedValue(TOOLS);
    const { result } = await renderHook(() => useMoonrakerTools('https://u1b.octoeverywhere.com', true, LONG));

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.extruders).toHaveLength(1);
    expect(mockGetTools).toHaveBeenCalledTimes(1);
  });

  it('seeds cached tools on a later mount of the same URL', async () => {
    mockGetTools.mockResolvedValue(TOOLS);
    const url = 'https://u1cache.octoeverywhere.com';

    const first = await renderHook(() => useMoonrakerTools(url, true, LONG));
    await waitFor(() => expect(first.result.current).toBeDefined());
    first.unmount();

    const second = await renderHook(() => useMoonrakerTools(url, true, LONG));
    expect(second.result.current?.fans[0].key).toBe('fan');
  });
});
