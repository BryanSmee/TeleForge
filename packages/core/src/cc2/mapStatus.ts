import type { Capabilities, ConnectionState, PrinterState, TempReading } from '../model/printer';
import type { RawCc2Attributes, RawCc2Status } from './raw';

/** The chamber light's name, the same one OE's normalized status uses for the CC2. */
export const CC2_LIGHT_NAME = 'chamber';

const MACHINE_PRINTING = 2;
const MACHINE_EMERGENCY_STOP = 14;

// Sub-statuses while `machine_status.status` is 2 (printing).
const SUB_PAUSED = new Set([2501, 2502, 2505]); // pausing, paused, paused (variant)
const SUB_STOPPED = new Set([2503, 2504]); // stopping, stopped
const SUB_COMPLETED = 2077;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * The CC2's machine status → ours, following OE's own CC2 translation: any
 * exception or an emergency stop is an error; within a print, pausing/paused
 * is paused, stopping/stopped is back to idle, completed is complete, and the
 * rest (preheating, homing, leveling, printing, resuming) counts as printing.
 * Everything outside a print (homing, leveling, filament loading…) is idle.
 */
function mapState(raw: RawCc2Status): ConnectionState {
  const ms = raw.machine_status ?? {};
  if ((ms.exception_status?.length ?? 0) > 0) return 'error';
  if (ms.status === MACHINE_EMERGENCY_STOP) return 'error';
  if (ms.status !== MACHINE_PRINTING) return 'idle';
  const sub = ms.sub_status ?? 0;
  if (SUB_PAUSED.has(sub)) return 'paused';
  if (SUB_STOPPED.has(sub)) return 'idle';
  if (sub === SUB_COMPLETED) return 'complete';
  return 'printing';
}

function heater(h: { temperature?: number; target?: number } | undefined, settable: boolean): TempReading | undefined {
  if (!h) return undefined;
  return { actual: num(h.temperature) ?? 0, target: num(h.target) ?? 0, settable };
}

function buildCapabilities(connection: ConnectionState): Capabilities {
  const isPrinting = connection === 'printing';
  const isPaused = connection === 'paused';
  // The same set OE advertises for the CC2: lights, homing, axis moves, temps.
  return {
    canPause: isPrinting,
    canResume: isPaused,
    canCancel: isPrinting || isPaused,
    canSetTemp: true,
    canSetLight: true,
    canMove: true,
    canHome: true,
    canStart: false,
  };
}

/** "Centauri Carbon 2-01.02.03.04-1.0", like OE's platform version for the CC2. */
export function cc2PlatformVersion(attrs: RawCc2Attributes | undefined): string {
  const parts = [attrs?.machine_model, attrs?.software_version?.ota_version, attrs?.hardware_version].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join('-') : 'Elegoo-CC2';
}

/**
 * Map the CC2's merged MQTT status (method 1002 + `api_status` deltas) into
 * the normalized PrinterState — the LAN counterpart of the OE `mapStatus` for
 * the CC2. As there, the job is only filled while printing or paused: the
 * print fields keep the last print's values when idle.
 *
 * @param now injectable clock for deterministic ETA in tests
 */
export function mapCc2Status(
  raw: RawCc2Status,
  attrs?: RawCc2Attributes,
  now: number = Date.now(),
): PrinterState {
  const connection = mapState(raw);
  const isActive = connection === 'printing' || connection === 'paused';

  let job: PrinterState['job'];
  if (isActive) {
    const ps = raw.print_status ?? {};
    const progress = num(ps.progress) ?? num(raw.machine_status?.progress) ?? 0;
    const elapsedSec = num(ps.print_duration) ?? 0;
    const total = num(ps.total_duration);
    const remaining = num(ps.remaining_time_sec) ?? (total !== undefined ? Math.max(0, total - elapsedSec) : undefined);
    const remainingSec = remaining !== undefined && remaining > 0 ? Math.round(remaining) : undefined;
    const currentLayer = num(ps.current_layer);
    const totalLayers = num(ps.total_layer);
    job = {
      fileName: typeof ps.filename === 'string' ? ps.filename : '',
      progressPct: Math.max(0, Math.min(100, Math.round(progress))),
      elapsedSec,
      remainingSec,
      etaEpochMs: remainingSec !== undefined ? now + remainingSec * 1000 : undefined,
      currentLayer: currentLayer && currentLayer > 0 ? currentLayer : undefined,
      totalLayers: totalLayers && totalLayers > 0 ? totalLayers : undefined,
    };
  }

  const nozzle = heater(raw.extruder, true) ?? { actual: 0, target: 0, settable: true };
  // The chamber is read-only on the CC2 (no set-temp for it, as through OE).
  const chamberRaw = heater(raw.ztemperature_sensor ?? raw.chamber, false);
  const chamber = chamberRaw && (chamberRaw.actual > 0 || chamberRaw.target > 0) ? chamberRaw : undefined;
  const ledStatus = num(raw.led?.status);

  return {
    model: 'cc2',
    connection,
    isActive,
    job,
    extruders: [{ index: 0, label: 'Nozzle', active: true, ...nozzle }],
    bed: heater(raw.heater_bed, true),
    chamber,
    lights: ledStatus !== undefined ? [{ name: CC2_LIGHT_NAME, on: ledStatus > 0 }] : [],
    capabilities: buildCapabilities(connection),
    platformVersion: cc2PlatformVersion(attrs),
    lastUpdated: now,
  };
}
