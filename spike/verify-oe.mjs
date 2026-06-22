#!/usr/bin/env node
// TeleForge spike — verify the OctoEverywhere Plugin/Command API through an
// App Connection. READ-ONLY: only calls ping/status/list-webcam + the OE
// account info API. Nothing is paused, cancelled, or modified.
//
// Prereqs:
//   - Node 18+ (global fetch).
//   - You must be an OctoEverywhere *Supporter* (App Connections require it).
//   - Credentials from running the App Connection Portal once. Quick manual way
//     (no app registration needed) — open this in a browser:
//        https://octoeverywhere.com/appportal/v1/?appId=devtest
//     Log in, pick your CC2, authorize. On completion the page redirects to
//        .../appportal/v1/complete?success=true&id=...&url=...&authBearerToken=...&appApiToken=...
//     Copy these URL-DECODED values from the address bar:
//        url             -> OE_URL    (substitute base, e.g. https://app-xxxx.octoeverywhere.com)
//        authBearerToken -> OE_BEARER (connection auth for the printer/command API)
//        appApiToken     -> OE_APITOKEN (optional; only for the account info API)
//
// Usage:
//   OE_URL="<url>" OE_BEARER="<authBearerToken>" [OE_APITOKEN="<appApiToken>"] node spike/verify-oe.mjs
//
// Auth model (per OE docs):
//   - Printer/command API  -> header  Authorization: Bearer <authBearerToken>
//     (or basic auth with authBasicHttpUser/Password)
//   - OE account info API  -> header  AppToken: <appApiToken>   (different credential!)

const base = process.env.OE_URL?.replace(/\/+$/, "");
const bearer = process.env.OE_BEARER;
const apiToken = process.env.OE_APITOKEN;

if (!base || !bearer) {
  console.error("Set OE_URL (App Connection 'url') and OE_BEARER (authBearerToken). See header for how to get them.");
  process.exit(1);
}

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
    603: "App Connection not found (bad subdomain/url)",
    604: "App Connection revoked/expired",
    605: "owner is not an OE Supporter (App Connections need Supporter Perks)",
    606: "invalid/missing connection credentials (check the Bearer token)",
  };
  if (codes[status]) return `  ⚠️  ${status}: ${codes[status]}`;
  if (status >= 600) return `  ⚠️  ${status}: OctoEverywhere relay error (see docs/octoeverywhere-auth.md)`;
  if (status === 404) return "  ⚠️  404 — command path joins onto the base URL differently than assumed";
  return "";
}

// 1) Printer/command API — authed with the Bearer connection token.
const cmdHeaders = { Authorization: `Bearer ${bearer}` };
for (const cmd of ["ping", "status", "list-webcam"]) {
  try {
    const { status, json, text } = await get(`${API}/${cmd}`, cmdHeaders);
    console.log(`\n=== ${cmd} → HTTP ${status} ===${note(status)}`);
    console.log((json ? JSON.stringify(json, null, 2) : text).slice(0, 2000));
  } catch (e) {
    console.log(`\n=== ${cmd} → ERROR ===\n  ${e.message}`);
  }
}

// 2) OE account info API — authed with the *appApiToken* (AppToken header).
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
