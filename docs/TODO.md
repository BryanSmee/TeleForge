# TODO

## Bugs to fix

 - Re-verify: webcam preview updating when idle. The preview now uses the live
   MJPEG stream (it previously only updated during a job); confirm it updates
   when idle. If still static, the camera likely only produces frames while a
   print is running (a printer-side limitation).

## Important

The list of things to implement (that I know) are missing:
 - Printer settings (a settings screen exists: rename / edit URL / remove)
    - Add LAN URL to bypass octoeverywhere
    - Add option to switch between snapshot and stream (for printer view and full screen separately)
      — `WebcamView` already takes a `mode` ('stream' | 'snapshot') prop; needs a
      persisted per-printer setting + UI. (Snapshot only works over LAN; through
      the OE relay it trips the 609 back-to-back limit.)
 - Notifications
 - File explorer on the CC2 (the U1 lists gcodes + start/restart via Moonraker; CC2 file ops need raw MQTT)
 - More languages (en + fr ship today; add locales under `src/i18n/locales`)
 - Controls (the model + OE API already support these; UI is what's missing)
    - Motion controls (home / move axis / extrude) — DONE via OE `home`/`move-axis`/
      `extrude`, gated by `canMove`/`canHome` (see `MotionControls`)
    - Fan speed on the CC2 (raw MQTT — the U1 part-cooling/generic fans are done via Moonraker)


## CC2-specific (needs CC2 on hand to build/verify)

 - Verify the combo/CFS filament display against a real load/unload/swap (read path implemented via MQTT method 2005 → `canvas_info`)
 - Verify existing features on real CC2 hardware (status, pause/resume/cancel, temps)


## Nice to have

 - Console
 - gcode viewer
 - Spoolman integration
 - Smoother fullscreen webcam via WebRTC (camera-streamer / go2rtc)
 - NativeWind styling pass
 - App Connection portal — OAuth-style login for a published, multi-user app (see octoeverywhere-auth.md)


## Tech debt / infra

 - `packages/core` is extracted as a path-aliased `@teleforge/core` package
   (tsconfig paths + jest moduleNameMapper + Metro `extraNodeModules`). Promote
   to a real bun workspace once a web client consumes it — note bun's
   `workspaces` key flipped the install to isolated linking and broke the flat
   node_modules, so that migration needs care.
 - Broaden UI/component test coverage (hooks + SetTempModal/Button/MotionControls covered via @testing-library/react-native; screens with expo-router/store wiring still untested)
 - `expo export` + bun: bun hoists `ws@7` where Metro's dev server needs `ws@8` (a temporary `ws` override works; `expo start` is unaffected)
