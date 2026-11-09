import type {
  Capabilities,
  ConnectionState,
  Light,
  PrinterState,
  TempReading,
} from '../model/printer';
import { parseMoonrakerTools, toolObjectNames } from './parseTools';

// Lights are plain `output_pin`s on most Klipper printers; only pins whose name
// looks like a light are surfaced (others drive beepers, relays, …).
const LIGHT_PIN_RE = /^output_pin\s+(.*(?:light|led|lamp).*)$/i;

/** The printer-object names a full status query needs, discovered from objects/list. */
export function statusObjectNames(objects: string[]): string[] {
  const base = ['webhooks', 'print_stats', 'virtual_sdcard', 'display_status'];
  const bed = objects.includes('heater_bed') ? ['heater_bed'] : [];
  const lights = objects.filter((o) => LIGHT_PIN_RE.test(o));
  return [...base, ...bed, ...toolObjectNames(objects), ...lights];
}

/** Moonraker's print_stats.state (+ Klippy's webhooks.state) → ConnectionState. */
function mapState(klippyState: string | undefined, printState: string | undefined): ConnectionState {
  if (klippyState && klippyState !== 'ready') {
    return klippyState === 'startup' ? 'connecting' : 'error';
  }
  switch (printState) {
    case 'printing':
      return 'printing';
    case 'paused':
      return 'paused';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
    default:
      // standby, cancelled
      return 'idle';
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function buildLights(objects: string[], status: Record<string, any>): Light[] {
  return objects
    .filter((o) => LIGHT_PIN_RE.test(o) && status[o])
    .map((o) => ({ name: LIGHT_PIN_RE.exec(o)![1], on: (num(status[o].value) ?? 0) > 0 }));
}

function buildCapabilities(connection: ConnectionState, hasLights: boolean): Capabilities {
  const ready = connection !== 'error' && connection !== 'connecting';
  const isPrinting = connection === 'printing';
  const isPaused = connection === 'paused';
  return {
    canPause: isPrinting,
    canResume: isPaused,
    canCancel: isPrinting || isPaused,
    canSetTemp: ready,
    canSetLight: ready && hasLights,
    canMove: ready,
    canHome: ready,
    canStart: ready,
  };
}

/**
 * Map a Moonraker `printer/objects/query` status (for the objects named by
 * `statusObjectNames`) into the normalized PrinterState — the LAN counterpart
 * of the OE `mapStatus`. Pure, so it's unit-tested against sample payloads.
 *
 * The ETA is a linear estimate from print time and progress (what Mainsail's
 * "file" estimate does when the slicer gave no total).
 */
export function mapMoonrakerStatus(
  objects: string[],
  status: Record<string, any>,
  now: number = Date.now(),
): PrinterState {
  const ps = status.print_stats ?? {};
  const connection = mapState(status.webhooks?.state, ps.state);
  const isActive = connection === 'printing' || connection === 'paused';

  let job: PrinterState['job'];
  if (isActive) {
    const progress =
      num(status.virtual_sdcard?.progress) ?? num(status.display_status?.progress) ?? 0;
    const printSec = num(ps.print_duration) ?? 0;
    const remainingSec =
      progress > 0 && printSec > 0 ? Math.round(printSec / progress - printSec) : undefined;
    const currentLayer = num(ps.info?.current_layer);
    const totalLayers = num(ps.info?.total_layer);
    job = {
      fileName: typeof ps.filename === 'string' ? ps.filename : '',
      progressPct: Math.max(0, Math.min(100, Math.round(progress * 100))),
      elapsedSec: Math.round(num(ps.total_duration) ?? printSec),
      remainingSec,
      etaEpochMs: remainingSec !== undefined ? now + remainingSec * 1000 : undefined,
      currentLayer: currentLayer && currentLayer > 0 ? currentLayer : undefined,
      totalLayers: totalLayers && totalLayers > 0 ? totalLayers : undefined,
    };
  }

  const tools = parseMoonrakerTools(objects, status);
  const hb = status.heater_bed;
  const bed: TempReading | undefined = hb
    ? { actual: num(hb.temperature) ?? 0, target: num(hb.target) ?? 0, settable: true }
    : undefined;
  const lights = buildLights(objects, status);

  return {
    model: 'klipper',
    connection,
    isActive,
    job,
    extruders: tools.extruders,
    bed,
    chamber: tools.chamber,
    lights,
    capabilities: buildCapabilities(connection, lights.length > 0),
    lastUpdated: now,
  };
}
