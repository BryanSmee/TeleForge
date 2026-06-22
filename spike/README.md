# Spike scripts

The source-level half of the OctoEverywhere spike is written up in
[`../docs/spike-findings.md`](../docs/spike-findings.md). This folder holds the
**live half** — checks that need your own OctoEverywhere account + CC2.

> **Prerequisite:** an OctoEverywhere **Supporter** account (remote API access
> requires it; otherwise calls return `605`). ✅ confirmed available.

## Getting a connection URL — two options

### Option A — Shared Connection (recommended; no app registration)

The simplest path for a personal app. You create the link yourself:

1. Go to <https://octoeverywhere.com/sharedconnections> and create a Shared
   Connection for your **CC2**.
2. Copy the generated URL. Note whatever auth it gives you — it may be embedded
   in the URL, or shown as a Bearer token / basic user+password.

No `appId`, no OAuth portal, no one-time-token to capture.

### Option B — App Connection portal (for a published multi-user app)

Credentials are **minted once** by the portal (not shown in any dashboard). Use
the public **`devtest`** app id for testing:

1. Open `https://octoeverywhere.com/appportal/v1/?appId=devtest`, log in, pick
   the **CC2**, authorize.
2. From the completion redirect address bar, copy (URL-decoded): `url`,
   `authBearerToken`, and optionally `appApiToken`. These are returned **once**.

## Running `verify-oe.mjs`

Read-only: calls `ping`, `status`, `list-webcam`, and (if `OE_APITOKEN` is set)
the account `info` API. Nothing is paused/cancelled/changed. Pass whichever auth
your connection uses:

```bash
# Shared Connection (try no-auth first; add creds if you get 401/403/606)
OE_URL="<sharedConnectionUrl>" node spike/verify-oe.mjs
OE_URL="..." OE_BEARER="<token>" node spike/verify-oe.mjs
OE_URL="..." OE_USER="<u>" OE_PASS="<p>" node spike/verify-oe.mjs

# App Connection
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
