# Spike Findings — OctoEverywhere relay + CC2 (source-verified)

> Goal of the spike: confirm (1) how an app reaches the CC2 through the OE
> relay, and (2) the App Connection portal/auth flow — before committing to an
> architecture.
>
> Method: read the **OctoEverywhere open-source plugin** source
> (`QuinnDamerell/OctoPrint-OctoEverywhere`, cloned at spike time) + official
> docs. The half that needs *your* live OE account/printer is scripted in
> [`/spike`](../spike) for you to run.

## ✅ LIVE RESULT — verified against the real CC2 (Shared Connection)

Ran `spike/verify-oe.mjs` against a **Shared Connection** URL for the actual CC2:

- **Auth: none needed.** Called with *no* header and got `200` — a Shared
  Connection's secret is the high-entropy subdomain itself. (The subdomain URL is
  therefore a credential — treat it like a password; don't commit it.)
- **`ping` → 200** `{Result:{Message:"Pong"}}`.
- **`status` → 200** — normalized `JobStatus` exactly as predicted:
  `State`, `Lights:[{Name:"chamber",On}]`, and `CurrentPrint` with `Progress`,
  `DurationSec`, `TimeLeftSec`, `FileName`, `CurrentLayer`/`TotalLayers`, and
  `Temps` with **Bed/Hotend/Chamber Actual+Target** (chamber **is** reported,
  read-only). Also got `OctoEverywhereStatus.Gadget` AI failure-detection scores
  for free, plus `PlatformVersion`/`Features`/`ListWebcams`.
- **`list-webcam` → 200** — one cam `"Elegoo CC2 Cam"`, but its `StreamUrl` is a
  **LAN address** (`…192.168.1.240:8080/?action=stream`, MJPEG). See webcam note.

**Conclusion: the architecture's core assumption holds.** A no-registration,
no-OAuth Shared Connection drives the normalized command API for the CC2
remotely. Two live caveats below.

### ⚠️ Caveat 1 — `CurrentPrint` is stale/empty when idle
With `State:"idle"`, `Progress`/`FileName`/`TimeLeftSec`/`TotalLayers` were
`0`/`""`, while `CurrentLayer:515` and `DurationSec:7159` were **leftovers from
the previous print**. → The app must **gate all `CurrentPrint` rendering on
`State` being `printing`/`paused`**; never trust those fields when idle.

### ✅ Caveat 2 (resolved) — remote webcam works via the fixed `/oe-webcam-stream` path
**Live-confirmed:** `GET <sharedConnectionUrl>/oe-webcam-stream` returns the CC2's
MJPEG stream remotely. (Setting the `oe-snapshot` header on `/` does *not* work —
that's a trusted service-set header; the correct interface is this fixed path.)

How it fits the source: the CC2 has no `RelayWebcamStreamDetector` and serves its
camera through OE's **QuickCam** subsystem (companion pulls the CC2 MJPEG at
`:8080`, enables the cam over MQTT). The OE **service/relay layer** exposes that
QuickCam stream at the fixed, undocumented relay path **`/oe-webcam-stream`** —
which is why a raw header didn't work but this path does.

> Note: `ShouldQuickCamStreamKeepRunning` returns `IsPrinting` in the source,
> which earlier suggested the CC2 only streams while printing — **per Bryan that
> is not the case**; the symptom we hit was a failing companion app, not a
> print-state gate. So the app does **not** gate the webcam on print state.

**Design implication (matches Bryan's instinct):** the stream *path* is an OE
convention (same across printers), but the per-printer specifics should be
**auto-discovered from `list-webcam`**, not hardcoded:

- `list-webcam` → `Webcams[]` (name), `DefaultIndex`, and per-cam `FlipH`,
  `FlipV`, `Rotation`. Use these to pick the camera (index) and apply the correct
  display transform.
- Stream via `<connUrl>/oe-webcam-stream`; select the camera by index
  (`oe-webcam-index` header, or likely `?index=<n>` — **confirm empirically**).
- A **`/oe-webcam-snapshot`**-style JPEG endpoint likely exists too — **verify**.
- **Stream length is capped (~2 min), then back-to-back limited** (`607`/`609`).
  OE's own app stops at the cap and shows a *"still watching?"* prompt rather than
  silently reconnecting — TeleForge must do the same: stream for the window, then
  **pause and prompt to resume** (don't auto-reconnect in a loop, which trips the
  back-to-back limit). **Snapshot polling** (the snapshot endpoint, every 1–5 s)
  is the right pattern for the idle/dashboard view; reserve the live stream for
  when the user is actively watching.

So the app's webcam layer = "discover cams from `list-webcam` → stream
`/oe-webcam-stream` → apply transforms." Works remotely over the Shared
Connection; **no App path or LAN required.** Status/controls/temps unaffected.

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

3. **✅ App Connection auth = WebView portal → one-time creds, no secret.** The
   portal mints a **substitute base URL** + a **Bearer token** (or basic auth)
   used on *every* printer request; a *separate* `appApiToken` covers only OE's
   account-info API. Relay failures use custom `600–613` codes. **Requires the
   user to have OctoEverywhere Supporter Perks** (else `605`). Full detail in
   [`octoeverywhere-auth.md`](./octoeverywhere-auth.md).

## The Plugin / Command API surface (verified in `octoeverywhere/commandhandler.py`)

Base path: `<connectionUrl>/octoeverywhere-command-api/<command>`
Auth (remote/App Connection): `Authorization: Bearer <authBearerToken>` (or basic auth)
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
| Webcam list (metadata) | ✅ | `list-webcam` → name, `DefaultIndex`, flip/rotation |
| Webcam **view remotely** | ✅ | `GET <connUrl>/oe-webcam-stream` (MJPEG) — live-confirmed; see Caveat 2 |
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

## The CC2 over the LAN (direct MQTT) — as built

When a CC2 has a LAN URL and its broker answers, TeleForge talks to it directly
(`Cc2LanClient`, `packages/core/src/cc2/`) instead of through the relay. Sources:
the community protocol doc (`danielcherubini/elegoo-homeassistant`,
`docs/CC2_PROTOCOL.md`), OE's own CC2 client (`elegoo_cc2_octoeverywhere/elegoocc2client.py`
and `elegoocc2commandhandler.py`) and the community firmware
(`Neme77/centauri-carbon-2-community`, `cc2-control/src/mqtt.c`).
**Not yet verified against a real CC2 from the app** — `spike/probe-cc2-lan.mjs`
runs the same handshake read-only.

### Connection

| | |
|---|---|
| Broker | the printer itself: MQTT 3.1.1 on **TCP 1883** and **WebSocket 9001** |
| Used by TeleForge | `ws://<printer-ip>:9001`, subprotocol `mqtt` (React Native has no raw TCP; Elegoo's own web page uses the same port) |
| Username / password | `elegoo` / the printer's **access code**, or `123456` when none is set |
| Client id | `0cli` + 6 random hex digits (the web page's format) |
| Clients | about 4 at once (OE's companion is one) → one shared session per printer in the app |
| Network mode | documented for the printer's LAN-only mode; cloud mode may expect a PIN instead |

Every topic carries the printer's **serial number** (`elegoo/<sn>/…`). Elegoo's
tools learn it by UDP discovery (port 52700), which React Native can't send.
TeleForge instead subscribes to `elegoo/#` right after connecting and reads it
from the first topic it sees (status pushes, other clients' heartbeats — what
the community firmware does), racing method 1001 sent **through the relay**
(`send-command`, `Result.Response.Payload.result.sn`). Once known it stays in
memory for the session.

### Session

1. Subscribe `elegoo/<sn>/<client_id>_req/register_response`, publish to
   `elegoo/<sn>/api_register`:
   ```json
   { "client_id": "0cli3fa9c1", "request_id": "0cli3fa9c1_req" }
   ```
   Reply `{ "client_id": "0cli3fa9c1", "error": "ok" }` — or `"too many clients"`.
2. Subscribe `elegoo/<sn>/api_status` (pushes) and
   `elegoo/<sn>/<client_id>/api_response` (replies).
3. Requests go to `elegoo/<sn>/<client_id>/api_request` as
   `{ "id": 4242, "method": 1028, "params": { "extruder": 210 } }`; the reply
   carries the same `id`: `{ "id": 4242, "method": 1028, "result": { "error_code": 0 } }`
   (non-zero `error_code` = refused).
4. Heartbeat: publish `{ "type": "PING" }` to the request topic every 10 s; the
   printer answers `{ "type": "PONG" }`. It drops a client after ~65 s without
   one. TeleForge drops the session after 30 s without any message (left the
   LAN) or 60 s unused, and falls back to the relay.

### Status

Method **1002** returns the full status; the printer then pushes **deltas**
(`method: 6000`, numbered `id`) on `api_status`, deep-merged into it. After
any gap in the numbering (a delta lost: QoS 0) TeleForge asks for 1002 again,
at most every 5 s.

```jsonc
// 1002 result (or the first 6000 push)
{
  "error_code": 0,
  "machine_status": { "status": 2, "sub_status": 2075, "exception_status": [], "progress": 45 },
  "print_status": {
    "filename": "benchy.gcode", "uuid": "b52af24c-…", "current_layer": 225, "total_layer": 500,
    "print_duration": 3600, "total_duration": 8000, "remaining_time_sec": 4400, "progress": 45
  },
  "extruder": { "temperature": 215.0, "target": 220, "filament_detected": 1 },
  "heater_bed": { "temperature": 58.5, "target": 60 },
  "ztemperature_sensor": { "temperature": 33.0 },   // chamber, read-only ("chamber" on some firmware)
  "fans": { "fan": { "speed": 255, "rpm": 5000 }, "aux_fan": { "speed": 178 }, "box_fan": { "speed": 25 } },
  "led": { "status": 1 },
  "toolhead": { "homed_axes": "xyz" },
  "external_device": { "camera": true }
}
// a later 6000 push: only what changed
{ "id": 42, "method": 6000, "result": { "print_status": { "current_layer": 230 }, "extruder": { "temperature": 219.5 } } }
```

`mapCc2Status` follows OE's translation: any `exception_status` or status 14
(emergency stop) → error; status 2 (printing) with sub-status 2501/2502/2505 →
paused, 2503/2504 (stopping/stopped) → idle, 2077 → complete, anything else
(preheating 1045/1405, homing 2801, leveling 2901, resuming 2401, printing 2075)
→ printing; every other status (1 idle, 0 initializing, 5 leveling, 10 homing,
3/4 filament loading…) → idle. As through OE, the print fields keep the last
print's values when idle, so the job is only shown while printing or paused.
Method **1001** (attributes) gives the version shown on the dashboard:

```json
{ "error_code": 0, "hostname": "My Printer", "machine_model": "Centauri Carbon 2", "sn": "CC2ABCD1234567890",
  "ip": "192.168.1.100", "hardware_version": "1.0", "software_version": { "ota_version": "1.0.5.2" } }
```

### Methods used

| Method | What | `params` |
|---|---|---|
| 1001 | attributes (version, serial) | `{}` |
| 1002 | full status | `{}` |
| 1021 / 1023 / 1022 | pause / resume / stop | `{}` |
| 1026 | home | `{ "homed_axes": "xyz" }` |
| 1027 | jog an axis (relative, mm) | `{ "axes": "z", "distance": -1 }` |
| 1028 | nozzle / bed target | `{ "extruder": 210, "heater_bed": 60 }` (either) |
| 1029 | chamber light | `{ "brightness": 255, "power": 1 }` (both: firmware differs, as in OE) |
| 1042 | turn the camera on | `{ "enable": true }` |
| 2005 | combo / CFS slots | `{}` (same reply as through `send-command`) |

Not on the CC2, as through OE: setting the chamber temperature, extruding,
starting a print. The camera is the printer's MJPEG stream at
`http://<printer-ip>:8080/?action=stream`, with no relay stream cap.

## Still to verify with a LIVE test (needs your OE account — scripted)

All resolved by the live run above. Remaining optional confirmation:

- [x] Shared Connection drives `/octoeverywhere-command-api/status` & `list-webcam` for the CC2.
- [x] Supporter Perks present.
- [ ] Confirm the webcam **stream** (not just snapshot) renders acceptably
      through the relay, and check it against OE's webcam limits.
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
- [CC2 community firmware](https://github.com/Neme77/centauri-carbon-2-community) (`cc2-control/src/mqtt.c`: wildcard subscription, serial from topics)
