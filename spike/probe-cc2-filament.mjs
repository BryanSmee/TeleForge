#!/usr/bin/env node
// TeleForge spike — find the CC2's combo/CFS per-slot filament data.
// READ-ONLY: only GETs `status` and `get-connection-info`. Nothing is changed.
//
// The CC2's 4-filaments→1-extruder combo unit isn't in OE's normalized `status`
// (which only carries temps/job/lights). This probe dumps the *full* untruncated
// status in case OE passes through Elegoo-specific fields, and scans every
// response for filament-ish keys so we can see where the slot data lives.
//
//   OE_URL="<sharedConnectionUrl>" node spike/probe-cc2-filament.mjs
//   OE_URL="..." OE_BEARER="<token>" node spike/probe-cc2-filament.mjs
//   OE_URL="..." OE_USER="<u>" OE_PASS="<p>" node spike/probe-cc2-filament.mjs
//
// Prereqs: Node 18+; an OctoEverywhere *Supporter* account; the CC2 powered on.

const base = process.env.OE_URL?.replace(/\/+$/, '');
const bearer = process.env.OE_BEARER;
const user = process.env.OE_USER;
const pass = process.env.OE_PASS;

if (!base) {
  console.error('Set OE_URL (the CC2 Shared Connection URL). See header for auth options.');
  process.exit(1);
}

const headers = {};
if (bearer) headers.Authorization = `Bearer ${bearer}`;
else if (user || pass)
  headers.Authorization = 'Basic ' + Buffer.from(`${user ?? ''}:${pass ?? ''}`).toString('base64');

const API = '/octoeverywhere-command-api';

// Keys that would hint at the combo/CFS slot data.
const FILAMENT_RE = /filament|material|spool|slot|cfs|combo|color|colour|feeder|box|ams|tray|extruder|nozzle|tool/i;

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { status: res.status, json, text };
}

/** Recursively collect `path -> value` pairs whose key matches the regex. */
function scan(obj, re, prefix = '', out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (re.test(k)) {
        out.push([path, Array.isArray(v) ? `[array len ${v.length}]` : typeof v === 'object' && v !== null ? '{object}' : JSON.stringify(v)]);
      }
      scan(v, re, path, out);
    }
  }
  return out;
}

for (const cmd of ['status', 'get-connection-info']) {
  try {
    const { status, json, text } = await get(`${API}/${cmd}`);
    console.log(`\n========== ${cmd} → HTTP ${status} ==========`);
    if (json) {
      console.log(JSON.stringify(json, null, 2)); // FULL dump, no truncation
      const hits = scan(json, FILAMENT_RE);
      console.log(`\n--- ${cmd}: filament-ish keys (${hits.length}) ---`);
      for (const [p, v] of hits) console.log(`  ${p} = ${v}`);
    } else {
      console.log(text.slice(0, 4000));
    }
  } catch (e) {
    console.log(`\n========== ${cmd} → ERROR ==========\n  ${e.message}`);
  }
}

console.log(
  `\n---\nIf no filament/slot keys show up above, OE doesn't surface the combo unit in\nits normalized API — the data lives in the CC2's raw MQTT push, and the next\nstep is the \`proxy/mqtt\` websocket (or \`send-command\` passthrough). Paste this\noutput and we'll map it.`,
);
