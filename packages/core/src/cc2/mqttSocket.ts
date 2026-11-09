import {
  PacketReader,
  encodeConnect,
  encodeDisconnect,
  encodePuback,
  encodePublish,
  encodeSubscribe,
  encodeUnsubscribe,
  type IncomingPacket,
} from './mqttPackets';

/** The subset of the WHATWG/React Native WebSocket the MQTT connection uses. */
export interface WebSocketLike {
  binaryType: string;
  send(data: ArrayBuffer): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export const defaultWebSocketFactory: WebSocketFactory = (url, protocols) => {
  const Ctor = (globalThis as { WebSocket?: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;
  if (!Ctor) throw new Error('No WebSocket implementation available');
  return new Ctor(url, protocols);
};

/** CONNACK return codes 4/5: bad username or password / not authorized. */
const AUTH_RETURN_CODES = new Set([4, 5]);

export class MqttConnectError extends Error {
  /** The broker refused the credentials (wrong access code). */
  readonly auth: boolean;
  constructor(message: string, auth = false) {
    super(message);
    this.name = 'MqttConnectError';
    this.auth = auth;
  }
}

export interface MqttConnectOptions {
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  keepAliveSec?: number;
  /** Max time for the socket to open (fails fast off the LAN). */
  openTimeoutMs?: number;
  /** Max time for the broker's CONNACK once the socket is open. */
  connackTimeoutMs?: number;
  webSocket?: WebSocketFactory;
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * One MQTT session over a WebSocket (`mqtt` subprotocol). QoS 0 only: the CC2
 * protocol correlates its own requests and replies, so delivery guarantees
 * would buy nothing.
 */
export class MqttConnection {
  private readonly ws: WebSocketLike;
  private readonly reader = new PacketReader();
  private nextPacketId = 1;
  private readonly acks = new Map<number, (codes: number[]) => void>();
  private messageHandler?: (topic: string, payload: string) => void;
  private closeHandlers: (() => void)[] = [];
  private closed = false;

  private constructor(ws: WebSocketLike) {
    this.ws = ws;
  }

  /** Open the socket and complete the MQTT handshake, or reject. */
  static connect(opts: MqttConnectOptions): Promise<MqttConnection> {
    const factory = opts.webSocket ?? defaultWebSocketFactory;
    return new Promise((resolve, reject) => {
      let ws: WebSocketLike;
      try {
        ws = factory(opts.url, ['mqtt']);
      } catch (e) {
        reject(new MqttConnectError(e instanceof Error ? e.message : 'WebSocket failed'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      const conn = new MqttConnection(ws);
      let settled = false;
      const fail = (message: string, auth = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.close();
        reject(new MqttConnectError(message, auth));
      };
      let timer = setTimeout(() => fail('Timed out opening the connection'), opts.openTimeoutMs ?? 1500);

      ws.onopen = () => {
        clearTimeout(timer);
        timer = setTimeout(() => fail('Timed out waiting for the broker'), opts.connackTimeoutMs ?? 5000);
        conn.send(
          encodeConnect({
            clientId: opts.clientId,
            username: opts.username,
            password: opts.password,
            keepAliveSec: opts.keepAliveSec ?? 60,
          }),
        );
      };
      ws.onerror = () => fail('Connection failed');
      ws.onclose = () => {
        fail('Connection closed');
        conn.handleClose();
      };
      ws.onmessage = (ev) => {
        const bytes = toBytes(ev.data);
        if (!bytes) return;
        for (const p of conn.reader.push(bytes)) {
          if (!settled && p.type === 'connack') {
            if (p.returnCode !== 0) {
              fail(`Broker refused the connection (${p.returnCode})`, AUTH_RETURN_CODES.has(p.returnCode));
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(conn);
          } else {
            conn.handlePacket(p);
          }
        }
      };
    });
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  onMessage(handler: (topic: string, payload: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    if (this.closed) handler();
    else this.closeHandlers.push(handler);
  }

  publish(topic: string, payload: string): void {
    this.send(encodePublish(topic, payload));
  }

  /** Subscribe at QoS 0; resolves on SUBACK, rejects if the broker refuses the filter. */
  subscribe(topic: string, timeoutMs = 5000): Promise<void> {
    const id = this.packetId();
    return this.awaitAck(id, encodeSubscribe(id, topic), timeoutMs).then((codes) => {
      if (codes.some((c) => c === 0x80)) throw new Error(`Subscription refused: ${topic}`);
    });
  }

  unsubscribe(topic: string, timeoutMs = 5000): Promise<void> {
    const id = this.packetId();
    return this.awaitAck(id, encodeUnsubscribe(id, topic), timeoutMs).then(() => undefined);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.send(encodeDisconnect());
    } catch {
      // The socket may not be open yet; closing it is enough.
    }
    try {
      this.ws.close();
    } catch {
      // Already closed.
    }
    this.handleClose();
  }

  // --- internals ---

  private packetId(): number {
    const id = this.nextPacketId;
    this.nextPacketId = id >= 0xffff ? 1 : id + 1;
    return id;
  }

  private send(bytes: Uint8Array): void {
    if (this.closed) throw new Error('Connection closed');
    this.ws.send(toArrayBuffer(bytes));
  }

  private awaitAck(id: number, bytes: Uint8Array, timeoutMs: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        reject(new Error('Timed out waiting for the broker'));
      }, timeoutMs);
      this.acks.set(id, (codes) => {
        clearTimeout(timer);
        this.acks.delete(id);
        if (this.closed) reject(new Error('Connection closed'));
        else resolve(codes);
      });
      try {
        this.send(bytes);
      } catch (e) {
        clearTimeout(timer);
        this.acks.delete(id);
        reject(e);
      }
    });
  }

  private handlePacket(p: IncomingPacket): void {
    switch (p.type) {
      case 'publish':
        if (p.qos === 1 && p.packetId !== undefined) this.send(encodePuback(p.packetId));
        this.messageHandler?.(p.topic, p.payload);
        break;
      case 'suback':
        this.acks.get(p.packetId)?.(p.returnCodes);
        break;
      case 'unsuback':
        this.acks.get(p.packetId)?.([]);
        break;
      default:
        break;
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const ack of [...this.acks.values()]) ack([]);
    const handlers = this.closeHandlers;
    this.closeHandlers = [];
    handlers.forEach((h) => h());
  }
}
