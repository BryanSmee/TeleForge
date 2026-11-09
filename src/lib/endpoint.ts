import { MoonrakerClient, OctoEverywhereClient, type PrinterControl } from '@teleforge/core';

/**
 * Where a printer is reached right now: directly on the LAN (Moonraker) or
 * through the OctoEverywhere relay. Resolved per printer by `useEndpoint`.
 */
export interface Endpoint {
  kind: 'lan' | 'relay';
  /** Base URL for this path; Moonraker paths (`/printer`, `/server`) work on both. */
  url: string;
}

/**
 * One client per endpoint for the JS session, so every screen and hook shares
 * the same instance (and whatever it caches, like Moonraker's object list).
 */
const controls = new Map<string, PrinterControl>();

/** The status/commands client for an endpoint: Moonraker on the LAN, the OE command API on the relay. */
export function controlFor(endpoint: Endpoint): PrinterControl {
  const key = `${endpoint.kind}:${endpoint.url}`;
  let control = controls.get(key);
  if (!control) {
    control =
      endpoint.kind === 'lan'
        ? new MoonrakerClient({ baseUrl: endpoint.url })
        : new OctoEverywhereClient({ baseUrl: endpoint.url });
    controls.set(key, control);
  }
  return control;
}
