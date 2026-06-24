import { useEffect, useState } from 'react';
import { OctoEverywhereClient, mapCanvas, type FilamentSystem } from '@teleforge/core';

/** Last-known filament system per base URL — see the note in usePrinterStatus. */
const cfsCache = new Map<string, FilamentSystem>();

/**
 * Poll the CC2's combo / CFS filament slots (via OE's `send-command` MQTT
 * passthrough). Enable only for the CC2 — other platforms don't speak this
 * protocol. Polls slower than status: the slots change rarely (only on
 * load/unload/swap) and each query is a full relay→MQTT round-trip.
 *
 * Returns undefined until the first successful fetch (or when no combo unit is
 * attached), so callers can simply hide the filament UI.
 */
export function useFilamentSystem(
  baseUrl: string | undefined,
  enabled: boolean,
  intervalMs = 8000,
): FilamentSystem | undefined {
  const [cfs, setCfs] = useState<FilamentSystem | undefined>(() =>
    baseUrl ? cfsCache.get(baseUrl) : undefined,
  );

  useEffect(() => {
    if (!baseUrl || !enabled) return;
    const client = new OctoEverywhereClient({ baseUrl });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = mapCanvas(await client.getCanvasInfo());
        if (next) cfsCache.set(baseUrl, next);
        if (!cancelled && next) setCfs(next);
      } catch {
        // Leave the last good value; just retry next tick.
      } finally {
        if (!cancelled) timer = setTimeout(poll, intervalMs);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseUrl, enabled, intervalMs]);

  return cfs;
}
