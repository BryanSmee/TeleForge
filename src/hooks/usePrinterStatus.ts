import { useCallback, useEffect, useState } from 'react';
import { OctoEverywhereClient } from '../core/octoeverywhere';
import type { PrinterState } from '../core/model/printer';

export interface PrinterStatusResult {
  state?: PrinterState;
  error?: Error;
  loading: boolean;
  /** Force an immediate refresh. */
  refresh: () => void;
}

/**
 * Poll a printer's normalized status on an interval.
 *
 * Polls `getStatus` (cheap, uniform across CC2/Klipper). Live webcam streaming
 * is handled separately by the webcam screen, since the OE relay caps stream
 * length (~2 min) and back-to-back streams — see docs/spike-findings.md.
 */
export function usePrinterStatus(baseUrl: string | undefined, intervalMs = 2500): PrinterStatusResult {
  const [state, setState] = useState<PrinterState>();
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
