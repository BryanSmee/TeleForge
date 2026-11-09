#!/usr/bin/env node
// TeleForge spike — check the CC2's own MQTT broker on the LAN the way the app
// does (MQTT over WebSocket, port 9001): connect, learn the serial number from
// the broker's traffic, register, then ask for the attributes (1001) and the
// full status (1002) and print a few status pushes.
//
// READ-ONLY: 1001/1002 are queries, PING is the heartbeat; no command is sent,
// so it is safe during a print. It takes one of the printer's ~4 client slots
// while it runs.
//
// Needs the `mqtt` package:   cd spike && bun add --no-save mqtt
//
//     CC2_IP=192.168.1.240 node spike/probe-cc2-lan.mjs
//     CC2_IP=… CC2_ACCESS_CODE=4242 CC2_SN=… CC2_SECS=20 node spike/probe-cc2-lan.mjs

import mqtt from 'mqtt';

const ip = process.env.CC2_IP;
if (!ip) {
  console.error('Set CC2_IP (the printer’s LAN address).');
  process.exit(1);
}
const secs = Number(process.env.CC2_SECS || 20);
const clientId = `0cli${Math.random().toString(16).slice(2, 8)}`;
let sn = process.env.CC2_SN;

const client = mqtt.connect(`ws://${ip}:9001`, {
  clientId,
  username: 'elegoo',
  password: process.env.CC2_ACCESS_CODE || '123456',
  protocolVersion: 4,
  reconnectPeriod: 0,
  connectTimeout: 5000,
});

let nextId = 1000;
const send = (method) => {
  const msg = { id: nextId++, method, params: {} };
  client.publish(`elegoo/${sn}/${clientId}/api_request`, JSON.stringify(msg));
  console.log(`→ ${method}`);
};

function register() {
  const requestId = `${clientId}_req`;
  client.subscribe(`elegoo/${sn}/${requestId}/register_response`);
  client.publish(`elegoo/${sn}/api_register`, JSON.stringify({ client_id: clientId, request_id: requestId }));
  console.log(`registering ${clientId} with ${sn}…`);
}

client.on('connect', () => {
  console.log(`✅ connected to ws://${ip}:9001 as ${clientId}`);
  if (sn) return register();
  client.subscribe('elegoo/#', (err, granted) => {
    if (err || granted?.[0]?.qos === 128) console.log('⚠️  wildcard refused — set CC2_SN');
  });
});

let pushes = 0;
client.on('message', (topic, payload) => {
  const text = payload.toString('utf8');
  if (!sn) {
    sn = /^elegoo\/([^/]+)\//.exec(topic)?.[1];
    if (!sn) return;
    console.log(`serial number from ${topic}: ${sn}`);
    client.unsubscribe('elegoo/#');
    return register();
  }
  if (topic.endsWith('/register_response')) {
    console.log(`register_response: ${text}`);
    if (!/"error"\s*:\s*"ok"/.test(text)) return client.end(true);
    client.subscribe(`elegoo/${sn}/api_status`);
    client.subscribe(`elegoo/${sn}/${clientId}/api_response`, () => {
      send(1001);
      send(1002);
    });
    setInterval(() => client.publish(`elegoo/${sn}/${clientId}/api_request`, '{"type":"PING"}'), 10_000);
    return;
  }
  if (topic.endsWith('/api_status') && pushes++ >= 5) return;
  console.log(`\n── ${topic}\n${JSON.stringify(JSON.parse(text), null, 2).slice(0, 6000)}`);
});

client.on('error', (e) => console.log('⚠️  error:', e.message));
client.on('close', () => console.log('connection closed'));
setTimeout(() => {
  client.end(true);
  process.exit(0);
}, secs * 1000);
