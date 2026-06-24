import { useCallback, useEffect, useState } from 'react';
import { OctoEverywhereClient, type PrinterState } from '@teleforge/core';

export interface PrinterStatusResult {
  state?: PrinterState;
  error?: Error;
  loading: boolean;
  /** Force an immediate refresh. */
  refresh: () => void;
}

/**
 * Last-known status per base URL, kept for the lifetime of the JS session.
 * Re-opening a printer seeds from this immediately so the screen isn't blank
 * for a relay round-trip; the live poll then refreshes it.
 */
const statusCache = new Map<string, PrinterState>();

/**
 * Poll a printer's normalized status on an interval.
 *
 * Polls `getStatus` (cheap, uniform across CC2/Klipper). Live webcam streaming
 * is handled separately by the webcam screen, since the OE relay caps stream
 * length (~2 min) and back-to-back streams — see docs/spike-findings.md.
 */
export function usePrinterStatus(baseUrl: string | undefined, intervalMs = 2500): PrinterStatusResult {
  // Lazy init from the cache (runs once) so re-opens render instantly without a
  // synchronous setState in the effect (which the react-hooks lint rule flags).
  const [state, setState] = useState<PrinterState | undefined>(() =>
    baseUrl ? statusCache.get(baseUrl) : undefined,
  );
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!baseUrl) return;

    const client = new OctoEverywhereClient({ baseUrl });
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
  }, [baseUrl, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { state, error, loading, refresh };
}
