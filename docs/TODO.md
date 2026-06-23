# TODO

## Bugs to fix

 - Webcam in printer details only update when the a job is in progress

## Important

The list of things to implement (that I know) are missing:
 - Printer settings
    - Add LAN URL to bypass octoeverywhere
    - Add option to switch between snapshot and stream (for printer view and full screen separately)
 - Notifications
 - File explorer with the possibility to (re)start a job
 - Open forwarded UI (just open the printer URL in the webview)
 - Language Support
 - Controls (the model + OE API already support these; UI is what's missing)
    - Set temperature per nozzle + bed (client `setTemp` already takes a tool number)
    - Fan speed (U1: Moonraker `M106` / fan objects; CC2: raw MQTT)
    - Light toggle (U1 `cavity_led`, CC2 chamber light)
 - Multiple webcams: camera selector (U1 also exposes a "Gui" screen-mirror cam; dashboard shows only the first today)


## Blocked — no CC2 access right now

 - CC2 combo extension filament (4 filaments → 1 extruder, over MQTT) — needs a CC2 MQTT status probe to find the per-slot data, then map onto the single extruder
 - Re-verify the CC2 webcam (OE QuickCam `/oe-webcam-stream`) once the companion app is stable
 - Verify existing features on real CC2 hardware (status, pause/resume/cancel, temps)


## Nice to have

 - Console
 - gcode viewer
 - Spoolman integration
 - Motion controls (home / move axis / extrude)
 - Gadget AI failure-detection status (already returned in OE `status`)
 - Smoother fullscreen webcam via WebRTC (camera-streamer / go2rtc)
 - NativeWind styling pass
 - App Connection portal — OAuth-style login for a published, multi-user app (see octoeverywhere-auth.md)


## Tech debt / infra

 - CI: GitHub Action running `bun run typecheck` + `lint` + `test` on PRs
 - Extract `packages/core` into a workspace (reusable by a future web client)
 - UI / hook tests (only pure logic is covered today)
 - `expo export` + bun: bun hoists `ws@7` where Metro's dev server needs `ws@8` (a temporary `ws` override works; `expo start` is unaffected)
