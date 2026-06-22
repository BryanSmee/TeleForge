# OctoEverywhere App Connections — Auth & Relay (research notes)

> Source: OctoEverywhere App Connection docs (links at bottom). These are
> research notes to design against; field names and exact URLs **must be
> re-verified** against the live API docs before implementation, as some pages
> are JS-rendered and could not be fetched verbatim.

## TL;DR

OctoEverywhere offers an **"App Connection"** integration for third-party apps.
The flow is **OAuth-like but implemented as a hosted WebView portal redirect**.
The user authorizes (with their OE login + 2FA), picks a printer, and your app
receives a **scoped token**. After that, your app makes **normal HTTP and
WebSocket requests through a relay URL** exactly as if it were on the printer's
LAN — only the base URL and an auth header differ.

**There is no confidential client secret involved** → the whole flow runs
client-side, no backend required.

## Prerequisite: register your app

Your app needs an **`appId`** — a string assigned by OctoEverywhere that tags
which App Connections were created by which app. Obtain this from OE before
building the portal flow.

## Authorization flow (portal)

```
┌─────────────┐                              ┌──────────────────────┐
│ TeleForge   │                              │ OctoEverywhere Portal│
│  (Expo app) │                              │  (hosted web page)   │
└─────┬───────┘                              └──────────┬───────────┘
      │ 1. Open in-app WebView →                        │
      │    https://.../app-portal?appId=...             │
      │      &returnUrl=teleforge://oe-callback         │
      │      [&printerId=...]   (optional preselect)     │
      │ ───────────────────────────────────────────────▶│
      │                                                  │ 2. User logs in to OE
      │                                                  │    (+ 2FA), grants access,
      │                                                  │    selects a printer
      │ 3. Portal redirects to returnUrl with results    │
      │    teleforge://oe-callback?appApiToken=...       │
      │      &appConnectionUrl=...&printerId=...          │
      │ ◀───────────────────────────────────────────────│
      │ 4. App intercepts the navigation, parses query   │
      │    params, stores them in expo-secure-store      │
      ▼                                                  │
  OctoEverywhereTransport({ appConnectionUrl, appApiToken })
```

### Portal request parameters (to verify)

| Param | Required | Meaning |
|-------|----------|---------|
| `appId` | yes | Your registered app identifier |
| `returnUrl` | recommended | Custom completion URL (e.g. a `teleforge://` deep link). Falls back to a default completion URL if omitted |
| `printerId` | optional | Preselect a specific printer (if the app already knows the OE Printer ID) |

### What the portal returns (once only — store immediately)

- **`appApiToken`** — the App API token, **scoped to one App Connection and one
  printer**.
- **App Connection URL** — the relay base URL used for all subsequent requests.
- **credentials** — any additional returned auth values.

> ⚠️ These values are returned **only once**. Persist them in
> `expo-secure-store` on receipt. Losing them means re-running the portal.

### Multi-printer implication

Because a token is scoped to **one printer**, supporting both the CC2 and the U1
means running the portal **once per printer**, yielding **two
`{appConnectionUrl, appApiToken}` pairs**. TeleForge stores a list of these,
keyed by a local printer id.

## Using the relay

- Make requests against the **App Connection URL** as if it were the printer's
  local address. The relay supports **all HTTP verbs, WebSockets**, and (for
  Bambu only, not relevant here) an MQTT-over-WS proxy.
- **Auth:** send the `appApiToken` as an **`AppToken` header**. Some POST APIs
  also accept it in the JSON body.
- This is what lets a single adapter target either LAN or OE: same protocol
  calls, different base URL + the `AppToken` header injected by the transport.

### Diagnostics & limits

- **App Connection Info API** — call it when the relay won't connect to learn
  why, and to read the account's current **limits** (webcam-streaming, file
  upload/download). Relevant for continuous webcam viewing; LAN transport avoids
  these limits.

### Custom status codes

The relay uses **custom HTTP status codes in the `6xx` range** to signal
relay-specific conditions (e.g. printer offline/unreachable through the tunnel).
The transport layer should map these to typed errors rather than treating them
as generic HTTP failures. (Cross-check against OE's "Custom Error Codes" page.)

## How this maps to TeleForge code

- `packages/core/octoeverywhere/auth.ts` — build the portal URL; parse the
  completion redirect.
- `packages/core/octoeverywhere/appConnection.ts` — App Connection Info / limits.
- `packages/core/transport/octoeverywhere.ts` — `OctoEverywhereTransport`:
  prefixes `appConnectionUrl`, injects the `AppToken` header on HTTP and WS,
  maps `6xx` codes to typed errors.
- App layer: an `expo-web-browser` / `react-native-webview` screen that runs the
  portal and writes the returned pair to `expo-secure-store`.

## Links

- [App Connections overview](https://docs.octoeverywhere.com/app-connections/)
- [App Connection Portal](https://docs.octoeverywhere.com/app-connections/portal/)
- [App Connection APIs overview](https://docs.octoeverywhere.com/app-connections/apis/overview/)
- [Printer API Remote Access](https://docs.octoeverywhere.com/printer-api-remote-access/)
- [Custom Error Codes](https://docs.octoeverywhere.com/error-codes/)
