import { describe, it, expect } from '@jest/globals';
import {
  PacketReader,
  encodeConnect,
  encodePublish,
  encodeSubscribe,
  utf8Decode,
  utf8Encode,
} from '../mqttPackets';

describe('MQTT packets', () => {
  it('encodes CONNECT with clean session, credentials and keep-alive', () => {
    const bytes = encodeConnect({ clientId: 'c1', username: 'u', password: 'p', keepAliveSec: 60 });
    expect(Array.from(bytes)).toEqual([
      0x10, 20, // CONNECT, remaining length
      0, 4, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
      4, // 3.1.1
      0xc2, // username + password + clean session
      0, 60,
      0, 2, 0x63, 0x31, // "c1"
      0, 1, 0x75, // "u"
      0, 1, 0x70, // "p"
    ]);
  });

  it('encodes SUBSCRIBE at QoS 0 with the reserved flags', () => {
    expect(Array.from(encodeSubscribe(7, 'a/b'))).toEqual([0x82, 8, 0, 7, 0, 3, 0x61, 0x2f, 0x62, 0]);
  });

  it('reads back a PUBLISH, including multi-byte lengths and UTF-8', () => {
    const payload = JSON.stringify({ filename: 'pièce_🚀.gcode', pad: 'x'.repeat(300) });
    const [p] = new PacketReader().push(encodePublish('elegoo/SN/api_status', payload));
    expect(p).toEqual({ type: 'publish', topic: 'elegoo/SN/api_status', payload, qos: 0, packetId: undefined });
  });

  it('reassembles packets split across frames and splits coalesced ones', () => {
    const a = encodePublish('t/a', '{"a":1}');
    const b = encodePublish('t/b', '{"b":2}');
    const joined = new Uint8Array([...a, ...b, 0xd0]); // + the first byte of a PINGRESP
    const reader = new PacketReader();
    expect(reader.push(joined.subarray(0, 4))).toEqual([]);
    const packets = reader.push(joined.subarray(4));
    expect(packets.map((p) => (p.type === 'publish' ? p.topic : p.type))).toEqual(['t/a', 't/b']);
    expect(reader.push(Uint8Array.from([0]))).toEqual([{ type: 'pingresp' }]);
  });

  it('decodes CONNACK and SUBACK', () => {
    const packets = new PacketReader().push(Uint8Array.from([0x20, 2, 0, 5, 0x90, 3, 0, 9, 0x80]));
    expect(packets).toEqual([
      { type: 'connack', returnCode: 5 },
      { type: 'suback', packetId: 9, returnCodes: [0x80] },
    ]);
  });

  it('round-trips UTF-8', () => {
    for (const s of ['plain', 'Température 25°C', '日本語', '🚀 rocket']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });
});
