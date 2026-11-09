import type { PrinterControl } from '../control';
import type { PrinterState, WebcamSource } from '../model/printer';
import type { SetTempArgs } from '../octoeverywhere/client';
import { OctoEverywhereError } from '../octoeverywhere/errors';
import { mapMoonrakerStatus, statusObjectNames } from './mapStatus';
import { mapMoonrakerWebcams, type RawMoonrakerWebcam } from './mapWebcams';
import { parseMoonrakerTools, toolObjectNames, type MoonrakerTools } from './parseTools';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

// Jog feedrates (mm/min): Z is much slower than XY on most printers.
const XY_FEED = 6000;
const Z_FEED = 600;
const EXTRUDE_FEED = 300;

/**
 * A Klipper printer's Moonraker API, either relayed through the OctoEverywhere
 * connection (the relay forwards `/printer` and `/server` paths) or reached
 * directly on the LAN. Through the relay it fills the gaps in OE's normalized
 * status (multi-nozzle printers like the Snapmaker U1, fans); on the LAN it
 * also implements `PrinterControl`, so it replaces the OE command API there.
 */
export class MoonrakerClient implements PrinterControl {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  /** Printer objects, cached for status queries (they only change on a Klipper restart). */
  private objects?: string[];
  /** Active tool index from the last status, for `extrude`. */
  private activeExtruder?: number;

  /**
   * Whether a Moonraker API answers at `baseUrl` within `timeoutMs` — used to
   * decide if a printer's LAN URL is reachable from the current network.
   */
  static async probe(
    baseUrl: string,
    opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ): Promise<boolean> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve(false);
      }, opts.timeoutMs ?? 1500);
    });
    const request = (async () => {
      try {
        const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/server/info`, {
          signal: controller?.signal,
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { result?: { klippy_state?: unknown } };
        return typeof body?.result?.klippy_state === 'string';
      } catch {
        return false;
      }
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch }) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    // Bind to globalThis — web's window.fetch throws if called detached.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async getJson<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`);
    } catch (e) {
      throw OctoEverywhereError.transport(e instanceof Error ? e.message : 'Network request failed');
    }
    if (!res.ok) throw OctoEverywhereError.transport(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async post(path: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method: 'POST' });
    } catch (e) {
      throw OctoEverywhereError.transport(e instanceof Error ? e.message : 'Network request failed');
    }
    if (!res.ok) throw OctoEverywhereError.transport(`HTTP ${res.status}`);
  }

  /** Run a g-code script via Moonraker's HTTP API. */
  runGcode(script: string): Promise<void> {
    return this.post(`/printer/gcode/script?script=${encodeURIComponent(script)}`);
  }

  /** Normalized status, straight from Moonraker (the LAN counterpart of OE's `status`). */
  async getStatus(now: number = Date.now()): Promise<PrinterState> {
    if (!this.objects) {
      const list = await this.getJson<{ result: { objects: string[] } }>('/printer/objects/list');
      this.objects = list.result.objects;
    }
    const objects = this.objects;
    const query = statusObjectNames(objects).map((o) => encodeURIComponent(o)).join('&');
    try {
      const status = await this.getJson<{ result: { status: Record<string, any> } }>(
        `/printer/objects/query?${query}`,
      );
      const state = mapMoonrakerStatus(objects, status.result.status, now);
      this.activeExtruder = state.extruders.find((e) => e.active)?.index;
      return state;
    } catch (e) {
      // Klipper may have restarted with a different config: re-list next time.
      this.objects = undefined;
      throw e;
    }
  }

  /** Webcams configured in Moonraker, with URLs on this client's base (LAN). */
  async listWebcams(): Promise<WebcamSource[]> {
    const res = await this.getJson<{ result: { webcams?: RawMoonrakerWebcam[] } }>(
      '/server/webcams/list',
    );
    return mapMoonrakerWebcams(res.result.webcams ?? [], this.base);
  }

  pause(): Promise<void> {
    return this.post('/printer/print/pause');
  }

  resume(): Promise<void> {
    return this.post('/printer/print/resume');
  }

  cancel(): Promise<void> {
    return this.post('/printer/print/cancel');
  }

  /** Switch a light (an `output_pin`, as reported in `PrinterState.lights`). */
  setLight(name: string, on: boolean): Promise<void> {
    return this.runGcode(`SET_PIN PIN=${name} VALUE=${on ? 1 : 0}`);
  }

  /** Set heater targets, mirroring the OE `set-temp` command. */
  async setTemp(args: SetTempArgs): Promise<void> {
    if (args.bedC === undefined && args.toolC === undefined) {
      throw new Error('setTemp: at least one of bedC/toolC is required');
    }
    if (args.toolC !== undefined) await this.setExtruderTemp(args.toolNumber ?? 0, args.toolC);
    if (args.bedC !== undefined) await this.setBedTemp(args.bedC);
  }

  /** Home all axes. */
  home(): Promise<void> {
    return this.runGcode('G28');
  }

  /** Jog one axis by a signed distance (relative move; the g-code state is restored after). */
  moveAxis(axis: 'X' | 'Y' | 'Z', distanceMm: number): Promise<void> {
    const feed = axis === 'Z' ? Z_FEED : XY_FEED;
    return this.runGcode(
      [
        'SAVE_GCODE_STATE NAME=teleforge_jog',
        'G91',
        `G1 ${axis}${distanceMm} F${feed}`,
        'RESTORE_GCODE_STATE NAME=teleforge_jog',
      ].join('\n'),
    );
  }

  /**
   * Extrude (positive) or retract (negative) on a tool. Selecting a tool other
   * than the active one is a tool change (`T{n}`), as with the OE `extrude`.
   */
  extrude(extruder: number, distanceMm: number): Promise<void> {
    const toolChange = this.activeExtruder !== undefined && extruder !== this.activeExtruder;
    return this.runGcode(
      [
        ...(toolChange ? [`T${extruder}`] : []),
        'SAVE_GCODE_STATE NAME=teleforge_extrude',
        'M83',
        `G1 E${distanceMm} F${EXTRUDE_FEED}`,
        'RESTORE_GCODE_STATE NAME=teleforge_extrude',
      ].join('\n'),
    );
  }

  /**
   * Set a specific extruder's target (OE's set-temp ignores the tool number, so
   * we target the tool explicitly: `M104 T{n}`). 0 turns the heater off.
   */
  setExtruderTemp(index: number, targetC: number): Promise<void> {
    const t = clamp(targetC, 0, 300);
    return this.runGcode(`M104 T${index} S${t}`);
  }

  /** Set the bed target. 0 turns it off. */
  setBedTemp(targetC: number): Promise<void> {
    const t = clamp(targetC, 0, 120);
    return this.runGcode(`M140 S${t}`);
  }

  /**
   * Set a fan's speed (0–100%). The part-cooling fan (`fan`) takes `M106 S0-255`;
   * a `fan_generic <name>` takes `SET_FAN_SPEED FAN="<name>" SPEED=0..1`.
   */
  setFanSpeed(key: string, pct: number): Promise<void> {
    const p = clamp(pct, 0, 100);
    if (key === 'fan') {
      return this.runGcode(`M106 S${Math.round((p / 100) * 255)}`);
    }
    const name = key.replace(/^fan_generic\s+/, '');
    return this.runGcode(`SET_FAN_SPEED FAN="${name}" SPEED=${(p / 100).toFixed(2)}`);
  }

  /** Fetch the current tools (extruders + chamber) from Moonraker. */
  async getTools(): Promise<MoonrakerTools> {
    const list = await this.getJson<{ result: { objects: string[] } }>('/printer/objects/list');
    const objects = list.result.objects;
    const query = toolObjectNames(objects).map((o) => encodeURIComponent(o)).join('&');
    const status = await this.getJson<{ result: { status: Record<string, any> } }>(
      `/printer/objects/query?${query}`,
    );
    return parseMoonrakerTools(objects, status.result.status);
  }

  /** List printable g-code files, most recently modified first. */
  async listFiles(): Promise<GcodeFile[]> {
    const res = await this.getJson<{ result: RawGcodeFile[] }>('/server/files/list?root=gcodes');
    return (res.result ?? [])
      .map((f) => ({
        path: f.path,
        modifiedEpochSec: typeof f.modified === 'number' ? f.modified : 0,
        sizeBytes: typeof f.size === 'number' ? f.size : 0,
      }))
      .sort((a, b) => b.modifiedEpochSec - a.modifiedEpochSec);
  }

  /** Start printing a file (path relative to the gcodes root). */
  startPrint(path: string): Promise<void> {
    return this.post(`/printer/print/start?filename=${encodeURIComponent(path)}`);
  }
}

interface RawGcodeFile {
  path: string;
  modified?: number;
  size?: number;
}

/** A printable g-code file on the printer. */
export interface GcodeFile {
  /** Path relative to the gcodes root, e.g. "benchy.gcode". */
  path: string;
  /** Last-modified time (epoch seconds). */
  modifiedEpochSec: number;
  sizeBytes: number;
}
