import { useEffect, useState } from 'react';
import { MoonrakerClient, type MoonrakerTools } from '../core/moonraker';

/**
 * Poll a Klipper printer's Moonraker API (through the relay) for multi-nozzle
 * data. Enable only for Klipper printers; on others the queries would 404.
 * Returns undefined until the first successful fetch (callers fall back to the
 * single hotend from the OE status).
 */
export function useMoonrakerTools(
  baseUrl: string | undefined,
  enabled: boolean,
  intervalMs = 2500,
): MoonrakerTools | undefined {
  const [tools, setTools] = useState<MoonrakerTools>();

  useEffect(() => {
    if (!baseUrl || !enabled) return;
    const client = new MoonrakerClient({ baseUrl });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next = await client.getTools();
        if (!cancelled) setTools(next);
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

  return tools;
}
