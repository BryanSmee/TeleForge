/**
 * Just enough MQTT 3.1.1 to talk to the CC2's broker: CONNECT, SUBSCRIBE,
 * UNSUBSCRIBE, QoS 0 PUBLISH and DISCONNECT out; CONNACK, SUBACK, UNSUBACK,
 * PUBLISH and PINGRESP in. Pure functions over byte arrays, so they run (and
 * are tested) without a socket.
 */

export const PacketType = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  UNSUBSCRIBE: 10,
  UNSUBACK: 11,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
} as const;

export type IncomingPacket =
  | { type: 'connack'; returnCode: number }
  | { type: 'publish'; topic: string; payload: string; qos: number; packetId?: number }
  | { type: 'suback'; packetId: number; returnCodes: number[] }
  | { type: 'unsuback'; packetId: number }
  | { type: 'pingresp' }
  | { type: 'other'; packetType: number };

// --- UTF-8 (Hermes' TextDecoder support varies by version, so do it by hand) ---

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c: number;
    if (b < 0x80) {
      c = b;
      i += 1;
    } else if (b >= 0xf0) {
      c = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    } else if (b >= 0xe0) {
      c = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      c = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    }
    s += String.fromCodePoint(c);
  }
  return s;
}

// --- encoding ---

function lengthPrefixed(bytes: Uint8Array): number[] {
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function str(s: string): number[] {
  return lengthPrefixed(utf8Encode(s));
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(firstByte: number, body: number[] | Uint8Array): Uint8Array {
  const header = [firstByte, ...remainingLength(body.length)];
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

export function encodeConnect(opts: {
  clientId: string;
  username?: string;
  password?: string;
  keepAliveSec: number;
}): Uint8Array {
  // Clean session; username/password flags only when given.
  let flags = 0x02;
  if (opts.username !== undefined) flags |= 0x80;
  if (opts.password !== undefined) flags |= 0x40;
  const body = [
    ...str('MQTT'),
    4, // protocol level 3.1.1
    flags,
    opts.keepAliveSec >> 8,
    opts.keepAliveSec & 0xff,
    ...str(opts.clientId),
    ...(opts.username !== undefined ? str(opts.username) : []),
    ...(opts.password !== undefined ? str(opts.password) : []),
  ];
  return packet(PacketType.CONNECT << 4, body);
}

export function encodePublish(topic: string, payload: string): Uint8Array {
  const topicBytes = str(topic);
  const payloadBytes = utf8Encode(payload);
  const body = new Uint8Array(topicBytes.length + payloadBytes.length);
  body.set(topicBytes, 0);
  body.set(payloadBytes, topicBytes.length);
  return packet(PacketType.PUBLISH << 4, body);
}

export function encodeSubscribe(packetId: number, topic: string): Uint8Array {
  return packet((PacketType.SUBSCRIBE << 4) | 0x02, [packetId >> 8, packetId & 0xff, ...str(topic), 0]);
}

export function encodeUnsubscribe(packetId: number, topic: string): Uint8Array {
  return packet((PacketType.UNSUBSCRIBE << 4) | 0x02, [packetId >> 8, packetId & 0xff, ...str(topic)]);
}

export function encodePuback(packetId: number): Uint8Array {
  return packet(PacketType.PUBACK << 4, [packetId >> 8, packetId & 0xff]);
}

export function encodePingreq(): Uint8Array {
  return packet(PacketType.PINGREQ << 4, []);
}

export function encodeDisconnect(): Uint8Array {
  return packet(PacketType.DISCONNECT << 4, []);
}

// --- decoding ---

function decodePacket(firstByte: number, body: Uint8Array): IncomingPacket {
  const type = firstByte >> 4;
  const u16 = (i: number) => (body[i] << 8) | body[i + 1];
  switch (type) {
    case PacketType.CONNACK:
      return { type: 'connack', returnCode: body[1] };
    case PacketType.PUBLISH: {
      const qos = (firstByte >> 1) & 0x03;
      const topicLen = u16(0);
      const topic = utf8Decode(body.subarray(2, 2 + topicLen));
      let i = 2 + topicLen;
      let packetId: number | undefined;
      if (qos > 0) {
        packetId = u16(i);
        i += 2;
      }
      return { type: 'publish', topic, payload: utf8Decode(body.subarray(i)), qos, packetId };
    }
    case PacketType.SUBACK:
      return { type: 'suback', packetId: u16(0), returnCodes: Array.from(body.subarray(2)) };
    case PacketType.UNSUBACK:
      return { type: 'unsuback', packetId: u16(0) };
    case PacketType.PINGRESP:
      return { type: 'pingresp' };
    default:
      return { type: 'other', packetType: type };
  }
}

/**
 * Reassembles MQTT packets from WebSocket frames: a frame may hold part of a
 * packet or several packets, so bytes are buffered until a packet is complete.
 */
export class PacketReader {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): IncomingPacket[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const packets: IncomingPacket[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      // Remaining length: up to 4 bytes, 7 bits each.
      let length = 0;
      let multiplier = 1;
      let i = 1;
      let complete = false;
      for (; i < this.buffer.length && i <= 4; i++) {
        const byte = this.buffer[i];
        length += (byte & 0x7f) * multiplier;
        multiplier *= 128;
        if ((byte & 0x80) === 0) {
          complete = true;
          break;
        }
      }
      if (!complete) break;
      const start = i + 1;
      if (this.buffer.length < start + length) break;
      packets.push(decodePacket(this.buffer[0], this.buffer.subarray(start, start + length)));
      this.buffer = this.buffer.slice(start + length);
    }
    return packets;
  }
}
