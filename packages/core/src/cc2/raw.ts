/**
 * Raw shapes of the CC2's own MQTT protocol, as documented by the community
 * (see docs/spike-findings.md, "The CC2 over the LAN"). Field names mirror the
 * printer's JSON exactly. Status messages are deltas: every field is optional
 * and the client deep-merges them into the last full status (method 1002).
 */

export interface RawCc2MachineStatus {
  /** 0 initializing, 1 idle, 2 printing, 5 auto-leveling, 10 homing, 14 emergency stop, … */
  status?: number;
  /** Detail within `status`, e.g. 2075 printing, 2502 paused (see mapStatus). */
  sub_status?: number;
  /** Active error codes; non-empty means the printer is in error. */
  exception_status?: unknown[];
  progress?: number;
}

export interface RawCc2PrintStatus {
  filename?: string;
  uuid?: string;
  current_layer?: number;
  total_layer?: number;
  /** Elapsed seconds. */
  print_duration?: number;
  /** Estimated total seconds. */
  total_duration?: number;
  remaining_time_sec?: number;
  progress?: number;
}

export interface RawCc2Heater {
  temperature?: number;
  target?: number;
}

export interface RawCc2Status {
  error_code?: number;
  machine_status?: RawCc2MachineStatus;
  print_status?: RawCc2PrintStatus;
  extruder?: RawCc2Heater & { filament_detected?: number };
  heater_bed?: RawCc2Heater;
  /** Chamber sensor (read-only); some firmware names it `chamber`. */
  ztemperature_sensor?: RawCc2Heater;
  chamber?: RawCc2Heater;
  /** Chamber light: `status` 0 = off, >0 = on. */
  led?: { status?: number };
  fans?: Record<string, { speed?: number; rpm?: number }>;
  external_device?: { camera?: boolean };
}

/** The `result` of method 1001 (attributes). */
export interface RawCc2Attributes {
  error_code?: number;
  hostname?: string;
  machine_model?: string;
  sn?: string;
  ip?: string;
  hardware_version?: string;
  software_version?: { ota_version?: string; mcu_version?: string; soc_version?: string };
}

/** CC2 MQTT method ids used by the LAN client. */
export const Cc2Method = {
  GET_ATTRIBUTES: 1001,
  GET_STATUS: 1002,
  PAUSE_PRINT: 1021,
  STOP_PRINT: 1022,
  RESUME_PRINT: 1023,
  HOME_AXES: 1026,
  MOVE_AXES: 1027,
  SET_TEMPERATURE: 1028,
  SET_LIGHT: 1029,
  VIDEO_STREAM: 1042,
  GET_CANVAS_STATUS: 2005,
  /** Pushed by the printer on `api_status`: a status delta. */
  ON_PRINTER_STATUS: 6000,
} as const;
