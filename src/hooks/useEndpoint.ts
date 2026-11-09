import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoonrakerClient } from '@teleforge/core';
import type { PrinterConfig } from '../store/printers';
import type { Endpoint } from '../lib/endpoint';

/** Last probe result per LAN URL, so other screens resolve instantly. */
const reachableCache = new Map<string, boolean>();

export interface EndpointResult {
  /** Undefined while a LAN URL is first being probed (or without a printer). */
  endpoint?: Endpoint;
  /** Probe the LAN URL again now (e.g. after a request on the LAN failed). */
  recheck: () => void;
}

/**
 * Pick the path to a printer: its LAN URL when Moonraker answers there within
 * `timeoutMs`, else the OctoEverywhere relay. Re-probes every `recheckMs`, so
 * leaving or joining the home network switches paths without user action.
 *
 * Only Klipper/Moonraker printers can be reached on the LAN (the probe is
 * Moonraker's `/server/info`); any other printer always falls back to the relay.
 */
export function useEndpoint(
  printer: Pick<PrinterConfig, 'baseUrl' | 'lanUrl'> | undefined,
  { recheckMs = 20_000, timeoutMs = 1500 }: { recheckMs?: number; timeoutMs?: number } = {},
): EndpointResult {
  const baseUrl = printer?.baseUrl;
  const lanUrl = printer?.lanUrl;
  // Keyed by LAN URL so a result for an old URL is never applied to a new one.
  const [probed, setProbed] = useState<{ lanUrl: string; reachable: boolean }>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!lanUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const probe = async () => {
      const reachable = await MoonrakerClient.probe(lanUrl, { timeoutMs });
      reachableCache.set(lanUrl, reachable);
      if (cancelled) return;
      setProbed({ lanUrl, reachable });
      timer = setTimeout(probe, recheckMs);
    };

    probe();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `nonce` bumps re-run the effect for a manual recheck.
  }, [lanUrl, recheckMs, timeoutMs, nonce]);

  const reachable = !lanUrl
    ? false
    : probed?.lanUrl === lanUrl
      ? probed.reachable
      : reachableCache.get(lanUrl);

  const kind = !baseUrl || reachable === undefined ? undefined : reachable ? 'lan' : 'relay';
  const url = kind === 'lan' ? lanUrl : baseUrl;
  const endpoint = useMemo<Endpoint | undefined>(
    () => (kind && url ? { kind, url } : undefined),
    [kind, url],
  );
  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  return { endpoint, recheck };
}
