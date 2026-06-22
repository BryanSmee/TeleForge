/**
 * Raw shapes returned by the OctoEverywhere command API
 * (`/octoeverywhere-command-api/`), as observed live against a CC2 during the
 * spike (see docs/spike-findings.md). Field names mirror the API exactly.
 *
 * Every command response is wrapped in an envelope: `{ Status, Result }`.
 */

export interface OeEnvelope<T> {
  /** 200 on success; an OE command-error code (750–789) otherwise. */
  Status: number;
  Result?: T;
  Error?: string;
}

export interface RawTemps {
  BedActual: number;
  BedTarget: number;
  HotendActual: number;
  HotendTarget: number;
  ChamberActual: number;
  ChamberTarget: number;
}

export interface RawCurrentPrint {
  Progress: number; // 0–100
  DurationSec: number;
  TimeLeftSec: number;
  FileName: string;
  EstTotalFilUsedMm?: number;
  EstTotalFilWeightMg?: number;
  CurrentLayer: number;
  TotalLayers: number;
  Temps: RawTemps;
}

export interface RawLight {
  Name: string;
  On: boolean;
}

export interface RawJobStatus {
  /** e.g. "idle" | "printing" | "paused" | "complete" | "error". */
  State: string;
  SubState: string | null;
  Error: string | null;
  Lights?: RawLight[] | null;
  CurrentPrint: RawCurrentPrint;
}

export interface RawWebcam {
  Name: string;
  FlipH: boolean;
  FlipV: boolean;
  Rotation: number;
  Enabled: boolean;
  SnapshotUrl: string | null;
  /** A LAN URL — not usable remotely; use the OE relay path instead. */
  StreamUrl: string | null;
}

export interface RawListWebcams {
  Webcams: RawWebcam[];
  DefaultIndex: number;
}

export interface RawStatusResult {
  JobStatus: RawJobStatus;
  OctoEverywhereStatus?: unknown;
  PlatformVersion?: string;
  /** Bitfield of Oe_Feature flags. */
  Features?: number;
  ListWebcams?: RawListWebcams;
}

/** OctoEverywhere platform feature bitflags (from the plugin's interfaces.py). */
export const OeFeature = {
  LIGHT_CONTROL: 1 << 0,
  AXIS_MOVEMENT: 1 << 1,
  HOMING: 1 << 2,
  EXTRUSION: 1 << 3,
  TEMPERATURE_CONTROL: 1 << 4,
  PRINT_START: 1 << 5,
} as const;
