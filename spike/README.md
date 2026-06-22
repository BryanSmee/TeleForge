# Spike scripts

The source-level half of the OctoEverywhere spike is written up in
[`../docs/spike-findings.md`](../docs/spike-findings.md). This folder holds the
**live half** — checks that need your own OctoEverywhere account + CC2, which
can't run in CI/sandbox.

## `verify-oe.mjs`

Read-only probe of the OE Plugin/Command API through an App Connection. It only
calls `ping`, `status`, `list-webcam`, and `get-connection-info` — nothing is
paused, cancelled, or changed.

1. Run the OE App Connection portal for your CC2 to obtain an `appApiToken` and
   App Connection URL (see [`../docs/octoeverywhere-auth.md`](../docs/octoeverywhere-auth.md)).
2. Run (Node 18+):

   ```bash
   OE_URL="<appConnectionUrl>" OE_TOKEN="<appApiToken>" node spike/verify-oe.mjs
   ```

3. Confirm against [`../docs/spike-findings.md`](../docs/spike-findings.md):
   - `status` → `JobStatus.CurrentPrint` with `Progress`, `TimeLeftSec` (ETA),
     `FileName`, `Temps`, and a non-zero `Features` bitfield.
   - `list-webcam` → `Webcams[]` with a stream/snapshot URL.
   - HTTP `6xx` → an OctoEverywhere relay error; `404` → the command path is
     joined onto the App Connection URL differently than assumed.

This validates the core assumption that the whole architecture rests on: a
third-party App Connection token can drive the normalized command API for the
CC2 remotely.
