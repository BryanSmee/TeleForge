import type {
  Capabilities,
  ConnectionState,
  PrinterModel,
  PrinterState,
  TempChannel,
} from '../model/printer';
import { OeFeature, type RawStatusResult } from './raw';
import { mapWebcams } from './mapWebcams';

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

function buildTemps(raw: RawStatusResult, hasTempControl: boolean): TempChannel[] {
  const t = raw.JobStatus.CurrentPrint.Temps;
  const channels: TempChannel[] = [
    { id: 'nozzle', label: 'Nozzle', actual: t.HotendActual, target: t.HotendTarget, settable: hasTempControl },
    { id: 'bed', label: 'Bed', actual: t.BedActual, target: t.BedTarget, settable: hasTempControl },
  ];
  // Only surface a chamber channel when the printer actually reports one.
  // Chamber set is not supported on the CC2, so never mark it settable here.
  if (t.ChamberActual > 0 || t.ChamberTarget > 0) {
    channels.push({ id: 'chamber', label: 'Chamber', actual: t.ChamberActual, target: t.ChamberTarget, settable: false });
  }
  return channels;
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
 *
 * @param baseUrl the Shared Connection base URL (used to build webcam stream URLs)
 * @param now     injectable clock for deterministic ETA in tests
 */
export function mapStatus(raw: RawStatusResult, baseUrl: string, now: number = Date.now()): PrinterState {
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
    temps: buildTemps(raw, (features & OeFeature.TEMPERATURE_CONTROL) !== 0),
    webcams: raw.ListWebcams ? mapWebcams(raw.ListWebcams, baseUrl) : [],
    capabilities: buildCapabilities(features, connection),
    platformVersion: raw.PlatformVersion,
    lastUpdated: now,
  };
}
