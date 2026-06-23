import type {
  Capabilities,
  ConnectionState,
  Extruder,
  PrinterModel,
  PrinterState,
  TempReading,
} from '../model/printer';
import { OeFeature, type RawStatusResult } from './raw';

function mapState(rawState: string): ConnectionState {
  switch (rawState.toLowerCase()) {
    case 'printing':
      return 'printing';
    case 'paused':
      return 'paused';
    case 'complete':
    case 'completed':
      return 'complete';
    case 'error':
      return 'error';
    case 'offline':
      return 'offline';
    default:
      return 'idle';
  }
}

function mapModel(platformVersion?: string): PrinterModel {
  if (!platformVersion) return 'unknown';
  const v = platformVersion.toLowerCase();
  if (v.includes('cc2') || v.includes('centauri')) return 'cc2';
  if (v.includes('klipper') || v.includes('moonraker')) return 'klipper';
  return 'unknown';
}

// OE's normalized status only reports a single hotend. Multi-nozzle printers
// are enriched separately from Moonraker (see src/core/moonraker).
function buildExtruders(raw: RawStatusResult, hasTempControl: boolean): Extruder[] {
  const t = raw.JobStatus.CurrentPrint.Temps;
  return [
    {
      index: 0,
      label: 'Nozzle',
      actual: t.HotendActual,
      target: t.HotendTarget,
      settable: hasTempControl,
      active: true,
    },
  ];
}

function buildBed(raw: RawStatusResult, hasTempControl: boolean): TempReading {
  const t = raw.JobStatus.CurrentPrint.Temps;
  return { actual: t.BedActual, target: t.BedTarget, settable: hasTempControl };
}

// Chamber set isn't supported on the CC2, so never mark it settable here.
function buildChamber(raw: RawStatusResult): TempReading | undefined {
  const t = raw.JobStatus.CurrentPrint.Temps;
  if (t.ChamberActual > 0 || t.ChamberTarget > 0) {
    return { actual: t.ChamberActual, target: t.ChamberTarget, settable: false };
  }
  return undefined;
}

function buildCapabilities(features: number, connection: ConnectionState): Capabilities {
  const has = (flag: number) => (features & flag) !== 0;
  const isPrinting = connection === 'printing';
  const isPaused = connection === 'paused';
  return {
    canPause: isPrinting,
    canResume: isPaused,
    canCancel: isPrinting || isPaused,
    canSetTemp: has(OeFeature.TEMPERATURE_CONTROL),
    canSetLight: has(OeFeature.LIGHT_CONTROL),
    canMove: has(OeFeature.AXIS_MOVEMENT),
    canHome: has(OeFeature.HOMING),
    canStart: has(OeFeature.PRINT_START),
  };
}

/**
 * Map a raw command-API `status` result into the normalized PrinterState.
 *
 * Key rule from the spike: `CurrentPrint` fields are stale/empty when the
 * printer is idle, so the `job` is only populated while printing or paused.
 * Webcams are NOT taken from status (it omits the URLs) — fetch via listWebcams.
 *
 * @param now injectable clock for deterministic ETA in tests
 */
export function mapStatus(raw: RawStatusResult, now: number = Date.now()): PrinterState {
  const connection = mapState(raw.JobStatus.State);
  const isActive = connection === 'printing' || connection === 'paused';
  const features = raw.Features ?? 0;

  let job: PrinterState['job'];
  if (isActive) {
    const cp = raw.JobStatus.CurrentPrint;
    const remainingSec = cp.TimeLeftSec > 0 ? cp.TimeLeftSec : undefined;
    job = {
      fileName: cp.FileName,
      progressPct: Math.max(0, Math.min(100, Math.round(cp.Progress))),
      elapsedSec: cp.DurationSec,
      remainingSec,
      etaEpochMs: remainingSec !== undefined ? now + remainingSec * 1000 : undefined,
      currentLayer: cp.CurrentLayer > 0 ? cp.CurrentLayer : undefined,
      totalLayers: cp.TotalLayers > 0 ? cp.TotalLayers : undefined,
    };
  }

  return {
    model: mapModel(raw.PlatformVersion),
    connection,
    isActive,
    job,
    extruders: buildExtruders(raw, (features & OeFeature.TEMPERATURE_CONTROL) !== 0),
    bed: buildBed(raw, (features & OeFeature.TEMPERATURE_CONTROL) !== 0),
    chamber: buildChamber(raw),
    lights: (raw.JobStatus.Lights ?? []).map((l) => ({ name: l.Name, on: l.On })),
    capabilities: buildCapabilities(features, connection),
    platformVersion: raw.PlatformVersion,
    lastUpdated: now,
  };
}
