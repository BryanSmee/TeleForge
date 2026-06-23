import { describe, it, expect } from '@jest/globals';
import { mapCanvas } from '../mapCanvas';
import type { RawCanvasResult } from '../raw';

// A trimmed copy of a real CC2 method-2005 reply (see spike/probe-cc2-canvas).
const sample: RawCanvasResult = {
  error_code: 0,
  canvas_info: {
    active_canvas_id: 0,
    active_tray_id: 2,
    auto_refill: true,
    canvas_list: [
      {
        canvas_id: 0,
        connected: 1,
        tray_list: [
          { tray_id: 0, brand: 'ELEGOO', filament_color: '#000000', filament_name: 'PLA', filament_type: 'PLA', min_nozzle_temp: 190, max_nozzle_temp: 230, status: 1 },
          { tray_id: 1, brand: 'ELEGOO', filament_color: '#106DD7', filament_name: 'PLA', filament_type: 'PLA', min_nozzle_temp: 190, max_nozzle_temp: 230, status: 1 },
          { tray_id: 2, brand: 'ELEGOO', filament_color: '#FFFFFF', filament_name: 'PLA', filament_type: 'PLA', min_nozzle_temp: 190, max_nozzle_temp: 230, status: 2 },
          { tray_id: 3, brand: 'ELEGOO', filament_color: '#747C7E', filament_name: 'PLA', filament_type: 'PLA', min_nozzle_temp: 190, max_nozzle_temp: 230, status: 1 },
        ],
      },
    ],
  },
};

describe('mapCanvas', () => {
  it('maps the four trays with colors, materials and temps', () => {
    const cfs = mapCanvas(sample)!;
    expect(cfs.autoRefill).toBe(true);
    expect(cfs.activeTrayId).toBe(2);
    expect(cfs.units).toHaveLength(1);
    expect(cfs.units[0].connected).toBe(true);

    const trays = cfs.units[0].trays;
    expect(trays).toHaveLength(4);
    expect(trays[1]).toMatchObject({
      trayId: 1,
      brand: 'ELEGOO',
      minTempC: 190,
      maxTempC: 230,
      active: false,
      present: true,
      filament: { material: 'PLA', colorHex: '#106DD7' },
    });
  });

  it('marks the loaded slot (status 2 / active_tray_id) active', () => {
    const cfs = mapCanvas(sample)!;
    const active = cfs.units[0].trays.filter((t) => t.active);
    expect(active.map((t) => t.trayId)).toEqual([2]);
  });

  it('treats active_tray_id -1 as nothing loaded', () => {
    const cfs = mapCanvas({
      canvas_info: { ...sample.canvas_info!, active_tray_id: -1, canvas_list: [{ canvas_id: 0, connected: 1, tray_list: [{ tray_id: 0, filament_type: 'PLA', filament_color: '#000', status: 1 }] }] },
    })!;
    expect(cfs.activeTrayId).toBeUndefined();
    expect(cfs.units[0].trays.every((t) => !t.active)).toBe(true);
  });

  it('omits a separate name when it just repeats the material', () => {
    const cfs = mapCanvas(sample)!;
    expect(cfs.units[0].trays[0].filament.name).toBeUndefined();
  });

  it('returns undefined when there is no combo unit', () => {
    expect(mapCanvas(null)).toBeUndefined();
    expect(mapCanvas({ error_code: 0 })).toBeUndefined();
    expect(mapCanvas({ canvas_info: { active_canvas_id: 0, active_tray_id: -1, auto_refill: false, canvas_list: [] } })).toBeUndefined();
  });
});
