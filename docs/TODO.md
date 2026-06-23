# TODO

## Bugs to fix

 - Re-verify: webcam preview updating when idle. The preview now uses the live
   MJPEG stream (it previously only updated during a job); confirm it updates
   when idle. If still static, the camera likely only produces frames while a
   print is running (a printer-side limitation).

## Important

The list of things to implement (that I know) are missing:
 - Printer settings
    - Add LAN URL to bypass octoeverywhere
    - Add option to switch between snapshot and stream (for printer view and full screen separately)
      — `WebcamView` already takes a `mode` ('stream' | 'snapshot') prop; needs a
      persisted per-printer setting + UI. (Snapshot only works over LAN; through
      the OE relay it trips the 609 back-to-back limit.)
 - Notifications
 - File explorer with the possibility to (re)start a job
 - Open forwarded UI (just open the printer URL in the webview)
 - Language Support
 - Controls (the model + OE API already support these; UI is what's missing)
    - Set temperature per nozzle + bed (client `setTemp` already takes a tool number)
    - Fan speed (U1: Moonraker `M106` / fan objects; CC2: raw MQTT)
    - Light toggle (U1 `cavity_led`, CC2 chamber light)


## CC2-specific (needs CC2 on hand to build/verify)

 - CC2 combo extension filament (4 filaments → 1 extruder, over MQTT) — needs a CC2 MQTT status probe to find the per-slot data, then map onto the single extruder
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

 - Extract `packages/core` into a workspace (reusable by a future web client)
 - UI / hook tests (only pure logic is covered today)
 - `expo export` + bun: bun hoists `ws@7` where Metro's dev server needs `ws@8` (a temporary `ws` override works; `expo start` is unaffected)
