import { describe, it, expect } from '@jest/globals';
import { mapMoonrakerStatus, statusObjectNames } from '../mapStatus';

const OBJECTS = [
  'webhooks',
  'print_stats',
  'virtual_sdcard',
  'display_status',
  'heater_bed',
  'extruder',
  'extruder1',
  'toolhead',
  'fan',
  'output_pin caselight',
  'output_pin beeper',
  'temperature_sensor cavity',
];

const NOW = 1_700_000_000_000;

function status(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    webhooks: { state: 'ready' },
    print_stats: { state: 'standby', filename: '', print_duration: 0, total_duration: 0, info: {} },
    virtual_sdcard: { progress: 0 },
    display_status: { progress: 0 },
    heater_bed: { temperature: 24.6, target: 0 },
    extruder: { temperature: 210.2, target: 210 },
    extruder1: { temperature: 25, target: 0 },
    toolhead: { extruder: 'extruder' },
    fan: { speed: 0.5 },
    'output_pin caselight': { value: 1 },
    'temperature_sensor cavity': { temperature: 31 },
    ...overrides,
  };
}

describe('statusObjectNames', () => {
  it('queries status, bed, tools and light pins only', () => {
    const names = statusObjectNames(OBJECTS);
    expect(names).toEqual(
      expect.arrayContaining(['webhooks', 'print_stats', 'heater_bed', 'extruder', 'extruder1', 'output_pin caselight']),
    );
    expect(names).not.toContain('output_pin beeper');
  });
});

describe('mapMoonrakerStatus', () => {
  it('maps an idle printer with temps, chamber and lights', () => {
    const s = mapMoonrakerStatus(OBJECTS, status(), NOW);
    expect(s.model).toBe('klipper');
    expect(s.connection).toBe('idle');
    expect(s.isActive).toBe(false);
    expect(s.job).toBeUndefined();
    expect(s.extruders.map((e) => [e.index, e.actual, e.active])).toEqual([
      [0, 210.2, true],
      [1, 25, false],
    ]);
    expect(s.bed).toEqual({ actual: 24.6, target: 0, settable: true });
    expect(s.chamber?.actual).toBe(31);
    expect(s.lights).toEqual([{ name: 'caselight', on: true }]);
    expect(s.capabilities).toMatchObject({
      canPause: false,
      canResume: false,
      canCancel: false,
      canSetTemp: true,
      canSetLight: true,
      canMove: true,
      canHome: true,
    });
    expect(s.lastUpdated).toBe(NOW);
  });

  it('maps a running job with a linear ETA and layers', () => {
    const s = mapMoonrakerStatus(
      OBJECTS,
      status({
        print_stats: {
          state: 'printing',
          filename: 'benchy.gcode',
          print_duration: 600,
          total_duration: 660,
          info: { current_layer: 12, total_layer: 120 },
        },
        virtual_sdcard: { progress: 0.25 },
      }),
      NOW,
    );
    expect(s.connection).toBe('printing');
    expect(s.isActive).toBe(true);
    expect(s.job).toEqual({
      fileName: 'benchy.gcode',
      progressPct: 25,
      elapsedSec: 660,
      remainingSec: 1800,
      etaEpochMs: NOW + 1800 * 1000,
      currentLayer: 12,
      totalLayers: 120,
    });
    expect(s.capabilities).toMatchObject({ canPause: true, canResume: false, canCancel: true });
  });

  it('maps paused and complete states', () => {
    const paused = mapMoonrakerStatus(OBJECTS, status({ print_stats: { state: 'paused', filename: 'a.gcode' } }));
    expect(paused.connection).toBe('paused');
    expect(paused.capabilities).toMatchObject({ canPause: false, canResume: true, canCancel: true });
    expect(paused.job?.remainingSec).toBeUndefined(); // no progress yet → no estimate

    const done = mapMoonrakerStatus(OBJECTS, status({ print_stats: { state: 'complete' } }));
    expect(done.connection).toBe('complete');
    expect(done.isActive).toBe(false);
  });

  it('reports Klippy errors and startup over the print state', () => {
    const err = mapMoonrakerStatus(OBJECTS, status({ webhooks: { state: 'shutdown' } }));
    expect(err.connection).toBe('error');
    expect(err.capabilities.canMove).toBe(false);

    const starting = mapMoonrakerStatus(OBJECTS, status({ webhooks: { state: 'startup' } }));
    expect(starting.connection).toBe('connecting');
  });

  it('tolerates missing objects', () => {
    const s = mapMoonrakerStatus(['extruder'], { extruder: { temperature: 20, target: 0 } });
    expect(s.connection).toBe('idle');
    expect(s.bed).toBeUndefined();
    expect(s.lights).toEqual([]);
    expect(s.capabilities.canSetLight).toBe(false);
  });
});
