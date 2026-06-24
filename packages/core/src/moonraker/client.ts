import { OctoEverywhereError } from '../octoeverywhere/errors';
import { parseMoonrakerTools, toolObjectNames, type MoonrakerTools } from './parseTools';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Reads multi-nozzle data straight from a Klipper printer's Moonraker API,
 * relayed through the OctoEverywhere connection (the relay forwards `/printer`
 * and `/server` paths). OE's normalized status only reports one hotend, so
 * this fills the gap for printers like the Snapmaker U1 (4 nozzles).
 */
export class MoonrakerClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

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

  /** Run a g-code script via Moonraker's HTTP API. */
  async runGcode(script: string): Promise<void> {
    const path = `/printer/gcode/script?script=${encodeURIComponent(script)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method: 'POST' });
    } catch (e) {
      throw OctoEverywhereError.transport(e instanceof Error ? e.message : 'Network request failed');
    }
    if (!res.ok) throw OctoEverywhereError.transport(`HTTP ${res.status}`);
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
  async startPrint(path: string): Promise<void> {
    const url = `${this.base}/printer/print/start?filename=${encodeURIComponent(path)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'POST' });
    } catch (e) {
      throw OctoEverywhereError.transport(e instanceof Error ? e.message : 'Network request failed');
    }
    if (!res.ok) throw OctoEverywhereError.transport(`HTTP ${res.status}`);
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
