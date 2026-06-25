import type { PrinterState, WebcamSource } from '../model/printer';
import { OctoEverywhereError, isRelayErrorStatus } from './errors';
import { mapStatus } from './mapStatus';
import { mapWebcams } from './mapWebcams';
import type {
  OeEnvelope,
  RawCanvasResult,
  RawListWebcams,
  RawSendCommandResult,
  RawStatusResult,
} from './raw';

const COMMAND_PREFIX = '/octoeverywhere-command-api';

/** Max target temperatures the OE command API will accept (from the plugin). */
export const TEMP_LIMITS = { bedC: 75, chamberC: 75, toolC: 260 } as const;

export interface SetTempArgs {
  bedC?: number;
  toolC?: number;
  /** Accepted by the API but unsupported on the CC2 — will error there. */
  chamberC?: number;
  toolNumber?: number;
}

export interface OctoEverywhereClientOptions {
  /**
   * The Shared Connection (or App Connection) base URL, e.g.
   * `https://shared-xxxx.octoeverywhere.com`. A Shared Connection carries its
   * own auth in the subdomain, so no header is needed by default.
   */
  baseUrl: string;
  /** Optional Bearer token (App Connection path / authed Shared Connections). */
  bearerToken?: string;
  /** Injectable fetch for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin client over the OctoEverywhere normalized command API. Works the same
 * for the CC2 (MQTT under the hood) and the U1 (Moonraker) — OE normalizes both.
 */
export class OctoEverywhereClient {
  private readonly base: string;
  private readonly bearerToken?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OctoEverywhereClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.bearerToken = opts.bearerToken;
    if (typeof (opts.fetchImpl ?? globalThis.fetch) !== 'function') {
      throw new Error('OctoEverywhereClient: no fetch implementation available');
    }
    // Bind to globalThis: on web, window.fetch throws "Illegal invocation" if
    // called detached from window. Harmless on native (RN fetch ignores `this`).
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Normalized current status. */
  async getStatus(now: number = Date.now()): Promise<PrinterState> {
    const result = await this.command<RawStatusResult>('status', 'GET');
    return mapStatus(result, now);
  }

  /** Normalized webcam list (with remote stream URLs). */
  async listWebcams(): Promise<WebcamSource[]> {
    const result = await this.command<RawListWebcams>('list-webcam', 'GET');
    return mapWebcams(result, this.base);
  }

  /** Turn a named light on/off (cross-platform via OE's set-light). */
  setLight(name: string, on: boolean): Promise<void> {
    return this.commandVoid('set-light', 'POST', { Name: name, On: on });
  }

  /**
   * The CC2's combo / Centauri Filament System slots (MQTT method 2005). Sent
   * through OE's raw `send-command` passthrough — a read-only query, so it's
   * safe during a print. Returns `null` if the printer didn't reply or has no
   * combo unit (e.g. on non-CC2 platforms, which don't speak this protocol).
   */
  async getCanvasInfo(): Promise<RawCanvasResult | null> {
    const result = await this.command<RawSendCommandResult>('send-command', 'POST', {
      TransportType: 'mqtt',
      Request: { Method: 2005, Params: {} },
    });
    if (!result?.ResponseReceived || result.IsError) return null;
    return (result.Response?.Payload?.result as RawCanvasResult) ?? null;
  }

  pause(): Promise<void> {
    return this.commandVoid('pause', 'POST');
  }

  resume(): Promise<void> {
    return this.commandVoid('resume', 'POST');
  }

  cancel(): Promise<void> {
    return this.commandVoid('cancel', 'POST');
  }

  /** Set one or more heater targets. Throws if no heater is given or limits are exceeded. */
  setTemp(args: SetTempArgs): Promise<void> {
    if (args.bedC === undefined && args.toolC === undefined && args.chamberC === undefined) {
      throw new Error('setTemp: at least one of bedC/toolC/chamberC is required');
    }
    if (args.bedC !== undefined && args.bedC > TEMP_LIMITS.bedC) {
      throw new Error(`setTemp: bedC exceeds ${TEMP_LIMITS.bedC}°C`);
    }
    if (args.chamberC !== undefined && args.chamberC > TEMP_LIMITS.chamberC) {
      throw new Error(`setTemp: chamberC exceeds ${TEMP_LIMITS.chamberC}°C`);
    }
    if (args.toolC !== undefined && args.toolC > TEMP_LIMITS.toolC) {
      throw new Error(`setTemp: toolC exceeds ${TEMP_LIMITS.toolC}°C`);
    }
    return this.commandVoid('set-temp', 'POST', {
      BedC: args.bedC,
      ChamberC: args.chamberC,
      ToolC: args.toolC,
      ToolNumber: args.toolNumber,
    });
  }

  // --- motion ---

  /** Home all axes. The plugin homes everything (no per-axis selection). */
  home(): Promise<void> {
    return this.commandVoid('home', 'POST');
  }

  /**
   * Jog one axis by a signed distance in millimetres (relative move). Negative
   * distances move toward the origin. Feedrate is chosen by the plugin/firmware.
   */
  moveAxis(axis: 'X' | 'Y' | 'Z', distanceMm: number): Promise<void> {
    return this.commandVoid('move-axis', 'POST', { Axis: axis, DistanceMm: distanceMm });
  }

  /**
   * Extrude (positive distance) or retract (negative) on a tool, in millimetres.
   * The firmware refuses to extrude below the hotend's min-extrude temperature.
   */
  extrude(extruder: number, distanceMm: number): Promise<void> {
    return this.commandVoid('extrude', 'POST', { Extruder: extruder, DistanceMm: distanceMm });
  }

  // --- internals ---

  private async commandVoid(path: string, method: 'GET' | 'POST', body?: unknown): Promise<void> {
    await this.command(path, method, body);
  }

  private async command<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const url = `${this.base}${COMMAND_PREFIX}/${path}`;
    const headers: Record<string, string> = {};
    if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw OctoEverywhereError.transport(e instanceof Error ? e.message : 'Network request failed');
    }

    // Relay-level failures come back as a 6xx HTTP status.
    if (isRelayErrorStatus(res.status)) {
      throw OctoEverywhereError.relay(res.status);
    }
    if (!res.ok) {
      throw OctoEverywhereError.transport(`HTTP ${res.status}`);
    }

    let envelope: OeEnvelope<T>;
    try {
      envelope = (await res.json()) as OeEnvelope<T>;
    } catch {
      throw OctoEverywhereError.transport('Invalid JSON in response');
    }

    // Command-level failures are carried inside the envelope's Status.
    if (envelope.Status !== 200) {
      throw OctoEverywhereError.command(envelope.Status, envelope.Error);
    }
    return envelope.Result as T;
  }
}
