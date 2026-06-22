# TeleForge — Architecture Sketch

> Pre-implementation sketch. Interfaces below are illustrative TypeScript to
> pin down the shape of the system, not final code.

> **⚠️ Revised by the spike ([`spike-findings.md`](./spike-findings.md)).** The
> Adapter/Transport model below is the *full* design, used for **local LAN
> mode**. For the **remote MVP**, the OctoEverywhere **Plugin/Command API**
> already normalizes every printer, so v1 is a single `OctoEverywhereClient`
> hitting `/octoeverywhere-command-api/` (poll `status`, call
> `pause`/`resume`/`cancel`/`set-temp`) — no per-model adapter required. The
> per-protocol adapters here apply to the later local-mode and advanced (fan /
> raw-MQTT) work.

## 1. Layered overview

```
┌──────────────────────────────────────────────────────────────┐
│ apps/mobile  (Expo + expo-router + NativeWind)                 │
│   screens: PrinterList · PrinterDashboard · Webcam · AddPrinter│
│   state:   Zustand store (live)  ·  TanStack Query (one-shot)  │
└───────────────▲────────────────────────────────────────────────┘
                │ normalized PrinterState + commands
┌───────────────┴────────────────────────────────────────────────┐
│ packages/core  (pure TypeScript — reusable, no RN deps)          │
│                                                                  │
│  PrinterAdapter ──┬── CC2Adapter   (SDCP / JSON over WS)         │
│   (normalize)     └── U1Adapter    (Moonraker JSON-RPC over WS)  │
│        │                                                          │
│        ▼ uses                                                     │
│  Transport ───────┬── LocalTransport          (LAN ip)           │
│   (where/how)     └── OctoEverywhereTransport  (relay + AppToken) │
│                                                                  │
│  octoeverywhere/  auth (portal) · appConnection (info/limits)    │
└──────────────────────────────────────────────────────────────────┘
                │ HTTP / WebSocket
                ▼
   LAN (ws://printer/...)   or   OE relay (https://relay/... + AppToken)
                │
                ▼
        CC2 (SDCP)   /   U1 (Klipper+Moonraker)
```

**Two orthogonal axes:**

- **Adapter = *what* protocol** the printer speaks (SDCP vs Moonraker) →
  normalizes into one `PrinterState`.
- **Transport = *where/how* we reach it** (LAN vs OE relay).

An adapter is constructed *with* a transport, so any printer can be reached
locally or remotely without the adapter knowing the difference:

```ts
new CC2Adapter(new OctoEverywhereTransport({ baseUrl, bearer }));   // bearer = authBearerToken
new U1Adapter(new LocalTransport({ baseUrl: "http://192.168.1.50" }));
```

## 2. Normalized domain model

```ts
type PrinterModel = "cc2" | "u1";

type ConnectionState =
  | "offline" | "connecting" | "idle" | "printing" | "paused" | "error";

type TempChannel = {
  id: "nozzle" | "nozzle2" | "bed" | "chamber";
  label: string;
  actual: number;            // °C
  target: number;            // °C (0 = off)
  settable: boolean;
};

type Fan = {
  id: string;                // "part", "aux", "chamber", ...
  label: string;
  speedPct: number;          // 0–100
  settable: boolean;
};

type Job = {
  filename: string;
  thumbnailUrl?: string;
  progressPct: number;       // 0–100
  elapsedSec: number;
  remainingSec?: number;     // → ETA = now + remainingSec
  currentLayer?: number;
  totalLayers?: number;
};

type WebcamSource = {
  kind: "mjpeg" | "webrtc" | "hls";
  url: string;
};

type Capabilities = {
  canPause: boolean; canResume: boolean; canCancel: boolean;
  canSetTemp: boolean; canSetFan: boolean;
  hasChamber: boolean; hasWebcam: boolean;
};

type PrinterState = {
  id: string;
  model: PrinterModel;
  name: string;
  connection: ConnectionState;
  job?: Job;                 // present when printing/paused
  temps: TempChannel[];
  fans: Fan[];
  webcam?: WebcamSource;
  capabilities: Capabilities;
  lastUpdated: number;       // epoch ms
  error?: string;
};
```

## 3. Core interfaces

```ts
// Transport: decouples LAN vs OE relay from the protocol.
interface Transport {
  readonly baseUrl: string;
  http(req: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<{ status: number; json(): Promise<unknown> }>;
  // OE relay maps custom 6xx codes → typed TransportError before this resolves.
  openSocket(path: string): WebSocketLike;
}

// Adapter: one per printer model. Owns the live socket, emits normalized state.
interface PrinterAdapter {
  readonly id: string;
  readonly model: PrinterModel;

  connect(): Promise<void>;
  disconnect(): void;

  /** Push-based live updates. Returns an unsubscribe fn. */
  subscribe(cb: (state: PrinterState) => void): () => void;
  getState(): PrinterState;

  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  setTemperature(channel: TempChannel["id"], targetC: number): Promise<void>;
  setFanSpeed(fanId: string, pct: number): Promise<void>;

  getWebcam(): WebcamSource | null;
}
```

### Adapter responsibilities

- **CC2Adapter** — opens the SDCP WebSocket, sends discovery/attach, subscribes
  to status messages, maps SDCP JSON → `PrinterState`. Sends SDCP command
  messages for pause/resume/cancel/temps/fans. (Mind SDCP's known misspelled
  field names, e.g. `CurrenCoord`.) Reference impls:
  `elegoo-homeassistant`, `sdcp-centauri-carbon`.
- **U1Adapter** — Moonraker: `printer.objects.subscribe` over the JSON-RPC
  WebSocket for live `extruder`/`heater_bed`/`fan`/`print_stats`/`display_status`
  objects; `printer.print.pause|resume|cancel`; gcode `M104/M140/M106` (or
  Moonraker convenience endpoints) for setpoints.

## 4. Data flow (live)

```
CC2 SDCP WS ──json──▶ CC2Adapter.map() ──PrinterState──▶ Zustand store[id]
                                                              │
                                              UI components subscribe
                                              (re-render on change)
```

- One adapter instance per connected printer; each owns its socket and writes
  into `usePrinterStore` keyed by printer id.
- **TanStack Query** handles one-shot REST (file lists, print history) and
  benefits from caching/retries; **Zustand** holds the high-frequency live
  state pushed by sockets.
- Commands are optimistic where safe (e.g. show "pausing…"), reconciled by the
  next socket update.

## 5. Repository structure (Expo + pnpm workspaces)

```
teleforge/
├─ apps/
│  └─ mobile/                  # Expo app
│     ├─ app/                  # expo-router routes
│     │  ├─ index.tsx          # printer list
│     │  ├─ printer/[id].tsx   # dashboard (temps, job, controls)
│     │  ├─ printer/[id]/webcam.tsx
│     │  └─ add-printer.tsx    # OE portal WebView flow
│     ├─ src/store/            # Zustand stores, hooks
│     └─ app.config.ts         # Expo config (+ react-native-webrtc plugin)
├─ packages/
│  └─ core/                    # pure TS, RN-independent, web-reusable
│     ├─ model/                # PrinterState & types
│     ├─ printers/
│     │  ├─ adapter.ts         # PrinterAdapter interface
│     │  ├─ cc2/               # SDCP client + CC2Adapter
│     │  └─ u1/                # Moonraker client + U1Adapter
│     ├─ transport/
│     │  ├─ transport.ts       # Transport interface + TransportError
│     │  ├─ local.ts
│     │  └─ octoeverywhere.ts
│     └─ octoeverywhere/
│        ├─ auth.ts            # portal URL + redirect parsing
│        ├─ connection.ts      # Bearer/basic auth, 600–613 error mapping
│        └─ appInfo.ts         # /api/appconnection/info (AppToken), limits
├─ docs/
└─ package.json                # workspaces
```

`packages/core` deliberately has **no React Native imports** so a future web
client (or tests in Node) can reuse the exact adapters and transports.

## 6. Webcam handling

| Path | Source | Render |
|------|--------|--------|
| LAN, simple | CarbonicSidecar MJPEG (`:3000`) | `react-native-webview` (MJPEG) |
| LAN, low latency | go2rtc WebRTC (`:1984`) | `react-native-webrtc` (needs Dev Client) |
| Remote | OE webcam stream endpoint | WebView (subject to OE streaming limits) |

Start with **MJPEG in a WebView** (keeps you on Expo Go, simplest); add WebRTC
only if latency demands it (forces a custom Dev Client build).

## 7. Add-printer / auth sequence

See [`octoeverywhere-auth.md`](./octoeverywhere-auth.md). Summary: WebView opens
the OE portal → user authorizes & picks a printer → portal redirects to a
`teleforge://` deep link carrying `url` (substitute base) + `authBearerToken`
(connection auth) + `appApiToken` (account-info only) → stored in
`expo-secure-store` (one set per printer) → used to build an
`OctoEverywhereTransport` that injects the **Bearer** auth header.
