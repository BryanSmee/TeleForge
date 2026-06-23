#!/usr/bin/env node
// TeleForge spike — passively capture the CC2's raw MQTT stream via OE's
// `proxy/mqtt` WebSocket, to find the combo/CFS per-slot filament data that
// OE's normalized `status` does not expose.
//
// READ-ONLY: connects and SUBSCRIBES only (`#`). It never publishes a command,
// so it is safe to run during a print.
//
// Needs the `mqtt` package (MQTT-over-WebSocket client):
//     cd spike && npm i mqtt        # or:  bun add mqtt
//
// Run (the Shared Connection URL carries its own auth in the subdomain; add
// OE_BEARER / OE_USER+OE_PASS only if your connection needs it):
//     OE_URL="<CC2 Shared Connection URL>" node spike/capture-cc2-mqtt.mjs
//
// Override the proxy path or capture window if needed:
//     OE_WS_PATH="/octoeverywhere-command-api/proxy/mqtt" OE_SECS=25 OE_URL=... node ...
//
// Prints every message for OE_SECS seconds (default 20), then exits.

import mqtt from 'mqtt';

const base = process.env.OE_URL?.replace(/\/+$/, '');
if (!base) {
  console.error('Set OE_URL (the CC2 Shared Connection URL).');
  process.exit(1);
}

const wsBase = base.replace(/^http/, 'ws'); // http(s)://host → ws(s)://host
const path = process.env.OE_WS_PATH || '/octoeverywhere-command-api/proxy/mqtt';
const url = `${wsBase}${path}`;
const secs = Number(process.env.OE_SECS || 20);

const headers = {};
if (process.env.OE_BEARER) headers.Authorization = `Bearer ${process.env.OE_BEARER}`;
else if (process.env.OE_USER || process.env.OE_PASS)
  headers.Authorization =
    'Basic ' + Buffer.from(`${process.env.OE_USER ?? ''}:${process.env.OE_PASS ?? ''}`).toString('base64');

const FILAMENT_RE = /filament|material|spool|slot|cfs|combo|colou?r|feeder|box|ams|tray/i;

function scan(obj, re, prefix = '', out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (re.test(k)) out.push(p);
      scan(v, re, p, out);
    }
  }
  return out;
}

console.log(`Connecting to ${url} (capturing ${secs}s, subscribe-only)…`);

const client = mqtt.connect(url, {
  wsOptions: { headers },
  clientId: `teleforge-probe-${Math.random().toString(16).slice(2, 8)}`,
  username: process.env.OE_MQTT_USER || undefined,
  password: process.env.OE_MQTT_PASS || undefined,
  reconnectPeriod: 0,
  connectTimeout: 15000,
  // Most embedded brokers are 3.1.1 (=4). Set OE_MQTT_V=5 to try MQTT v5.
  protocolVersion: Number(process.env.OE_MQTT_V || 4),
});

let count = 0;

client.on('connect', () => {
  console.log('✅ connected — subscribing to "#"');
  client.subscribe('#', { qos: 0 }, (err) => {
    if (err) console.log('subscribe error:', err.message);
  });
});

client.on('message', (topic, payload) => {
  count++;
  const text = payload.toString('utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary/non-json */
  }
  console.log(`\n──[${count}] topic: ${topic} (${payload.length} bytes)`);
  if (json) {
    const hits = scan(json, FILAMENT_RE);
    console.log(JSON.stringify(json, null, 2).slice(0, 6000));
    if (hits.length) console.log(`  ★ filament-ish keys: ${hits.join(', ')}`);
  } else {
    console.log(text.slice(0, 1000));
  }
});

client.on('error', (e) => console.log('⚠️  error:', e.message));
client.on('close', () => console.log('connection closed'));

setTimeout(() => {
  console.log(`\n--- captured ${count} message(s) in ${secs}s ---`);
  client.end(true);
  process.exit(0);
}, secs * 1000);
