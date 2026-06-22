# TeleForge

A native **Android** client to monitor and control multiple 3D printers —
primarily the **Elegoo Centauri Carbon 2 (CC2)** (which has no Android client
today) and a **Snapmaker U1** — bridged remotely through
[OctoEverywhere](https://octoeverywhere.com/), with optional local LAN access.

> **Status:** pre-implementation. Tooling and architecture decided; design docs
> below. No app code yet.

## What it does (planned)

- Manage multiple printers (OctoEverywhere relay + optional local).
- Live current-job view: progress, ETA, filename, stats.
- Pause / resume / cancel.
- Temps (nozzle, bed, chamber) and fans — with control where supported.
- Webcam stream.

## Stack (decided)

- **React Native + Expo** (TypeScript), expo-router, NativeWind.
- **Client-only, no backend** — the app talks directly to the OE relay / LAN.
- Shared **`packages/core`** with per-model adapters (CC2 = SDCP, U1 =
  Klipper/Moonraker) over a swappable transport (LAN vs OE relay).

## Docs

- [Design](./docs/design.md) — scope, decisions, rationale, roadmap, risks.
- [Architecture](./docs/architecture.md) — layers, interfaces, repo layout, data flow.
- [OctoEverywhere Auth](./docs/octoeverywhere-auth.md) — App Connection portal & relay.
