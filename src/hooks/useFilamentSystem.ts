import { useEffect, useState } from 'react';
import { OctoEverywhereClient, mapCanvas, type Cc2LanClient, type FilamentSystem } from '@teleforge/core';
import { controlFor, type Endpoint } from '../lib/endpoint';

/** Last-known filament system per endpoint URL — see the note in usePrinterStatus. */
const cfsCache = new Map<string, FilamentSystem>();

/**
 * Poll the CC2's combo / CFS filament slots: over the CC2's own MQTT session on
 * the LAN, else via OE's `send-command` MQTT passthrough. Enable only for the
 * CC2 — other platforms don't speak this protocol. Polls slower than status:
 * the slots change rarely (only on load/unload/swap) and through the relay each
 * query is a full relay→MQTT round-trip.
 *
 * Returns undefined until the first successful fetch (or when no combo unit is
 * attached), so callers can simply hide the filament UI.
 */
export function useFilamentSystem(
  endpoint: Endpoint | undefined,
  enabled: boolean,
  intervalMs = 8000,
): FilamentSystem | undefined {
  const baseUrl = endpoint?.url;
  const protocol = endpoint?.protocol;
  const [cfs, setCfs] = useState<FilamentSystem | undefined>(() =>
    baseUrl ? cfsCache.get(baseUrl) : undefined,
  );

  useEffect(() => {
    if (!baseUrl || !enabled) return;
    const relay = protocol === 'cc2' ? undefined : new OctoEverywhereClient({ baseUrl });
    // The LAN client is looked up on each poll: it's replaced when its access code changes.
    const client = () => relay ?? (controlFor({ kind: 'lan', url: baseUrl, protocol }) as Cc2LanClient);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = mapCanvas(await client().getCanvasInfo());
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
  }, [baseUrl, protocol, enabled, intervalMs]);

  return cfs;
}
