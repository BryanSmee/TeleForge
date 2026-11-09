import { describe, it, expect } from '@jest/globals';
import { mapCc2Status, cc2PlatformVersion } from '../mapStatus';
import type { RawCc2Status } from '../raw';
import type { ConnectionState } from '../../model/printer';

const NOW = 1_700_000_000_000;

// A full status (method 1002) while printing, as in the community protocol doc.
const PRINTING: RawCc2Status = {
  error_code: 0,
  machine_status: { status: 2, sub_status: 2075, exception_status: [], progress: 45 },
  print_status: {
    filename: 'benchy.gcode',
    uuid: 'b52af24c',
    current_layer: 225,
    total_layer: 500,
    print_duration: 3600,
    total_duration: 8000,
    remaining_time_sec: 4400,
    progress: 45,
  },
  extruder: { temperature: 215.0, target: 220, filament_detected: 1 },
  heater_bed: { temperature: 58.5, target: 60 },
  ztemperature_sensor: { temperature: 33.0 },
  led: { status: 1 },
};

const withMachine = (status: number, sub_status = 0, exception_status: unknown[] = []): RawCc2Status => ({
  ...PRINTING,
  machine_status: { status, sub_status, exception_status, progress: 45 },
});

describe('mapCc2Status', () => {
  it('maps a print in progress', () => {
    const s = mapCc2Status(PRINTING, undefined, NOW);
    expect(s.model).toBe('cc2');
    expect(s.connection).toBe('printing');
    expect(s.isActive).toBe(true);
    expect(s.job).toEqual({
      fileName: 'benchy.gcode',
      progressPct: 45,
      elapsedSec: 3600,
      remainingSec: 4400,
      etaEpochMs: NOW + 4400 * 1000,
      currentLayer: 225,
      totalLayers: 500,
    });
    expect(s.extruders).toEqual([
      { index: 0, label: 'Nozzle', active: true, actual: 215, target: 220, settable: true },
    ]);
    expect(s.bed).toEqual({ actual: 58.5, target: 60, settable: true });
    expect(s.chamber).toEqual({ actual: 33, target: 0, settable: false });
    expect(s.lights).toEqual([{ name: 'chamber', on: true }]);
    expect(s.capabilities).toMatchObject({ canPause: true, canResume: false, canCancel: true, canSetTemp: true });
  });

  it('derives the time left from the total when the printer omits it', () => {
    const raw = { ...PRINTING, print_status: { ...PRINTING.print_status, remaining_time_sec: undefined } };
    expect(mapCc2Status(raw, undefined, NOW).job?.remainingSec).toBe(4400);
  });

  it.each<[number, number, ConnectionState]>([
    [2, 2502, 'paused'],
    [2, 2501, 'paused'],
    [2, 1045, 'printing'], // preheating
    [2, 2401, 'printing'], // resuming
    [2, 2077, 'complete'],
    [2, 2504, 'idle'], // stopped
    [1, 0, 'idle'],
    [10, 2801, 'idle'], // homing outside a print
    [14, 0, 'error'], // emergency stop
  ])('machine status %i / %i is %s', (status, sub, expected) => {
    expect(mapCc2Status(withMachine(status, sub), undefined, NOW).connection).toBe(expected);
  });

  it('is in error while an exception is reported', () => {
    expect(mapCc2Status(withMachine(2, 2075, [301]), undefined, NOW).connection).toBe('error');
  });

  it('drops the last print’s leftovers when idle', () => {
    const s = mapCc2Status(withMachine(1), undefined, NOW);
    expect(s.isActive).toBe(false);
    expect(s.job).toBeUndefined();
    expect(s.capabilities).toMatchObject({ canPause: false, canResume: false, canCancel: false });
  });

  it('reads a paused print as resumable', () => {
    expect(mapCc2Status(withMachine(2, 2502), undefined, NOW).capabilities).toMatchObject({
      canPause: false,
      canResume: true,
      canCancel: true,
    });
  });

  it('copes with a sparse status (no chamber, no light)', () => {
    const s = mapCc2Status({ machine_status: { status: 1 } }, undefined, NOW);
    expect(s.chamber).toBeUndefined();
    expect(s.lights).toEqual([]);
    expect(s.bed).toBeUndefined();
    expect(s.extruders[0]).toMatchObject({ actual: 0, target: 0 });
  });

  it('builds the platform version from the attributes', () => {
    expect(
      cc2PlatformVersion({
        machine_model: 'Centauri Carbon 2',
        software_version: { ota_version: '01.02.03.04' },
        hardware_version: '1.0',
      }),
    ).toBe('Centauri Carbon 2-01.02.03.04-1.0');
    expect(cc2PlatformVersion(undefined)).toBe('Elegoo-CC2');
  });
});
