# Spike Findings — OctoEverywhere relay + CC2 (source-verified)

> Goal of the spike: confirm (1) how an app reaches the CC2 through the OE
> relay, and (2) the App Connection portal/auth flow — before committing to an
> architecture.
>
> Method: read the **OctoEverywhere open-source plugin** source
> (`QuinnDamerell/OctoPrint-OctoEverywhere`, cloned at spike time) + official
> docs. The half that needs *your* live OE account/printer is scripted in
> [`/spike`](../spike) for you to run.

## Headline results (and one correction to the original design)

1. **❗ The CC2 speaks MQTT, not SDCP.** SDCP (WebSocket/JSON) is the *original*
   Centauri / Centauri Carbon. The **Centauri Carbon 2** uses an **MQTT**
   protocol. Confirmed by the dedicated `elegoo_cc2_octoeverywhere/` module
   (note `elegoocc2mqttwebsocketproxy.py`, `MqttUpstreamMux`) and the in-source
   reference to the CC2 MQTT protocol doc. The original design doc's "CC2 = SDCP"
   was wrong and has been corrected.

2. **✅ There is a normalized, cross-platform HTTP API — and it's the right
   primary interface.** OE exposes a **Plugin / Command API** at the path
   `/octoeverywhere-command-api/` that is *identical in shape across all
   platforms* (OctoPrint, Klipper/Moonraker, Bambu, Elegoo CC2). OE's docs state
   these APIs "can be accessed from **any OctoEverywhere remote access
   connection**" — i.e. including a third-party **App Connection** (send the
   `AppToken` header). This means **TeleForge does not need per-printer protocol
   adapters for the remote path** — OE already normalizes CC2-MQTT and
   U1-Moonraker into one API.

3. **✅ App Connection auth = WebView portal → scoped `AppToken`, no secret.**
   Unchanged from prior research and consistent with the source: requests carry
   the `AppToken` header; relay-specific failures use custom `6xx` HTTP codes.

## The Plugin / Command API surface (verified in `octoeverywhere/commandhandler.py`)

Base path: `https://<connection>/octoeverywhere-command-api/<command>`
Auth (remote/App Connection): header `AppToken: <appApiToken>`
Args: JSON body **or** GET query params (handler accepts either).

| Command path | Purpose |
|---|---|
| `ping` | Liveness → `{"Message":"Pong"}` |
| `status` | **Normalized job + temps + webcams + feature flags** (see below) |
| `pause` / `resume` / `cancel` | Print control |
| `start` | Start a print (not supported on CC2) |
| `set-temp` | Set bed / extruder / chamber target (platform-dependent) |
| `set-light` | Toggle a named light |
| `move-axis` / `home` / `extrude` | Motion |
| `list-webcam` (or `webcam/list`) | Webcam list + `DefaultIndex` (+ stream/snapshot URLs) |
| `get-connection-info` | Printer connection metadata |
| `send-command` | **Raw passthrough** (for CC2: `TransportType:"mqtt"`, `Request:{Method:int,Params:{}}`) |
| `files/list`, `files/delete` | File ops (not on CC2) |
| `proxy/mqtt` | **WebSocket-only** raw MQTT proxy (push/live for CC2 & Bambu) |

### `status` response shape

```jsonc
{
  "JobStatus": {
    "State": "...", "SubState": "...", "Error": null,
    "Lights": [{ "Name": "chamber", "On": true }],
    "CurrentPrint": {
      "Progress": 42.0,
      "DurationSec": 1234,
      "TimeLeftSec": 5678,          // → ETA = now + TimeLeftSec
      "FileName": "benchy",
      "CurrentLayer": 87, "TotalLayers": 220,
      "EstTotalFilWeightMg": 0,
      "Temps": {
        "BedActual": 60, "BedTarget": 60,
        "HotendActual": 210, "HotendTarget": 210,
        "ChamberActual": 30, "ChamberTarget": 0
      }
    }
  },
  "OctoEverywhereStatus": { /* print id, AI "Gadget" failure scores, ... */ },
  "PlatformVersion": "Elegoo-CC2",
  "Features": 0,                    // bitfield of FEATURE_* the printer supports
  "ListWebcams": { "Webcams": [ ... ], "DefaultIndex": 0 }
}
```

`Features` is a bitfield the app should read to drive UI affordances (don't show
controls a printer can't do). For CC2 the plugin advertises
`LIGHT_CONTROL | HOMING | AXIS_MOVEMENT | TEMPERATURE_CONTROL`.

## CC2 capability matrix through OE (verified in `elegoocc2commandhandler.py`)

| Feature | Via normalized API? | Notes |
|---|---|---|
| Status: progress, ETA, filename, layers | ✅ | `TimeLeftSec` is the ETA source |
| Temps **read**: hotend, bed, **chamber** | ✅ | Chamber is readable |
| Pause / Resume / Cancel | ✅ | MQTT methods 1021 / 1023 / 1022 |
| Set **bed** & **extruder** temp | ✅ | MQTT method 1028 |
| Set **chamber** temp | ❌ | Explicitly "not supported" |
| **Fan read / set** | ❌ (normalized) | **Not in status payload, no setter** → raw MQTT only |
| Light on/off, home, move axis | ✅ | |
| Start print / file list / upload | ❌ | Not supported on CC2 |
| Webcam list + stream | ✅ | Host-agnostic webcam API |
| Live push (no polling) | ⚠️ | Via `proxy/mqtt` WebSocket (raw MQTT) |

### Important consequence for your requirements

- **Fan speed control** (you listed it) is **not** in OE's normalized API for
  *any* platform — there is no `set-fan` command. For the **CC2** fans aren't
  even reported in `status`; reading/changing them requires the **raw MQTT path**
  (`send-command` with `TransportType:"mqtt"`, or the `proxy/mqtt` WebSocket).
  For the **U1** fans are available through Moonraker (`M106`, `printer objects`)
  — easy locally, and via raw passthrough remotely.
- **Chamber temperature** is **read-only** on the CC2.
- Treat fans + chamber-set as a **Phase 2 "advanced/raw" feature**, gated behind
  the `Features`/platform check, not part of the MVP normalized path.

## Live / push updates

`status` is request/response (poll it, e.g. every 1–2 s while the dashboard is
open). For true push there are two native options, both reached through the same
relay:

- **CC2:** `proxy/mqtt` WebSocket → subscribe to the CC2's MQTT status topic
  (raw protocol; see the CC2 MQTT protocol reference).
- **U1:** Moonraker's own JSON-RPC WebSocket (`printer.objects.subscribe`).

**Recommendation:** MVP = **poll `status`** (trivial, uniform across both
printers). Add the push paths later only if latency/battery warrants it.

## What this means for the architecture (revised)

```
                         ┌────────── REMOTE (MVP) ──────────┐
TeleForge ── AppToken ──▶│ OctoEverywhereClient             │──▶ OE relay ──▶ plugin
                         │  GET /octoeverywhere-command-api/ │     (normalizes CC2-MQTT
                         │      status | pause | set-temp …  │      & U1-Moonraker)
                         └───────────────────────────────────┘

                         ┌────────── LOCAL (later) ─────────┐
                         │ CC2: MQTT client                  │  ← per-protocol
                         │ U1 : Moonraker JSON-RPC WS/REST   │    adapters live HERE
                         └───────────────────────────────────┘
```

- **Primary remote interface = a single `OctoEverywhereClient`** over the Plugin
  API. The relay+plugin already normalize both printers, so **no per-model
  adapter is needed for the remote MVP.** Map the `status` JSON → our
  `PrinterState`; use `Features` to gate controls.
- **Per-protocol adapters (CC2 MQTT, U1 Moonraker) move to the LOCAL path** and
  to advanced features the normalized API doesn't cover (fans, chamber set, raw
  MQTT). They are no longer on the critical path for v1.
- This is a net **simplification**: ship a remote-only MVP against one HTTP API,
  add protocol adapters only when you do LAN mode / fan control.

## Still to verify with a LIVE test (needs your OE account — scripted)

The open-source plugin proves the API *exists and its shape*. The cloud-side
**App Connection routing** is closed-source, so confirm against your own
account using [`/spike/verify-oe.mjs`](../spike/verify-oe.mjs):

- [ ] An App Connection `AppToken` can call `/octoeverywhere-command-api/status`
      and `/list-webcam` through the App Connection URL, and returns the shapes
      above for the CC2.
- [ ] Exact base-path joining (is the command path appended directly to the
      returned App Connection URL?).
- [ ] Whether continuous webcam streaming hits OE account relay limits
      (`get-connection-info` / App Connection Info reports limits).
- [ ] Register the app to obtain an `appId` for the portal.

## Sources

- OE plugin source: `QuinnDamerell/OctoPrint-OctoEverywhere` (`octoeverywhere/commandhandler.py`, `elegoo_cc2_octoeverywhere/*`)
- [Plugin API overview](https://docs.octoeverywhere.com/plugin-api/)
- [App Connections](https://docs.octoeverywhere.com/app-connections/) · [Portal](https://docs.octoeverywhere.com/app-connections/portal/) · [APIs overview](https://docs.octoeverywhere.com/app-connections/apis/overview/)
- [CC2 MQTT protocol reference (community)](https://github.com/danielcherubini/elegoo-homeassistant/blob/main/docs/CC2_PROTOCOL.md)
