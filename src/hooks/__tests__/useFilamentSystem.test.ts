import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { RawCanvasResult } from '@teleforge/core';
import { useFilamentSystem } from '../useFilamentSystem';

const mockGetCanvasInfo = jest.fn<() => Promise<RawCanvasResult | null>>();

// Keep the real mapCanvas; only stub the network client.
jest.mock('@teleforge/core', () => ({
  ...jest.requireActual<typeof import('@teleforge/core')>('@teleforge/core'),
  OctoEverywhereClient: jest.fn().mockImplementation(() => ({ getCanvasInfo: mockGetCanvasInfo })),
}));

const CANVAS: RawCanvasResult = {
  error_code: 0,
  canvas_info: {
    active_canvas_id: 0,
    active_tray_id: 1,
    auto_refill: true,
    canvas_list: [
      {
        canvas_id: 0,
        connected: 1,
        tray_list: [
          { tray_id: 0, filament_type: 'PLA', filament_color: '#000000', status: 1 },
          { tray_id: 1, filament_type: 'PETG', filament_color: '#106DD7', status: 2 },
        ],
      },
    ],
  },
};

beforeEach(() => {
  mockGetCanvasInfo.mockReset();
});

describe('useFilamentSystem', () => {
  const LONG = 10 ** 7;

  it('does not fetch when disabled (non-CC2)', async () => {
    mockGetCanvasInfo.mockResolvedValue(CANVAS);
    const { result } = await renderHook(() => useFilamentSystem('https://u1.octoeverywhere.com', false, LONG));
    expect(result.current).toBeUndefined();
    expect(mockGetCanvasInfo).not.toHaveBeenCalled();
  });

  it('maps the combo trays when enabled', async () => {
    mockGetCanvasInfo.mockResolvedValue(CANVAS);
    const { result } = await renderHook(() => useFilamentSystem('https://cc2.octoeverywhere.com', true, LONG));

    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.activeTrayId).toBe(1);
    expect(result.current?.units[0].trays).toHaveLength(2);
    expect(result.current?.units[0].trays[1]).toMatchObject({ trayId: 1, active: true });
  });
});
