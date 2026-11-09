import {
  Cc2LanClient,
  MoonrakerClient,
  OctoEverywhereClient,
  type PrinterControl,
} from '@teleforge/core';
import type { PrinterConfig } from '../store/printers';

/** What answers at a printer's LAN URL: Moonraker (Klipper) or the CC2's MQTT broker. */
export type LanProtocol = 'moonraker' | 'cc2';

/**
 * Where a printer is reached right now: directly on the LAN (Moonraker, or the
 * CC2 over MQTT) or through the OctoEverywhere relay. Resolved per printer by
 * `useEndpoint`.
 */
export interface Endpoint {
  kind: 'lan' | 'relay';
  /** Base URL for this path; Moonraker paths (`/printer`, `/server`) work on both. */
  url: string;
  /** On the LAN, which API answers there. */
  protocol?: LanProtocol;
}

/**
 * One CC2 client per LAN URL for the JS session: it holds the printer's MQTT
 * session (the printer only takes a few clients), shared by every screen.
 */
const cc2Clients = new Map<string, { client: Cc2LanClient; accessCode?: string }>();

/**
 * The CC2 LAN client for a printer, created on first use. The serial number its
 * topics need is read from the broker or, failing that, asked through the relay.
 * A changed access code replaces the client (and closes the old session).
 */
export function cc2ClientFor(printer: Pick<PrinterConfig, 'baseUrl' | 'lanUrl' | 'lanAccessCode'>): Cc2LanClient {
  const lanUrl = printer.lanUrl!;
  const existing = cc2Clients.get(lanUrl);
  if (existing && existing.accessCode === printer.lanAccessCode) return existing.client;
  existing?.client.close();
  const relay = new OctoEverywhereClient({ baseUrl: printer.baseUrl });
  const client = new Cc2LanClient({
    lanUrl,
    accessCode: printer.lanAccessCode,
    serialNumber: existing?.client.serialNumber,
    lookupSerial: () => relay.getCc2SerialNumber(),
  });
  cc2Clients.set(lanUrl, { client, accessCode: printer.lanAccessCode });
  return client;
}

/** The protocol last found at each LAN URL, so later probes only try that one. */
const knownProtocols = new Map<string, LanProtocol>();

/**
 * Which API answers at the printer's LAN URL, if any: Moonraker's `/server/info`
 * (Klipper) and the CC2's MQTT broker are tried side by side until one has
 * answered, then only that one. The CC2 probe opens (or reuses) the session the
 * dashboard then reads its status from.
 */
export async function probeLan(
  printer: Pick<PrinterConfig, 'baseUrl' | 'lanUrl' | 'lanAccessCode'>,
  { timeoutMs = 1500 }: { timeoutMs?: number } = {},
): Promise<LanProtocol | undefined> {
  const { lanUrl } = printer;
  if (!lanUrl) return undefined;
  const known = knownProtocols.get(lanUrl);
  const [moonraker, cc2] = await Promise.all([
    known !== 'cc2' && MoonrakerClient.probe(lanUrl, { timeoutMs }),
    known !== 'moonraker' && cc2ClientFor(printer).probe(),
  ]);
  const found = moonraker ? 'moonraker' : cc2 ? 'cc2' : undefined;
  if (found) knownProtocols.set(lanUrl, found);
  return found;
}

/**
 * One client per endpoint for the JS session, so every screen and hook shares
 * the same instance (and whatever it caches, like Moonraker's object list).
 */
const controls = new Map<string, PrinterControl>();

/**
 * The status/commands client for an endpoint: Moonraker or the CC2's MQTT
 * client on the LAN, the OE command API on the relay.
 */
export function controlFor(endpoint: Endpoint): PrinterControl {
  if (endpoint.kind === 'lan' && endpoint.protocol === 'cc2') {
    // Created by the probe that resolved this endpoint.
    return cc2Clients.get(endpoint.url)?.client ?? cc2ClientFor({ baseUrl: '', lanUrl: endpoint.url });
  }
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
