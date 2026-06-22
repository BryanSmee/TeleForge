/**
 * Normalized printer model.
 *
 * This is TeleForge's own representation, independent of any single printer
 * protocol or transport. Adapters/clients (e.g. the OctoEverywhere command-API
 * client) map their raw responses into these types so the UI only ever deals
 * with one shape. Pure TypeScript — no React Native imports — so it stays
 * testable and reusable (future `packages/core`).
 */

/**
 * Printer platform family.
 *
 * Keyed on the *protocol/platform*, not the specific printer: standard
 * Klipper/Moonraker printers (the Snapmaker U1 included) all share `'klipper'`
 * so one adapter serves them; only proprietary platforms (the Elegoo CC2, with
 * its bespoke MQTT) get a dedicated id. Add a specific id only when a printer
 * genuinely deviates from its family.
 */
export type PrinterModel = 'cc2' | 'klipper' | 'unknown';

/** High-level connection / activity state. */
export type ConnectionState =
  | 'offline'
  | 'connecting'
  | 'idle'
  | 'printing'
  | 'paused'
  | 'complete'
  | 'error';

export type TempChannelId = 'nozzle' | 'bed' | 'chamber';

export interface TempChannel {
  id: TempChannelId;
  label: string;
  /** Current temperature, °C. */
  actual: number;
  /** Target temperature, °C (0 = heater off). */
  target: number;
  /** Whether this channel's target can be changed through the current transport. */
  settable: boolean;
}

export interface Job {
  fileName: string;
  /** 0–100, integer. */
  progressPct: number;
  /** Seconds elapsed since the print started. */
  elapsedSec: number;
  /** Seconds remaining, if the printer reports it. */
  remainingSec?: number;
  /** Absolute ETA (epoch ms), derived from `remainingSec` at mapping time. */
  etaEpochMs?: number;
  currentLayer?: number;
  totalLayers?: number;
}

export interface WebcamSource {
  name: string;
  /** Remote MJPEG stream URL (via the OE relay), ready to render. */
  streamUrl: string;
  /** Remote JPEG snapshot URL (via the OE relay), if the camera exposes one. */
  snapshotUrl?: string;
  flipH: boolean;
  flipV: boolean;
  /** Degrees clockwise: 0 | 90 | 180 | 270. */
  rotation: number;
}

/**
 * What the printer can do *right now*. Feature flags come from the platform
 * (a bitfield); pause/resume/cancel are derived from the current state.
 */
export interface Capabilities {
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canSetTemp: boolean;
  canSetLight: boolean;
  canMove: boolean;
  canHome: boolean;
  canStart: boolean;
}

export interface PrinterState {
  model: PrinterModel;
  connection: ConnectionState;
  /** True only while `printing` or `paused` — gate job rendering on this. */
  isActive: boolean;
  /** Present only when `isActive` (idle status fields are stale, see spike). */
  job?: Job;
  temps: TempChannel[];
  webcams: WebcamSource[];
  capabilities: Capabilities;
  platformVersion?: string;
  /** When this snapshot was produced (epoch ms). */
  lastUpdated: number;
}
