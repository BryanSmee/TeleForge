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
  OctoEverywhereStatus?: {
    /** OctoEverywhere's "Gadget" AI print-failure detection. */
    Gadget?: {
      /** Most recent failure score, 0..1 (higher = more likely a failure). */
      LastScore?: number;
    };
  } | null;
  PlatformVersion?: string;
  /** Bitfield of Oe_Feature flags. */
  Features?: number;
  ListWebcams?: RawListWebcams;
}

/**
 * `send-command` passthrough envelope (the CC2 uses `TransportType:"mqtt"`).
 * The printer's own JSON-RPC reply is nested under `Response.Payload`.
 */
export interface RawSendCommandResult {
  TransportType: string;
  ResponseReceived: boolean;
  IsError: boolean;
  Response?: {
    Payload?: {
      id?: number;
      method?: number;
      result?: unknown;
    };
  };
}

/** A CC2 combo/CFS slot, as returned by MQTT method 2005 (`canvas_info`). */
export interface RawCanvasTray {
  tray_id: number;
  brand?: string;
  filament_code?: string;
  filament_color?: string;
  filament_name?: string;
  filament_type?: string;
  max_nozzle_temp?: number;
  min_nozzle_temp?: number;
  /** 0 = empty, 1 = present/idle, 2 = active/loaded (inferred from observation). */
  status: number;
}

export interface RawCanvas {
  canvas_id: number;
  /** 1 when the unit is attached. */
  connected: number;
  tray_list: RawCanvasTray[];
}

export interface RawCanvasInfo {
  active_canvas_id: number;
  /** Globally active tray id, or -1 when nothing is loaded. */
  active_tray_id: number;
  auto_refill: boolean;
  canvas_list: RawCanvas[];
}

/** The `result` of an MQTT method-2005 reply. */
export interface RawCanvasResult {
  canvas_info?: RawCanvasInfo;
  error_code?: number;
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
