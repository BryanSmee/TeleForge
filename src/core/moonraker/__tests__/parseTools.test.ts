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
  'fan_generic cavity_fan',
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
  toolhead: { extruder: 'extruder1' },
};

describe('toolObjectNames', () => {
  it('selects all extruders, toolhead, and the chamber sensor', () => {
    expect(toolObjectNames(objects)).toEqual([
      'extruder',
      'extruder1',
      'extruder2',
      'extruder3',
      'toolhead',
      'temperature_sensor cavity',
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
