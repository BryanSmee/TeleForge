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
}
