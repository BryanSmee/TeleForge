import type { Extruder, Filament, TempReading } from '../model/printer';

export interface MoonrakerTools {
  extruders: Extruder[];
  chamber?: TempReading;
}

const EXTRUDER_RE = /^extruder(\d*)$/;
// Klipper chamber/case sensors are commonly named these.
const CHAMBER_SENSORS = ['temperature_sensor cavity', 'temperature_sensor chamber'];
// Snapmaker exposes per-slot filament here (one slot per nozzle on the U1).
const FILAMENT_CONFIG = 'print_task_config';

/** The printer-object names we need to query, discovered from objects/list. */
export function toolObjectNames(objects: string[]): string[] {
  const extruders = objects.filter((o) => EXTRUDER_RE.test(o));
  const chamber = objects.filter((o) => CHAMBER_SENSORS.includes(o));
  const filament = objects.includes(FILAMENT_CONFIG) ? [FILAMENT_CONFIG] : [];
  return [...extruders, 'toolhead', ...chamber, ...filament];
}

function extruderIndex(name: string): number {
  const m = EXTRUDER_RE.exec(name);
  const n = m?.[1];
  return n ? Number(n) : 0;
}

/** Build a Filament for tool `slot` from Snapmaker's print_task_config arrays. */
function filamentForSlot(ptc: Record<string, any> | undefined, slot: number): Filament | undefined {
  if (!ptc) return undefined;
  const exists: unknown[] = ptc.filament_exist ?? [];
  if (exists[slot] === false) return undefined;

  const type: string | undefined = ptc.filament_type?.[slot];
  const subType: string | undefined = ptc.filament_sub_type?.[slot];
  const rgba: string | undefined = ptc.filament_color_rgba?.[slot];
  if (!type && !rgba) return undefined;

  return {
    material: type,
    name: subType,
    colorHex: rgba ? `#${rgba.slice(0, 6)}` : undefined,
  };
}

/**
 * Build normalized tools from a Moonraker `printer/objects/query` status map
 * plus the objects list (to know which extruders exist). Pure — unit-tested
 * against the real Snapmaker U1 payload.
 */
export function parseMoonrakerTools(objects: string[], status: Record<string, any>): MoonrakerTools {
  const names = objects.filter((o) => EXTRUDER_RE.test(o) && status[o]).sort((a, b) => extruderIndex(a) - extruderIndex(b));
  const activeName: string | undefined = status.toolhead?.extruder;
  const multi = names.length > 1;
  const ptc = status[FILAMENT_CONFIG];

  const extruders: Extruder[] = names.map((name) => {
    const e = status[name] ?? {};
    const index = typeof e.extruder_index === 'number' ? e.extruder_index : extruderIndex(name);
    return {
      index,
      label: multi ? `Nozzle ${index + 1}` : 'Nozzle',
      actual: typeof e.temperature === 'number' ? e.temperature : 0,
      target: typeof e.target === 'number' ? e.target : 0,
      settable: true,
      active: name === activeName,
      filament: filamentForSlot(ptc, index),
    };
  });

  let chamber: TempReading | undefined;
  for (const key of CHAMBER_SENSORS) {
    const c = status[key];
    if (c && typeof c.temperature === 'number') {
      chamber = { actual: c.temperature, target: 0, settable: false };
      break;
    }
  }

  return { extruders, chamber };
}
