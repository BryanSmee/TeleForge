# Spike scripts

The source-level half of the OctoEverywhere spike is written up in
[`../docs/spike-findings.md`](../docs/spike-findings.md). This folder holds the
**live half** — checks that need your own OctoEverywhere account + CC2.

## Getting credentials (there is no "token" page)

App Connection credentials are **minted once** by the App Connection Portal —
they are not shown anywhere in the OctoEverywhere dashboard, and can't be
re-queried. For a quick manual test you don't need to register an app; use the
public **`devtest`** app id:

> **Prerequisite:** your OctoEverywhere account must have **Supporter Perks** —
> App Connections require it. Without it every call returns `605`.

1. Open in a browser:
   `https://octoeverywhere.com/appportal/v1/?appId=devtest`
2. Log in, select your **CC2**, and authorize.
3. The portal redirects to
   `…/appportal/v1/complete?success=true&id=…&url=…&authBearerToken=…&appApiToken=…&authBasicHttpUser=…&authBasicHttpPassword=…`
4. Copy these (URL-**decode** them) from the address bar:
   - `url` → the substitute base URL (e.g. `https://app-xxxx.octoeverywhere.com`)
   - `authBearerToken` → connection auth for the **printer/command API**
   - `appApiToken` → *optional*, only for the OE **account info** API

> These are returned **once**. Copy immediately; if lost, redo the portal.
> For a real (non-`devtest`) app you need your own `appId` — contact OE support.

## Running `verify-oe.mjs`

Read-only: calls `ping`, `status`, `list-webcam`, and (if `OE_APITOKEN` is set)
the account `info` API. Nothing is paused/cancelled/changed.

```bash
OE_URL="<url>" OE_BEARER="<authBearerToken>" OE_APITOKEN="<appApiToken>" \
  node spike/verify-oe.mjs
```

Confirm against [`../docs/spike-findings.md`](../docs/spike-findings.md):
- `status` → `JobStatus.CurrentPrint` with `Progress`, `TimeLeftSec` (ETA),
  `FileName`, `Temps`, and a non-zero `Features` bitfield.
- `list-webcam` → `Webcams[]` with a stream/snapshot URL.
- A `6xx` code is an OctoEverywhere relay error (the script labels the common
  ones — e.g. `601` printer offline, `605` not a Supporter, `606` bad creds).

This validates the assumption the whole architecture rests on: a third-party App
Connection can drive the normalized command API for the CC2 remotely.
