import { useCallback, useEffect, useState } from 'react';
import type { PrinterState } from '@teleforge/core';
import { controlFor, type Endpoint } from '../lib/endpoint';

export interface PrinterStatusResult {
  state?: PrinterState;
  error?: Error;
  loading: boolean;
  /** Force an immediate refresh. */
  refresh: () => void;
}

/**
 * Last-known status per endpoint URL, kept for the lifetime of the JS session.
 * Re-opening a printer seeds from this immediately so the screen isn't blank
 * for a relay round-trip; the live poll then refreshes it.
 */
const statusCache = new Map<string, PrinterState>();

/**
 * Poll a printer's normalized status on an interval, from whichever endpoint
 * `useEndpoint` resolved (Moonraker or the CC2's MQTT session on the LAN, the OE
 * command API otherwise).
 *
 * Polls `getStatus` (cheap, uniform across CC2/Klipper). Live webcam streaming
 * is handled separately by the webcam screen, since the OE relay caps stream
 * length (~2 min) and back-to-back streams — see docs/spike-findings.md.
 */
export function usePrinterStatus(endpoint: Endpoint | undefined, intervalMs = 2500): PrinterStatusResult {
  const kind = endpoint?.kind;
  const protocol = endpoint?.protocol;
  const baseUrl = endpoint?.url;
  // Lazy init from the cache (runs once) so re-opens render instantly without a
  // synchronous setState in the effect (which the react-hooks lint rule flags).
  const [state, setState] = useState<PrinterState | undefined>(() =>
    baseUrl ? statusCache.get(baseUrl) : undefined,
  );
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!kind || !baseUrl) return;

    const client = controlFor({ kind, url: baseUrl, protocol });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      setLoading(true);
      try {
        const next = await client.getStatus();
        statusCache.set(baseUrl, next);
        if (!cancelled) {
          setState(next);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Schedule the next poll only after this one settles (no overlap).
          timer = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `nonce` bumps re-run the effect for a manual refresh.
  }, [kind, baseUrl, protocol, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { state, error, loading, refresh };
}
