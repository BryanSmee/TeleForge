#!/usr/bin/env node
// TeleForge spike — confirm we can read the CC2's combo/CFS filament data
// (method 2005 → canvas_info) over OE's plain HTTP `send-command` passthrough,
// instead of holding a proxy/mqtt websocket open in the app.
//
// READ-ONLY: method 2005 is a *query* (the printer/PC client issues it just to
// render the filament screen). It changes nothing, so it's safe during a print.
//
//   OE_URL="<CC2 Shared Connection URL>" node spike/probe-cc2-canvas.mjs
//   OE_URL="..." OE_BEARER="<token>" node spike/probe-cc2-canvas.mjs
//
// Prereqs: Node 18+.

const base = process.env.OE_URL?.replace(/\/+$/, '');
if (!base) {
  console.error('Set OE_URL (the CC2 Shared Connection URL).');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json' };
if (process.env.OE_BEARER) headers.Authorization = `Bearer ${process.env.OE_BEARER}`;
else if (process.env.OE_USER || process.env.OE_PASS)
  headers.Authorization =
    'Basic ' + Buffer.from(`${process.env.OE_USER ?? ''}:${process.env.OE_PASS ?? ''}`).toString('base64');

const API = '/octoeverywhere-command-api';

async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { status: res.status, json, text };
}

// `send-command` body shape per docs/spike-findings.md (CC2 = MQTT transport).
// Try a couple of plausible shapes; whichever returns canvas_info is the one.
const attempts = [
  { label: 'Request.Method', body: { TransportType: 'mqtt', Request: { Method: 2005, Params: {} } } },
  { label: 'Request.Method (no Params)', body: { TransportType: 'mqtt', Request: { Method: 2005 } } },
  { label: 'flat Method', body: { TransportType: 'mqtt', Method: 2005, Params: {} } },
];

for (const { label, body } of attempts) {
  console.log(`\n========== send-command [${label}] ==========`);
  console.log('  request body:', JSON.stringify(body));
  try {
    const { status, json, text } = await post(`${API}/send-command`, body);
    console.log(`  → HTTP ${status}`);
    const out = json ? JSON.stringify(json, null, 2) : text;
    console.log(out.slice(0, 4000));
    if (out.includes('canvas_info') || out.includes('tray_list')) {
      console.log('\n  ✅ THIS SHAPE RETURNS canvas_info — use it.');
      break;
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
  }
}

console.log(
  `\n---\nIf one shape returned canvas_info, the app can read the combo unit over plain\nHTTP send-command — no websocket needed. If none did (e.g. the relay 4xx/5xx or\nan empty result), paste the output and we'll fall back to the proxy/mqtt path.`,
);
