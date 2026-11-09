import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PrinterConfig } from '../store/printers';
import { probeLan, type Endpoint, type LanProtocol } from '../lib/endpoint';

/** Last probe result per LAN URL (null: nothing answered), so other screens resolve instantly. */
const reachableCache = new Map<string, LanProtocol | null>();

export interface EndpointResult {
  /** Undefined while a LAN URL is first being probed (or without a printer). */
  endpoint?: Endpoint;
  /** Probe the LAN URL again now (e.g. after a request on the LAN failed). */
  recheck: () => void;
}

/**
 * Pick the path to a printer: its LAN URL when Moonraker (Klipper) or the CC2's
 * MQTT broker answers there (`probeLan`; `timeoutMs` bounds the connection
 * attempt), else the OctoEverywhere relay. Re-probes every `recheckMs`, so
 * leaving or joining the home network switches paths without user action.
 */
export function useEndpoint(
  printer: Pick<PrinterConfig, 'baseUrl' | 'lanUrl' | 'lanAccessCode'> | undefined,
  { recheckMs = 20_000, timeoutMs = 1500 }: { recheckMs?: number; timeoutMs?: number } = {},
): EndpointResult {
  const baseUrl = printer?.baseUrl;
  const lanUrl = printer?.lanUrl;
  const lanAccessCode = printer?.lanAccessCode;
  // Keyed by LAN URL so a result for an old URL is never applied to a new one.
  const [probed, setProbed] = useState<{ lanUrl: string; protocol: LanProtocol | null }>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!lanUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const probe = async () => {
      const protocol = (await probeLan({ baseUrl: baseUrl ?? '', lanUrl, lanAccessCode }, { timeoutMs })) ?? null;
      reachableCache.set(lanUrl, protocol);
      if (cancelled) return;
      setProbed({ lanUrl, protocol });
      timer = setTimeout(probe, recheckMs);
    };

    probe();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `nonce` bumps re-run the effect for a manual recheck.
  }, [baseUrl, lanUrl, lanAccessCode, recheckMs, timeoutMs, nonce]);

  const protocol = !lanUrl
    ? null
    : probed?.lanUrl === lanUrl
      ? probed.protocol
      : reachableCache.get(lanUrl);

  const kind = !baseUrl || protocol === undefined ? undefined : protocol ? 'lan' : 'relay';
  const url = kind === 'lan' ? lanUrl : baseUrl;
  const endpoint = useMemo<Endpoint | undefined>(
    () => (kind && url ? (protocol ? { kind, url, protocol } : { kind, url }) : undefined),
    [kind, url, protocol],
  );
  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  return { endpoint, recheck };
}
