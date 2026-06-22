# TeleForge — Design Document

> Status: **Draft / pre-implementation.** This document captures product scope,
> the technology decisions made so far, and the rationale behind them. No app
> code exists yet.

## 1. What we're building

A native **Android** client to monitor and control multiple 3D printers,
primarily the **Elegoo Centauri Carbon 2 (CC2)** — which currently has *no*
compatible Android client — and a **Snapmaker U1**. Both printers are reachable
remotely through **OctoEverywhere** (OE), and optionally directly over the LAN.

### Core requirements

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | Multiple printers | OE as the remote bridge; local LAN as an optional second transport |
| 2 | Current job: progress, ETA, filename, stats | Live, push-based updates |
| 3 | Pause / Resume / Cancel | |
| 4 | Temps (nozzle(s), bed, chamber) + fans, with control where supported | Set nozzle/bed targets, fan speed |
| 5 | Webcam stream | MJPEG and/or WebRTC |

### Non-goals (for now)

- Slicing / file preparation.
- Full file/gcode management UI (browse + start may come later).
- iOS (architecture keeps the door open via React Native, but not a target).

## 2. The key insight that shapes everything

This is **not primarily an Android problem** — it's a *data-normalization*
problem with a dashboard UI on top.

> **Updated by the spike — see [`spike-findings.md`](./spike-findings.md).**
> The CC2 is **MQTT**-based (not SDCP — that's the *original* Centauri), and more
> importantly OctoEverywhere already exposes a **normalized cross-platform
> Command API** that makes per-printer adapters unnecessary on the remote path.

- The **CC2** speaks an **MQTT** protocol. The **U1** is **stock Klipper +
  Moonraker**. These differ, *but you don't have to deal with that remotely:*
- **OctoEverywhere** exposes a normalized **Plugin / Command API** at
  `/octoeverywhere-command-api/` that is identical across OctoPrint, Moonraker,
  Bambu, and Elegoo CC2 — reachable through the relay with an `AppToken` header.
  It returns normalized status (progress, ETA, temps, layers, filename, webcams)
  and accepts pause/resume/cancel/set-temp. CC2 uses companion mode `elegoo_cc2`.

So for the **remote path** the heavy lifting is essentially done for us: a single
client over the Command API, mapping its JSON to one shared state model.
**Per-protocol adapters (CC2 MQTT, U1 Moonraker) are only needed for local LAN
mode and for features the normalized API omits (fans, chamber-set).** The UI is
then a standard live dashboard. (Details + capability matrix in the spike doc.)

## 3. Technology decisions

### 3.1 App framework — React Native + Expo (TypeScript) ✅ decided

Chosen because the developer is fluent in React/Next/TS and near-zero in
Kotlin. React Native reuses that skill set almost 1:1 while still producing a
real native app.

- **Expo (managed) + EAS Build** — cloud builds, no local Android Studio /
  Gradle toolchain to maintain.
- **expo-router** — file-based routing; mirrors the Next.js app-router mental
  model.

**Alternatives considered:**

- *Capacitor + Next.js* — lowest friction and gives a free web version; browser
  engine handles MJPEG/WebRTC natively. Rejected as primary because of weaker
  background execution and a less-native feel, but it remains a viable pivot.
- *Native Kotlin + Compose* — best Android citizen, but means learning a new
  language/runtime from scratch for little marginal benefit here.
- *Flutter* — would require learning Dart; no reuse of existing skills.

### 3.2 Architecture — client-only, zero backend ✅ decided

No proxy server. Rationale:

- The realtime path is a **long-lived WebSocket + a webcam stream**. Proxying
  those through serverless (Lambda / API Gateway WebSockets) adds cost, latency,
  and a connection that drops under you. The app connects **directly** to the OE
  relay (or LAN).
- The **adapter / normalization layer is pure TypeScript** — it belongs in the
  app (and a shareable `packages/core` workspace), not on a server.
- **Auth needs no secret.** Remote access uses a per-printer substitute URL +
  header auth — no confidential client secret to protect, so the single reason to
  deploy a Lambda evaporates.

Net: **nothing to deploy, nothing to keep running.** The reusable asset is the
`core` package, not infrastructure.

### 3.4 OctoEverywhere auth path — Shared Connections for v1 ✅ decided

Two paths exist (full comparison in [`octoeverywhere-auth.md`](./octoeverywhere-auth.md)):

- **v1 — Shared Connections:** Bryan creates one link per printer at
  [/sharedconnections](https://octoeverywhere.com/sharedconnections) and pastes
  the URL into the app. No `appId`, no OAuth portal to build, no registration.
  Ideal for a personal app; Supporter tier (already held) covers it.
- **📌 TODO later (kept, not discarded) — App Connection portal:** the
  OAuth-style hosted login for a *published, multi-user* TeleForge. Likely the
  final-state auth flow, so it stays fully documented. Deferred only because v1
  is personal. **Adopting it later is additive** — the data layer is identical
  (same substitute URL → same command API), so no rewrite.

### 3.3 Recommended library stack

| Concern | Choice | Why |
|--------|--------|-----|
| Language | TypeScript | End to end |
| Routing | expo-router | Next.js-like file routing |
| Server/one-shot data | TanStack Query | File lists, history, REST |
| Live state | Zustand | WebSocket-fed normalized store |
| Styling | NativeWind | Tailwind syntax, familiar |
| Secure token storage | expo-secure-store | App Connection tokens |
| OAuth-ish portal | react-native-webview / expo-web-browser | Intercept portal redirect |
| Webcam (MJPEG) | react-native-webview | Renders multipart MJPEG easily |
| Webcam (WebRTC) | react-native-webrtc | Low latency via go2rtc; needs Expo **Dev Client** (not Expo Go) |
| Notifications | expo-notifications | Phase 2; lean on OE's built-in push first |

> ⚠️ **Expo Go limitation:** `react-native-webrtc` (and any native module) needs
> a custom **Expo Dev Client** build. Plan to move off Expo Go early if WebRTC is
> in scope. MJPEG-only would let you stay on Expo Go longer.

## 4. Phased roadmap (suggested)

1. **Spike / de-risk** — confirm OE relay tunnels the SDCP WebSocket for
   `elegoo_cc2`; confirm the App Connection portal flow end-to-end with one
   token. (See open questions.)
2. **Read-only single printer** — OE transport + CC2 adapter → live status
   dashboard (temps, progress, ETA, filename). No controls.
3. **Controls** — pause/resume/cancel, then temp + fan setpoints.
4. **Webcam** — MJPEG first; WebRTC if latency matters (forces Dev Client).
5. **Multi-printer** — printer list, per-printer tokens, U1 (Moonraker) adapter.
6. **Local transport** — LAN discovery (SDCP UDP:3000 / Moonraker), as a second
   transport behind the same adapters.
7. **Notifications & polish.**

## 5. Open questions / risks to validate

- [ ] Does the OE App Connection relay tunnel the **raw SDCP WebSocket** for
  `elegoo_cc2`, or only a normalized subset? (Likely yes — OE advertises generic
  HTTP+WS relay — but verify before committing.)
- [ ] OE account **relay limits** apply to webcam streaming and file transfer
  (surfaced by the App Connection Info API). Confirm they're acceptable for
  continuous webcam viewing; LAN transport sidesteps them.
- [x] CC2 webcam path through OE — **resolved:** remote MJPEG works at
  `<connUrl>/oe-webcam-stream`; per-printer config auto-discovered via
  `list-webcam`. Still to confirm: camera-index param form and a snapshot endpoint.
- [ ] Registering the app with OE to obtain an **`appId`** (prerequisite for the
  portal; `devtest` works for spikes).
- [ ] **OctoEverywhere Supporter Perks are required** for App Connections — both
  printers' owner account must be a supporter, or all relay calls return `605`.
  Confirm this is acceptable (it's a paid tier).

## 6. Reference material

- [OctoEverywhere App Connections](https://docs.octoeverywhere.com/app-connections/)
- [App Connection Portal](https://docs.octoeverywhere.com/app-connections/portal/)
- [App Connection APIs overview](https://docs.octoeverywhere.com/app-connections/apis/overview/)
- [Printer API Remote Access](https://docs.octoeverywhere.com/printer-api-remote-access/)
- [OctoEverywhere companion modes (docker)](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/master/docker-readme.md)
- [OpenCentauri SDCP API docs](https://docs.opencentauri.cc/software/api/)
- [sdcp-centauri-carbon (SDCP reference)](https://github.com/WalkerFrederick/sdcp-centauri-carbon)
- [elegoo-homeassistant (working SDCP impl)](https://github.com/danielcherubini/elegoo-homeassistant)
- [CarbonicSidecar (CC webcam/sidecar)](https://github.com/pdscomp/CarbonicSidecar)
- [Moonraker API](https://moonraker.readthedocs.io/en/latest/web_api/)
