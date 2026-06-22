# OctoEverywhere App Connections — Auth & Relay

> Verified against the OctoEverywhere API docs source
> (`OctoEverywhereDocs/octoeverywhere-api-docs`). Supersedes the earlier draft,
> which incorrectly used a single `AppToken` header for everything.

## TL;DR

OctoEverywhere's **"App Connection"** is an OAuth-style integration implemented
as a **hosted WebView portal redirect**. The user authorizes (OE login), picks a
printer, and the portal **mints a one-time set of credentials**. After that your
app talks to the printer by hitting a **substitute hostname** exactly as if it
were on the LAN — same paths, methods, body, headers, WebSockets, webcam.

Two important truths discovered during the spike:

1. **There are two different credentials** (don't confuse them):
   - **Connection auth** — a **Bearer token** *or* HTTP **basic auth** — required
     on **every** request to the printer (HTTP, WebSocket, webcam). This is what
     the command API uses.
   - **`appApiToken`** — a *separate* token used **only** for OctoEverywhere's
     own account API (`/api/appconnection/info`) via an `AppToken` header.
2. **App Connections require the user to have OctoEverywhere Supporter Perks.**
   Without it, all calls return `605`. (OE says it may become free later.)

No confidential client secret is involved → the flow runs fully client-side, no
backend required.

## Prerequisite: an `appId`

The portal needs an **`appId`** assigned by OctoEverywhere (contact OE support).
For testing you can use the public **`devtest`** id:
`https://octoeverywhere.com/appportal/v1/?appId=devtest`.

## Authorization flow (portal)

```
┌─────────────┐                              ┌──────────────────────┐
│ TeleForge   │                              │ OctoEverywhere Portal │
│  (Expo app) │                              │  (hosted web page)    │
└─────┬───────┘                              └──────────┬────────────┘
      │ 1. WebView → https://octoeverywhere.com/appportal/v1/         │
      │      ?appId=...&returnUrl=teleforge://oe-cb[&printerId=...]    │
      │ ────────────────────────────────────────────────────────────▶│
      │                                       2. User logs in to OE,   │
      │                                          (creates acct/printer │
      │                                          /supporter if needed),│
      │                                          authorizes + picks    │
      │                                          the printer           │
      │ 3. Redirect to returnUrl (default …/appportal/v1/complete)     │
      │    ?success=true&id=…&url=…&authBearerToken=…&appApiToken=…    │
      │      &authBasicHttpUser=…&authBasicHttpPassword=…              │
      │ ◀────────────────────────────────────────────────────────────│
      │ 4. App intercepts navigation, parses params, stores in        │
      │    expo-secure-store                                           │
      ▼
  OctoEverywhereConnection({ baseUrl: url, bearer: authBearerToken })
```

### Portal request parameters (`GET /appportal/v1/`)

| Param | Required | Meaning |
|-------|----------|---------|
| `appId` | yes | Your assigned app id (`devtest` for testing) |
| `returnUrl` | optional | URL-encoded completion URL (e.g. a `teleforge://` deep link). Default `…/appportal/v1/complete`. Result params are appended to it |
| `printerId` | optional | Preselect a printer (the OE Printer ID; queryable locally from the plugin at `/api/plugin/octoeverywhere`) |
| `appLogoUrl` | optional | URL-encoded logo, shown 100×100 in the portal UI |
| `octoPrintApiKeyAppName` | optional | If present, OE also generates an OctoPrint API key (OctoPrint only; N/A for CC2/Bambu) |

> `authType` is no longer needed — connections are always `enhanced`, returning
> **both** a bearer token and basic-auth credentials; pick whichever you prefer.

### Completion params (returned **once** — store immediately)

| Param | Use |
|-------|-----|
| `success` | Did the flow succeed |
| `id` | The App Connection Id (store it; identifies this connection) |
| `url` | **Substitute base URL** for printer requests (e.g. `https://app-xxxx.octoeverywhere.com`) |
| `authBearerToken` | **Connection auth** — `Authorization: Bearer …` on every request |
| `authBasicHttpUser` / `authBasicHttpPassword` | Alternative connection auth (basic) |
| `appApiToken` | For the OE **account info** API only (`AppToken` header) |
| `printername` | User-assigned printer name (for display) |
| `printerLastKnownLocalIp` | Optional — last known LAN IP (handy for local discovery) |
| `octoPrintApiKey` | Optional — only if OctoPrint key generation was requested |

> ⚠️ `authBearerToken`, the `auth*` values, and `appApiToken` are returned **only
> once** and can't be re-queried. Persist in `expo-secure-store` on receipt.

### Multi-printer implication

A connection grants access to **one printer**. Supporting the CC2 **and** the U1
means running the portal **once per printer** → two `{id, url, authBearerToken}`
sets. TeleForge stores a list, keyed by a local printer id.

## Using the connection

- Replace the printer's local address with the returned **`url`**; everything
  else (path, method, body, headers, WebSockets, webcam) relays unchanged. Always
  use `https`.
- **Auth (required on every request, incl. WS/webcam):** `Authorization: Bearer
  <authBearerToken>` **or** HTTP basic auth.
- The normalized **command API** is therefore:
  `GET <url>/octoeverywhere-command-api/status` + the Bearer header.

### Diagnostics & limits

- **App Connection Info API** — `GET <url>/api/appconnection/info` with the
  `AppToken: <appApiToken>` header. Reports whether the connection is valid,
  whether the printer is currently connected to OE, the printer's local IP, and
  account **limits** (max file transfer size, webcam stream length, back-to-back
  webcam limits). Useful before/while streaming the webcam; LAN transport avoids
  these limits.

### Custom relay status codes (`600`–`613`)

Returned by the relay (and the info API) for connection problems — handle these
distinctly from real printer HTTP codes:

| Code | Meaning |
|------|---------|
| `600` | Server/plugin/unknown error (temporary) |
| `601` | Printer not connected to OE (off/offline) |
| `602` | OE→printer timed out |
| `603` | App Connection not found |
| `604` | App Connection revoked/expired |
| `605` | Owner no longer an OE Supporter |
| `606` | Invalid/missing connection credentials |
| `607` / `608` | File download / upload size limit exceeded |
| `609` | Webcam back-to-back limit exceeded |
| `610` | Plugin update required |

## How this maps to TeleForge code

- `packages/core/octoeverywhere/auth.ts` — build the portal URL; parse the
  completion redirect into `{id, url, bearer, appApiToken, ...}`.
- `packages/core/octoeverywhere/connection.ts` — `OctoEverywhereConnection`:
  prefixes `url`, injects the **Bearer** (or basic) auth header on HTTP + WS,
  maps `600–613` to typed errors.
- `packages/core/octoeverywhere/appInfo.ts` — `/api/appconnection/info` via the
  `AppToken` header (status + limits).
- App layer: an `expo-web-browser` / `react-native-webview` screen that runs the
  portal and writes the returned set to `expo-secure-store` (one per printer).

## Links

- [App Connections overview](https://docs.octoeverywhere.com/app-connections/)
- [App Connection Portal](https://docs.octoeverywhere.com/app-connections/portal/)
- [App Connection Usage + error codes](https://docs.octoeverywhere.com/app-connections/)
- [Plugin / Command API](https://docs.octoeverywhere.com/plugin-api/)
- Portal try-it (devtest): `https://octoeverywhere.com/appportal/v1/?appId=devtest`
