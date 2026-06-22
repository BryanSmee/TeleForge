#!/usr/bin/env node
// TeleForge spike — verify the OctoEverywhere Plugin/Command API through an
// App Connection. READ-ONLY: only calls ping/status/list-webcam/connection-info.
// No print is paused, cancelled, or modified.
//
// Prereqs: Node 18+ (global fetch). Get an App Connection token + URL by running
// the OctoEverywhere App Connection portal for your CC2 (see docs/octoeverywhere-auth.md).
//
// Usage:
//   OE_URL="<appConnectionUrl>" OE_TOKEN="<appApiToken>" node spike/verify-oe.mjs
//
// What to look for:
//   - status returns JobStatus.CurrentPrint.{Progress,TimeLeftSec,FileName,Temps}
//   - Features is a non-zero bitfield
//   - list-webcam returns Webcams[] with a stream/snapshot URL
//   - any 6xx HTTP code = an OctoEverywhere relay error (printer offline, etc.)

const base = process.env.OE_URL?.replace(/\/+$/, "");
const token = process.env.OE_TOKEN;

if (!base || !token) {
  console.error("Set OE_URL (App Connection URL) and OE_TOKEN (appApiToken).");
  process.exit(1);
}

const API = "/octoeverywhere-command-api";

async function call(command, { method = "GET", body } = {}) {
  const url = `${base}${API}/${command}`;
  const res = await fetch(url, {
    method,
    headers: {
      AppToken: token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, json, text };
}

function note(status) {
  if (status >= 600) return "  ⚠️  6xx = OctoEverywhere relay error (see docs/error-codes)";
  if (status === 401 || status === 403) return "  ⚠️  auth rejected — check AppToken/header name";
  if (status === 404) return "  ⚠️  404 — base-path joining is likely different than assumed";
  return "";
}

const READONLY = ["ping", "status", "list-webcam", "get-connection-info"];

for (const cmd of READONLY) {
  try {
    const { status, json, text } = await call(cmd);
    console.log(`\n=== ${cmd} → HTTP ${status} ===${note(status)}`);
    console.log((json ? JSON.stringify(json, null, 2) : text).slice(0, 2000));
  } catch (e) {
    console.log(`\n=== ${cmd} → ERROR ===\n  ${e.message}`);
  }
}

console.log(`
---
Next (manual, optional): a live WebSocket test against ${API}/proxy/mqtt
to confirm push/MQTT for the CC2. Not included here to keep this read-only.`);
