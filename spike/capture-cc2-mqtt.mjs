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
const secs = Number(process.env.OE_SECS || 60);

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
// Dedupe by (topic, method): print one full sample of each kind, then just
// count repeats. The combo/CFS object is likely a rarer message type that
// would otherwise be buried under the frequent `method:6000` status pushes.
const seen = new Map(); // key -> count
const filamentHits = new Set();

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
  const method = json && typeof json === 'object' ? json.method : undefined;
  const key = `${topic} | method=${method}`;
  const first = !seen.has(key);
  seen.set(key, (seen.get(key) || 0) + 1);

  const hits = json ? scan(json, FILAMENT_RE) : [];
  hits.forEach((h) => filamentHits.add(`${key} → ${h}`));

  // Print a full sample the first time we see a (topic, method), or any time a
  // message contains filament-ish keys.
  if (first || hits.length) {
    console.log(`\n──[${count}] ${key} (${payload.length} bytes)${first ? ' [new type]' : ''}`);
    console.log((json ? JSON.stringify(json, null, 2) : text).slice(0, 8000));
    if (hits.length) console.log(`  ★ filament-ish keys: ${hits.join(', ')}`);
  }
});

client.on('error', (e) => console.log('⚠️  error:', e.message));
client.on('close', () => console.log('connection closed'));

setTimeout(() => {
  console.log(`\n========== summary: ${count} message(s) in ${secs}s ==========`);
  console.log('distinct (topic | method) → count:');
  for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}  ×${n}`);
  }
  console.log(`\nfilament-ish hits (${filamentHits.size}):`);
  for (const h of filamentHits) console.log(`  ${h}`);
  client.end(true);
  process.exit(0);
}, secs * 1000);
