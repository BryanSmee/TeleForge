import { PacketType, encodePublish, utf8Decode } from '../mqttPackets';
import type { WebSocketFactory, WebSocketLike } from '../mqttSocket';

// A fake CC2: an MQTT broker behind a fake WebSocket, answering the way the
// printer does (register, PING/PONG, method replies, status pushes).

function u16(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function readStr(b: Uint8Array, i: number): [string, number] {
  const len = u16(b, i);
  return [utf8Decode(b.subarray(i + 2, i + 2 + len)), i + 2 + len];
}

/** Decode one client → broker packet (the client sends one per frame). */
function parseClientPacket(bytes: Uint8Array) {
  const type = bytes[0] >> 4;
  let i = 1;
  while (bytes[i] & 0x80) i++;
  const body = bytes.subarray(i + 1);
  switch (type) {
    case PacketType.CONNECT: {
      let [, p] = readStr(body, 0); // "MQTT"
      p += 1; // level
      const flags = body[p];
      p += 3; // flags + keepalive
      const [clientId, p2] = readStr(body, p);
      p = p2;
      let username: string | undefined;
      let password: string | undefined;
      if (flags & 0x80) [username, p] = readStr(body, p);
      if (flags & 0x40) [password, p] = readStr(body, p);
      return { type: 'connect' as const, clientId, username, password };
    }
    case PacketType.SUBSCRIBE:
      return { type: 'subscribe' as const, packetId: u16(body, 0), topic: readStr(body, 2)[0] };
    case PacketType.UNSUBSCRIBE:
      return { type: 'unsubscribe' as const, packetId: u16(body, 0), topic: readStr(body, 2)[0] };
    case PacketType.PUBLISH: {
      const [topic, p] = readStr(body, 0);
      return { type: 'publish' as const, topic, payload: utf8Decode(body.subarray(p)) };
    }
    default:
      return { type: 'other' as const, packetType: type };
  }
}

function matches(filter: string, topic: string): boolean {
  if (filter.endsWith('/#')) return topic.startsWith(filter.slice(0, -1));
  const f = filter.split('/');
  const t = topic.split('/');
  return f.length === t.length && f.every((part, i) => part === '+' || part === t[i]);
}

export interface FakeBrokerOptions {
  serial?: string;
  accessCode?: string;
  /** Refuse wildcard subscriptions (the serial must then come from elsewhere). */
  refuseWildcard?: boolean;
  /** Registration reply's `error` (default "ok"). */
  registerError?: string;
  status?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export class FakeBroker {
  readonly serial: string;
  readonly opts: FakeBrokerOptions;
  /** Every `{ id, method, params }` request the client sent, in order. */
  readonly requests: { method: number; params: Record<string, unknown> }[] = [];
  readonly urls: string[] = [];
  /** Replies by method; default `{ error_code: 0 }`. */
  readonly replies = new Map<number, Record<string, unknown>>();
  /** When true the socket can't be opened (printer unreachable). */
  unreachable = false;
  /** When true the printer stops answering (but keeps the socket open). */
  silent = false;
  sockets: FakeSocket[] = [];
  pings = 0;
  registerPayloads: Record<string, unknown>[] = [];

  constructor(opts: FakeBrokerOptions = {}) {
    this.opts = opts;
    this.serial = opts.serial ?? 'CC2SN0001';
  }

  readonly factory: WebSocketFactory = (url) => {
    this.urls.push(url);
    const ws = new FakeSocket(this);
    this.sockets.push(ws);
    return ws;
  };

  /** Push a status delta on `api_status` to every connected client. */
  pushStatus(id: number, result: Record<string, unknown>): void {
    for (const s of this.sockets) s.deliver(`elegoo/${this.serial}/api_status`, { id, method: 6000, result });
  }

  handle(socket: FakeSocket, packet: ReturnType<typeof parseClientPacket>): void {
    if (this.silent) return;
    switch (packet.type) {
      case 'connect': {
        const ok = packet.username === 'elegoo' && packet.password === (this.opts.accessCode ?? '123456');
        socket.reply(Uint8Array.from([0x20, 2, 0, ok ? 0 : 5]));
        break;
      }
      case 'subscribe': {
        const refused = this.opts.refuseWildcard && packet.topic.includes('#');
        if (!refused) socket.subscriptions.push(packet.topic);
        socket.reply(Uint8Array.from([0x90, 3, packet.packetId >> 8, packet.packetId & 0xff, refused ? 0x80 : 0]));
        // The printer pushes statuses all the time: a wildcard subscriber sees one soon.
        if (!refused && packet.topic === 'elegoo/#') {
          socket.deliver(`elegoo/${this.serial}/api_status`, { id: 1, method: 6000, result: {} });
        }
        break;
      }
      case 'unsubscribe':
        socket.subscriptions = socket.subscriptions.filter((t) => t !== packet.topic);
        socket.reply(Uint8Array.from([0xb0, 2, packet.packetId >> 8, packet.packetId & 0xff]));
        break;
      case 'publish': {
        const msg = JSON.parse(packet.payload) as Record<string, unknown>;
        if (packet.topic === `elegoo/${this.serial}/api_register`) {
          this.registerPayloads.push(msg);
          socket.deliver(`elegoo/${this.serial}/${msg.request_id}/register_response`, {
            client_id: msg.client_id,
            error: this.opts.registerError ?? 'ok',
          });
          return;
        }
        const m = /^elegoo\/[^/]+\/([^/]+)\/api_request$/.exec(packet.topic);
        if (!m) return;
        const responseTopic = `elegoo/${this.serial}/${m[1]}/api_response`;
        if (msg.type === 'PING') {
          this.pings++;
          socket.deliver(responseTopic, { type: 'PONG' });
          return;
        }
        const method = msg.method as number;
        this.requests.push({ method, params: (msg.params as Record<string, unknown>) ?? {} });
        let result = this.replies.get(method) ?? { error_code: 0 };
        if (method === 1002) result = { error_code: 0, ...(this.opts.status ?? {}) };
        if (method === 1001) result = { error_code: 0, sn: this.serial, ...(this.opts.attributes ?? {}) };
        socket.deliver(responseTopic, { id: msg.id, method, result });
        break;
      }
      default:
        break;
    }
  }
}

export class FakeSocket implements WebSocketLike {
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  subscriptions: string[] = [];
  closed = false;

  constructor(private readonly broker: FakeBroker) {
    queueMicrotask(() => {
      if (broker.unreachable) return; // never opens: the client's timeout fires
      this.onopen?.({});
    });
  }

  send(data: ArrayBuffer): void {
    if (this.closed) throw new Error('closed');
    const packet = parseClientPacket(new Uint8Array(data));
    queueMicrotask(() => this.broker.handle(this, packet));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({}));
  }

  reply(bytes: Uint8Array): void {
    if (this.closed) return;
    const copy = bytes.slice().buffer;
    queueMicrotask(() => this.onmessage?.({ data: copy }));
  }

  deliver(topic: string, payload: unknown): void {
    if (!this.subscriptions.some((f) => matches(f, topic))) return;
    this.reply(encodePublish(topic, JSON.stringify(payload)));
  }
}
