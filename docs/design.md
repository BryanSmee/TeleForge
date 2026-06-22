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

- The **CC2** speaks **SDCP** (Smart Device Control Protocol): JSON over a
  WebSocket. It exposes temps (nozzle/bed/chamber), fans, lighting, print
  progress/ETA/filename, and pause/resume/cancel.
- The **U1** is **stock Klipper + Moonraker** with minor customizations — a
  well-understood JSON-RPC-over-WebSocket + REST API. Effectively a solved
  problem.
- **OctoEverywhere** relays *both* transparently: after authorization you make
  **the same HTTP/WebSocket calls you'd make on the LAN**, just against a relay
  URL with an auth header. CC2 is supported via OE companion mode
  `elegoo_cc2`; Klipper via `klipper`.

So the heavy lifting is a small set of **per-model adapters** that normalize two
different printer protocols into one shared state model, plus a **transport**
abstraction that swaps "LAN" for "OE relay" without the adapters caring. The UI
is then a fairly standard live dashboard.

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
- **Auth needs no secret.** OE's App Connection flow is a WebView portal that
  returns a token scoped to one app+printer (see
  [`octoeverywhere-auth.md`](./octoeverywhere-auth.md)). There is no confidential
  client secret to protect, so the single reason to deploy a Lambda evaporates.

Net: **nothing to deploy, nothing to keep running.** The reusable asset is the
`core` package, not infrastructure.

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
- [ ] Exact CC2 webcam path through OE (OE webcam endpoint vs. CarbonicSidecar
  MJPEG :3000 / go2rtc :1984 on LAN).
- [ ] Registering the app with OE to obtain an **`appId`** (prerequisite for the
  portal).

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
