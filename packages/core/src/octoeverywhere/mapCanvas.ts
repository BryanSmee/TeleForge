import type { FilamentSystem } from '../model/printer';
import type { RawCanvasResult } from './raw';

/**
 * Map the CC2's raw `canvas_info` (MQTT method 2005) onto the normalized
 * `FilamentSystem`. Returns undefined when there's no combo unit attached, so
 * callers can simply hide the filament UI.
 */
export function mapCanvas(raw: RawCanvasResult | null | undefined): FilamentSystem | undefined {
  const info = raw?.canvas_info;
  if (!info || !Array.isArray(info.canvas_list) || info.canvas_list.length === 0) {
    return undefined;
  }

  const activeTrayId = typeof info.active_tray_id === 'number' ? info.active_tray_id : -1;

  const units = info.canvas_list.map((unit) => ({
    unitId: unit.canvas_id,
    connected: unit.connected === 1,
    trays: (unit.tray_list ?? []).map((t) => ({
      trayId: t.tray_id,
      brand: t.brand || undefined,
      minTempC: t.min_nozzle_temp,
      maxTempC: t.max_nozzle_temp,
      // The active slot reports status 2; active_tray_id agrees. Use either.
      active: t.status === 2 || (activeTrayId >= 0 && t.tray_id === activeTrayId),
      present: t.status !== 0,
      filament: {
        material: t.filament_type || t.filament_name || undefined,
        colorHex: t.filament_color || undefined,
        // Only keep a separate name when it adds something over the material.
        name: t.filament_name && t.filament_name !== t.filament_type ? t.filament_name : undefined,
      },
    })),
  }));

  return {
    units,
    activeTrayId: activeTrayId >= 0 ? activeTrayId : undefined,
    autoRefill: !!info.auto_refill,
  };
}
