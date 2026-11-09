import type { PrinterState, WebcamSource } from './model/printer';
import type { SetTempArgs } from './octoeverywhere/client';

/**
 * The status + commands the dashboard drives, whichever path reaches the
 * printer: the OE command API through the relay (`OctoEverywhereClient`) or
 * Moonraker directly on the LAN (`MoonrakerClient`).
 */
export interface PrinterControl {
  getStatus(now?: number): Promise<PrinterState>;
  listWebcams(): Promise<WebcamSource[]>;
  setLight(name: string, on: boolean): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  setTemp(args: SetTempArgs): Promise<void>;
  home(): Promise<void>;
  moveAxis(axis: 'X' | 'Y' | 'Z', distanceMm: number): Promise<void>;
  extrude(extruder: number, distanceMm: number): Promise<void>;
}
