import { describe, it, expect } from '@jest/globals';
import { parseMoonrakerTools, toolObjectNames } from '../parseTools';

// Trimmed from the real Snapmaker U1 probe output.
const objects = [
  'gcode',
  'extruder',
  'extruder1',
  'extruder2',
  'extruder3',
  'heater_bed',
  'temperature_sensor cavity',
  'fan',
  'fan_generic cavity_fan',
  'heater_fan hotend_fan',
  'toolhead',
  'print_stats',
];

const status: Record<string, any> = {
  extruder: { temperature: 28, target: 0, extruder_index: 0, state: 'PARKED' },
  extruder1: { temperature: 29, target: 210, extruder_index: 1, state: 'PARKED' },
  extruder2: { temperature: 28, target: 0, extruder_index: 2, state: 'PARKED' },
  extruder3: { temperature: 28, target: 0, extruder_index: 3, state: 'PARKED' },
  heater_bed: { temperature: 25, target: 0 },
  'temperature_sensor cavity': { temperature: 31 },
  fan: { speed: 0.5, rpm: 1200 },
  'fan_generic cavity_fan': { speed: 1 },
  'heater_fan hotend_fan': { speed: 1 },
  toolhead: { extruder: 'extruder1' },
  // From the real U1 print_task_config.
  print_task_config: {
    filament_type: ['PLA', 'PLA', 'PLA', 'PLA'],
    filament_sub_type: ['SnapSpeed', 'SnapSpeed', 'Matte', 'SnapSpeed'],
    filament_color_rgba: ['080A0DFF', 'E2DEDBFF', '0078BFFF', 'E72F1DFF'],
    filament_exist: [true, true, true, true],
  },
};

describe('toolObjectNames', () => {
  it('selects all extruders, toolhead, the chamber sensor, and filament config', () => {
    expect(toolObjectNames([...objects, 'print_task_config'])).toEqual([
      'extruder',
      'extruder1',
      'extruder2',
      'extruder3',
      'toolhead',
      'temperature_sensor cavity',
      'print_task_config',
      'fan',
      'fan_generic cavity_fan',
    ]);
  });
});

describe('parseMoonrakerTools (real U1 shape)', () => {
  const tools = parseMoonrakerTools(objects, status);

  it('returns all four nozzles, ordered by index, labelled 1-based', () => {
    expect(tools.extruders).toHaveLength(4);
    expect(tools.extruders.map((e) => e.label)).toEqual(['Nozzle 1', 'Nozzle 2', 'Nozzle 3', 'Nozzle 4']);
    expect(tools.extruders.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('carries per-nozzle temps and marks the active tool from toolhead', () => {
    const t1 = tools.extruders[1];
    expect(t1.actual).toBe(29);
    expect(t1.target).toBe(210);
    expect(t1.active).toBe(true);
    expect(tools.extruders[0].active).toBe(false);
  });

  it('reads the chamber from temperature_sensor cavity (read-only)', () => {
    expect(tools.chamber).toEqual({ actual: 31, target: 0, settable: false });
  });

  it('reads settable fans (part-cooling first), skipping automatic heater/controller fans', () => {
    expect(tools.fans).toEqual([
      { key: 'fan', label: 'Part cooling', speedPct: 50, settable: true },
      { key: 'fan_generic cavity_fan', label: 'Cavity fan', speedPct: 100, settable: true },
    ]);
  });

  it('attaches per-nozzle filament from print_task_config', () => {
    expect(tools.extruders[0].filament).toEqual({
      material: 'PLA',
      name: 'SnapSpeed',
      colorHex: '#080A0D',
    });
    expect(tools.extruders[2].filament).toMatchObject({ name: 'Matte', colorHex: '#0078BF' });
  });

  it('omits filament for an empty slot', () => {
    const s = { ...status, print_task_config: { ...status.print_task_config, filament_exist: [false, true, true, true] } };
    expect(parseMoonrakerTools(objects, s).extruders[0].filament).toBeUndefined();
  });

  it('labels a single-extruder printer just "Nozzle"', () => {
    const single = parseMoonrakerTools(['extruder', 'toolhead'], {
      extruder: { temperature: 200, target: 200, extruder_index: 0 },
      toolhead: { extruder: 'extruder' },
    });
    expect(single.extruders).toHaveLength(1);
    expect(single.extruders[0].label).toBe('Nozzle');
    expect(single.extruders[0].active).toBe(true);
  });
});
