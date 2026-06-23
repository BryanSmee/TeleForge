#!/usr/bin/env node
// TeleForge probe — dump a Klipper/Moonraker printer's tool + filament data
// through the OctoEverywhere relay. READ-ONLY (only queries object state).
//
// OctoEverywhere's normalized status only reports one hotend, so for a
// multi-nozzle printer (the Snapmaker U1's 4 nozzles) we read Moonraker directly.
//
// Usage:
//   OE_URL="<u1-shared-url>" node spike/probe-moonraker.mjs
//
// Paste the output back. The interesting bits:
//   - which `extruder` / `extruder1` / `extruder2` / `extruder3` objects exist
//   - any filament/material objects (filament_switch_sensor, spoolman, gcode
//     macros, or Snapmaker-specific objects) that tell us what's loaded per tool

const base = process.env.OE_URL?.replace(/\/+$/, '');
if (!base) {
  console.error('Set OE_URL to the printer Shared Connection URL.');
  process.exit(1);
}

async function get(path) {
  try {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* leave as text */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

function show(label, r) {
  console.log(`\n=== ${label} → HTTP ${r.status} ===`);
  console.log((r.json ? JSON.stringify(r.json, null, 2) : r.text).slice(0, 6000));
}

// 1) Confirm Moonraker is reachable through the relay.
show('server/info', await get('/server/info'));

// 2) List every available printer object — reveals extruderN + filament objects.
show('printer/objects/list', await get('/printer/objects/list'));

// 3) Query the tools + likely filament-related objects we know the names of.
const objects = [
  'extruder', 'extruder1', 'extruder2', 'extruder3',
  'heater_bed', 'toolhead', 'print_stats', 'gcode_move',
].map((o) => `${encodeURIComponent(o)}`).join('&');
show('printer/objects/query (tools)', await get(`/printer/objects/query?${objects}`));

// 4) Spoolman (if configured) — maps spools/filament to the printer.
show('server/spoolman/spool_id', await get('/server/spoolman/spool_id'));

// 5) Per-tool filament candidates. print_task_config / snapmaker objects may
//    carry the loaded material/color per nozzle; filament sensors show presence.
show(
  'printer/objects/query (filament)',
  await get(
    '/printer/objects/query?print_task_config&filament_detect' +
      '&filament_motion_sensor%20e0_filament&filament_motion_sensor%20e1_filament' +
      '&filament_motion_sensor%20e2_filament&filament_motion_sensor%20e3_filament',
  ),
);

console.log('\n---\nLooking for: per-extruder temperature/target, and anything naming the loaded filament/material/color per tool.');
