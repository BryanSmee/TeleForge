#!/usr/bin/env node
// TeleForge spike — verify the OctoEverywhere Plugin/Command API remotely.
// READ-ONLY: only calls ping/status/list-webcam (+ optional account info).
// Nothing is paused, cancelled, or modified.
//
// Works with EITHER OctoEverywhere remote-access path:
//
//   A) Shared Connection (recommended for a personal app — no app registration)
//      Create one at https://octoeverywhere.com/sharedconnections for your CC2,
//      copy the generated URL. Auth may be embedded in the URL or shown when you
//      create it (Bearer token or basic user/pass). Run with whatever it gives:
//        OE_URL="<sharedConnectionUrl>" node spike/verify-oe.mjs
//        OE_URL="..." OE_BEARER="<token>" node spike/verify-oe.mjs
//        OE_URL="..." OE_USER="<u>" OE_PASS="<p>" node spike/verify-oe.mjs
//
//   B) App Connection portal (for a published multi-user app; needs an appId,
//      or use appId=devtest for testing). Gives url + authBearerToken +
//      appApiToken. See docs/octoeverywhere-auth.md.
//        OE_URL="<url>" OE_BEARER="<authBearerToken>" OE_APITOKEN="<appApiToken>" \
//          node spike/verify-oe.mjs
//
// Prereqs: Node 18+; an OctoEverywhere *Supporter* account.

const base = process.env.OE_URL?.replace(/\/+$/, "");
const bearer = process.env.OE_BEARER;
const user = process.env.OE_USER;
const pass = process.env.OE_PASS;
const apiToken = process.env.OE_APITOKEN;

if (!base) {
  console.error("Set OE_URL (Shared Connection URL or App Connection 'url'). See header for auth options.");
  process.exit(1);
}

// Build the connection auth header (if any). Shared Connections may need none.
const authHeaders = {};
if (bearer) authHeaders.Authorization = `Bearer ${bearer}`;
else if (user || pass) authHeaders.Authorization = "Basic " + Buffer.from(`${user ?? ""}:${pass ?? ""}`).toString("base64");

const API = "/octoeverywhere-command-api";

async function get(path, headers) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, json, text };
}

// OctoEverywhere relay custom error codes (600–613). Maps the common ones.
function note(status) {
  const codes = {
    601: "printer not connected to OctoEverywhere (printer off/offline?)",
    602: "OE→printer timed out",
    603: "connection not found (bad URL/subdomain)",
    604: "connection revoked/expired",
    605: "owner is not an OE Supporter (remote access needs Supporter Perks)",
    606: "invalid/missing connection credentials (try OE_BEARER or OE_USER/OE_PASS)",
  };
  if (codes[status]) return `  ⚠️  ${status}: ${codes[status]}`;
  if (status >= 600) return `  ⚠️  ${status}: OctoEverywhere relay error (see docs/octoeverywhere-auth.md)`;
  if (status === 401 || status === 403) return "  ⚠️  auth rejected — this connection needs credentials (OE_BEARER or OE_USER/OE_PASS)";
  if (status === 404) return "  ⚠️  404 — command path joins onto the base URL differently than assumed";
  return "";
}

// 1) Printer/command API.
for (const cmd of ["ping", "status", "list-webcam"]) {
  try {
    const { status, json, text } = await get(`${API}/${cmd}`, authHeaders);
    console.log(`\n=== ${cmd} → HTTP ${status} ===${note(status)}`);
    console.log((json ? JSON.stringify(json, null, 2) : text).slice(0, 2000));
  } catch (e) {
    console.log(`\n=== ${cmd} → ERROR ===\n  ${e.message}`);
  }
}

// 2) OE account info API — App Connection only, authed with the appApiToken.
if (apiToken) {
  try {
    const { status, json, text } = await get(`/api/appconnection/info`, { AppToken: apiToken });
    console.log(`\n=== appconnection/info → HTTP ${status} ===${note(status)}`);
    console.log((json ? JSON.stringify(json, null, 2) : text).slice(0, 2000));
  } catch (e) {
    console.log(`\n=== appconnection/info → ERROR ===\n  ${e.message}`);
  }
}

console.log(`\n---\nWhat to confirm: status → JobStatus.CurrentPrint with Progress, TimeLeftSec (ETA),\nFileName, Temps, and a non-zero Features bitfield; list-webcam → Webcams[] with a URL.`);

