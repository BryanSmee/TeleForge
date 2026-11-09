import type { PrinterControl } from '../control';
import type { PrinterState, WebcamSource } from '../model/printer';
import { TEMP_LIMITS, type SetTempArgs } from '../octoeverywhere/client';
import type { RawCanvasResult } from '../octoeverywhere/raw';
import { CC2_LIGHT_NAME, mapCc2Status } from './mapStatus';
import { MqttConnectError, MqttConnection, type WebSocketFactory } from './mqttSocket';
import { Cc2Method, type RawCc2Attributes, type RawCc2Status } from './raw';

/** The CC2's MQTT-over-WebSocket port (1883 is plain TCP, which React Native can't open). */
export const CC2_MQTT_WS_PORT = 9001;
/** MQTT password when no access code is set on the printer. */
export const CC2_DEFAULT_ACCESS_CODE = '123456';

export type Cc2ErrorKind = 'auth' | 'too-many-clients' | 'no-serial' | 'timeout' | 'closed' | 'command' | 'connect';

export class Cc2Error extends Error {
  readonly kind: Cc2ErrorKind;
  constructor(kind: Cc2ErrorKind, message: string) {
    super(message);
    this.name = 'Cc2Error';
    this.kind = kind;
  }
}

export interface Cc2LanClientOptions {
  /** The printer's LAN address, e.g. `http://192.168.1.240`; only its host is used. */
  lanUrl: string;
  /** The access code set on the printer, if any (else the default password). */
  accessCode?: string;
  /** The printer's serial number, when already known (it's part of every topic). */
  serialNumber?: string;
  /**
   * Another way to learn the serial number (e.g. method 1001 through the OE
   * relay), raced against reading it from the broker's own traffic.
   */
  lookupSerial?: () => Promise<string | undefined>;
  webSocket?: WebSocketFactory;
  /** Max time for the socket to open: an unreachable LAN fails this fast. */
  openTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Close the session when nothing used the client for this long. */
  idleMs?: number;
}

const HEARTBEAT_MS = 10_000;
/** No message (status or PONG) for this long means the printer is gone. */
const STALE_MS = 30_000;
const SERIAL_TIMEOUT_MS = 10_000;
const REGISTER_TIMEOUT_MS = 5_000;
/** Ask for a full status after this many gaps in the status sequence. */
const MAX_STATUS_GAPS = 5;

/** The host part of an http(s) URL (`http://192.168.1.240:80/x` → `192.168.1.240`). */
export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url.trim());
  if (!m) throw new Error(`Not a URL: ${url}`);
  return m[1];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target: Record<string, unknown>, delta: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(delta)) {
    const existing = target[k];
    if (isRecord(v) && isRecord(existing)) deepMerge(existing, v);
    else target[k] = isRecord(v) ? cloneRecord(v) : v;
  }
}

function cloneRecord(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  deepMerge(out, v);
  return out;
}

function parseJson(payload: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(payload) as unknown;
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function newClientId(): string {
  // "0cli" + random hex, 10 characters: the format Elegoo's own web page uses.
  let id = '0cli';
  while (id.length < 10) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

interface Pending {
  resolve: (result: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One registered MQTT session with the printer. */
class Session {
  status: Record<string, unknown> = {};
  attrs?: RawCc2Attributes;
  lastHeardAt = Date.now();
  private nextId = Math.floor(Math.random() * 100_000) + 1000;
  private readonly pending = new Map<number, Pending>();
  private lastStatusId?: number;
  private statusGaps = 0;
  private readonly requestTopic: string;
  readonly statusTopic: string;
  readonly responseTopic: string;

  constructor(
    readonly conn: MqttConnection,
    readonly serial: string,
    readonly clientId: string,
    private readonly requestTimeoutMs: number,
  ) {
    this.requestTopic = `elegoo/${serial}/${clientId}/api_request`;
    this.statusTopic = `elegoo/${serial}/api_status`;
    this.responseTopic = `elegoo/${serial}/${clientId}/api_response`;
    conn.onClose(() => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Cc2Error('closed', 'Connection to the printer closed'));
      }
      this.pending.clear();
    });
  }

  get isStale(): boolean {
    return Date.now() - this.lastHeardAt > STALE_MS;
  }

  ping(): void {
    this.conn.publish(this.requestTopic, JSON.stringify({ type: 'PING' }));
  }

  /** Send a method and wait for its reply's `result` (rejects on a non-zero `error_code`). */
  request(method: number, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Cc2Error('timeout', 'The printer did not answer in time'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.conn.publish(this.requestTopic, JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Cc2Error('closed', e instanceof Error ? e.message : 'Connection closed'));
      }
    });
  }

  /** Send a method without waiting for its reply. */
  send(method: number, params: Record<string, unknown> = {}): void {
    this.conn.publish(this.requestTopic, JSON.stringify({ id: this.nextId++, method, params }));
  }

  handleStatus(msg: Record<string, unknown>): void {
    this.lastHeardAt = Date.now();
    if (msg.method !== Cc2Method.ON_PRINTER_STATUS) return;
    // Deltas are numbered; after repeated gaps, resync from a full status.
    const id = typeof msg.id === 'number' ? msg.id : undefined;
    if (id !== undefined) {
      if (this.lastStatusId !== undefined && id !== this.lastStatusId + 1) {
        if (++this.statusGaps >= MAX_STATUS_GAPS) {
          this.statusGaps = 0;
          this.send(Cc2Method.GET_STATUS);
        }
      } else {
        this.statusGaps = 0;
      }
      this.lastStatusId = id;
    }
    if (isRecord(msg.result)) deepMerge(this.status, msg.result);
  }

  handleResponse(msg: Record<string, unknown>): void {
    this.lastHeardAt = Date.now();
    if (msg.type === 'PONG') return;
    const result = isRecord(msg.result) ? msg.result : {};
    const ok = (typeof result.error_code !== 'number' || result.error_code === 0) && !isRecord(msg.error);
    // A full status (asked by us or after gaps) replaces what the deltas built.
    if (ok && msg.method === Cc2Method.GET_STATUS) {
      this.status = {};
      deepMerge(this.status, result);
    }
    if (ok && msg.method === Cc2Method.GET_ATTRIBUTES) this.attrs = result as RawCc2Attributes;

    const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id as number);
    if (ok) p.resolve(result);
    else
      p.reject(
        new Cc2Error(
          'command',
          typeof result.error_code === 'number'
            ? `The printer refused the command (error ${result.error_code})`
            : 'The printer refused the command',
        ),
      );
  }
}

/**
 * The Elegoo Centauri Carbon 2 on the LAN, over its own MQTT broker (MQTT over
 * WebSocket on port 9001) instead of the OctoEverywhere relay. The protocol
 * and the topics/methods used are documented in docs/spike-findings.md.
 *
 * One session is opened on first use and kept: the printer pushes status
 * deltas, merged here, so `getStatus` answers from memory with no round trip.
 * A heartbeat keeps the registration alive; the session closes when the
 * printer stops answering or nothing used the client for `idleMs`, and the
 * next call opens a new one. The printer accepts only a few clients at once.
 */
export class Cc2LanClient implements PrinterControl {
  readonly host: string;
  private readonly opts: Cc2LanClientOptions;
  private serial?: string;
  private session?: Promise<Session>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastUsedAt = Date.now();

  constructor(opts: Cc2LanClientOptions) {
    this.opts = opts;
    this.host = hostOf(opts.lanUrl);
    this.serial = opts.serialNumber;
  }

  /** The printer's serial number, once a session learned it. */
  get serialNumber(): string | undefined {
    return this.serial;
  }

  /**
   * Whether the printer answers on the LAN right now: opens (or reuses) the
   * session. Used to pick the LAN over the relay.
   */
  async probe(): Promise<boolean> {
    try {
      await this.activeSession();
      return true;
    } catch {
      return false;
    }
  }

  /** Close the session now (the next call opens a new one). */
  close(): void {
    const session = this.session;
    this.session = undefined;
    this.stopHeartbeat();
    session?.then((s) => s.conn.close()).catch(() => {});
  }

  async getStatus(now: number = Date.now()): Promise<PrinterState> {
    const s = await this.activeSession();
    return mapCc2Status(s.status as RawCc2Status, s.attrs, now);
  }

  /** The camera's MJPEG stream on the printer (port 8080); asks the printer to turn it on. */
  async listWebcams(): Promise<WebcamSource[]> {
    this.activeSession()
      .then((s) => s.send(Cc2Method.VIDEO_STREAM, { enable: true }))
      .catch(() => {});
    return [
      {
        name: 'Elegoo CC2 Cam',
        kind: 'mjpeg',
        streamUrl: `http://${this.host}:8080/?action=stream`,
        flipH: false,
        flipV: false,
        rotation: 0,
      },
    ];
  }

  async setLight(name: string, on: boolean): Promise<void> {
    if (name !== CC2_LIGHT_NAME) throw new Error(`Unknown light: ${name}`);
    // Some firmware reads `brightness`, Elegoo's own page sends `power`: send both, as OE does.
    await this.call(Cc2Method.SET_LIGHT, { brightness: on ? 255 : 0, power: on ? 1 : 0 });
  }

  async pause(): Promise<void> {
    await this.call(Cc2Method.PAUSE_PRINT);
  }

  async resume(): Promise<void> {
    await this.call(Cc2Method.RESUME_PRINT);
  }

  async cancel(): Promise<void> {
    await this.call(Cc2Method.STOP_PRINT);
  }

  /** Same limits as through OE; the CC2 can't set its chamber temperature. */
  async setTemp(args: SetTempArgs): Promise<void> {
    if (args.chamberC !== undefined) throw new Error('setTemp: the CC2 cannot set the chamber temperature');
    if (args.bedC === undefined && args.toolC === undefined) {
      throw new Error('setTemp: at least one of bedC/toolC is required');
    }
    if (args.bedC !== undefined && args.bedC > TEMP_LIMITS.bedC) {
      throw new Error(`setTemp: bedC exceeds ${TEMP_LIMITS.bedC}°C`);
    }
    if (args.toolC !== undefined && args.toolC > TEMP_LIMITS.toolC) {
      throw new Error(`setTemp: toolC exceeds ${TEMP_LIMITS.toolC}°C`);
    }
    const params: Record<string, number> = {};
    if (args.toolC !== undefined) params.extruder = args.toolC;
    if (args.bedC !== undefined) params.heater_bed = args.bedC;
    await this.call(Cc2Method.SET_TEMPERATURE, params);
  }

  async home(): Promise<void> {
    await this.call(Cc2Method.HOME_AXES, { homed_axes: 'xyz' });
  }

  async moveAxis(axis: 'X' | 'Y' | 'Z', distanceMm: number): Promise<void> {
    await this.call(Cc2Method.MOVE_AXES, { axes: axis.toLowerCase(), distance: distanceMm });
  }

  /** The CC2 protocol has no extrude method (OE doesn't support it on the CC2 either). */
  async extrude(): Promise<void> {
    throw new Error('Extruding is not supported on the CC2');
  }

  /** The combo / CFS slots (method 2005), as through OE's passthrough; null without a unit. */
  async getCanvasInfo(): Promise<RawCanvasResult | null> {
    const result = await this.call(Cc2Method.GET_CANVAS_STATUS);
    return isRecord(result.canvas_info) ? (result as RawCanvasResult) : null;
  }

  // --- internals ---

  private async call(method: number, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const s = await this.activeSession();
    return s.request(method, params);
  }

  /** The open session (opening one if needed); a silent one is dropped and reported. */
  private async activeSession(): Promise<Session> {
    this.lastUsedAt = Date.now();
    if (!this.session) {
      const opening = this.openSession();
      this.session = opening;
      opening.catch(() => {
        if (this.session === opening) this.session = undefined;
      });
    }
    const current = this.session;
    const s = await current;
    if (s.isStale || !s.conn.isOpen) {
      if (this.session === current) this.close();
      throw new Cc2Error('closed', 'The printer stopped answering on the LAN');
    }
    return s;
  }

  private async openSession(): Promise<Session> {
    const clientId = newClientId();
    let conn: MqttConnection;
    try {
      conn = await MqttConnection.connect({
        url: `ws://${this.host}:${CC2_MQTT_WS_PORT}`,
        clientId,
        username: 'elegoo',
        password: this.opts.accessCode || CC2_DEFAULT_ACCESS_CODE,
        openTimeoutMs: this.opts.openTimeoutMs,
        webSocket: this.opts.webSocket,
      });
    } catch (e) {
      if (e instanceof MqttConnectError && e.auth) {
        throw new Cc2Error('auth', 'The printer refused the access code');
      }
      throw new Cc2Error('connect', e instanceof Error ? e.message : 'Connection failed');
    }

    // Until registered, route messages through whatever step is waiting.
    let onMessage: (topic: string, payload: string) => void = () => {};
    conn.onMessage((topic, payload) => onMessage(topic, payload));

    try {
      const serial = this.serial ?? (await this.discoverSerial(conn, (h) => (onMessage = h)));
      this.serial = serial;

      // Register this client id: required before any request is answered.
      const registerId = `${clientId}_req`;
      const registerTopic = `elegoo/${serial}/${registerId}/register_response`;
      let registerTimer: ReturnType<typeof setTimeout> | undefined;
      const registered = new Promise<Record<string, unknown> | undefined>((resolve) => {
        onMessage = (topic, payload) => {
          if (topic === registerTopic) resolve(parseJson(payload));
        };
        registerTimer = setTimeout(() => resolve(undefined), REGISTER_TIMEOUT_MS);
      });
      await conn.subscribe(registerTopic);
      conn.publish(`elegoo/${serial}/api_register`, JSON.stringify({ client_id: clientId, request_id: registerId }));
      const reply = await registered;
      clearTimeout(registerTimer);
      conn.unsubscribe(registerTopic).catch(() => {});
      const error = String(reply?.error ?? 'no reply').toLowerCase();
      if (error !== 'ok') {
        if (error.includes('too many')) {
          throw new Cc2Error('too-many-clients', 'Too many clients are connected to the printer');
        }
        throw new Cc2Error('connect', `The printer refused the registration (${error})`);
      }

      const session = new Session(conn, serial, clientId, this.opts.requestTimeoutMs ?? 10_000);
      onMessage = (topic, payload) => {
        const msg = parseJson(payload);
        if (!msg) return;
        if (topic === session.statusTopic) session.handleStatus(msg);
        else if (topic === session.responseTopic) session.handleResponse(msg);
      };
      await Promise.all([conn.subscribe(session.statusTopic), conn.subscribe(session.responseTopic)]);

      // Full status first (deltas only carry changes), attributes for the version.
      await session.request(Cc2Method.GET_STATUS);
      await session.request(Cc2Method.GET_ATTRIBUTES).catch(() => undefined);
      this.startHeartbeat(session);
      conn.onClose(() => {
        void this.session?.then((s) => {
          if (s === session) {
            this.session = undefined;
            this.stopHeartbeat();
          }
        });
      });
      return session;
    } catch (e) {
      conn.close();
      throw e instanceof Cc2Error ? e : new Cc2Error('connect', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Every topic carries the serial number (`elegoo/<sn>/…`): read it from the
   * first message on the broker (status pushes, other clients' heartbeats),
   * racing the optional `lookupSerial`.
   */
  private async discoverSerial(
    conn: MqttConnection,
    setHandler: (h: (topic: string, payload: string) => void) => void,
  ): Promise<string> {
    const serial = await new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), SERIAL_TIMEOUT_MS);
      const done = (sn: string | undefined) => {
        if (!sn) return;
        clearTimeout(timer);
        resolve(sn);
      };
      setHandler((topic) => done(/^elegoo\/([^/]+)\//.exec(topic)?.[1]));
      conn.subscribe('elegoo/#').catch(() => {});
      this.opts.lookupSerial?.().then(done, () => {});
    });
    setHandler(() => {});
    await conn.unsubscribe('elegoo/#').catch(() => {});
    if (!serial) throw new Cc2Error('no-serial', "Couldn't learn the printer's serial number");
    return serial;
  }

  private startHeartbeat(session: Session): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const idle = Date.now() - this.lastUsedAt > (this.opts.idleMs ?? 60_000);
      if (idle || session.isStale || !session.conn.isOpen) {
        this.close();
        return;
      }
      try {
        session.ping();
      } catch {
        this.close();
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
