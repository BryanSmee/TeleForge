import type { WebcamSource } from '../model/printer';
import type { RawListWebcams } from './raw';

/**
 * Turn a raw webcam URL from `list-webcam` into a URL reachable through the OE
 * relay, or null if it can't be relayed on the connection host.
 *
 * Moonraker reports webcam URLs as **relative paths** (e.g.
 * `/webcam/stream.mjpg?fps=10`, `/webcam/snapshot.jpg`) — those relay directly
 * by prefixing the connection base. An absolute HTTP(S) URL on a standard port
 * is relayed by its path. A custom scheme (`jmpeg://`) or non-standard port
 * (the CC2's `:8080`) can't be relayed on the single host → null.
 */
function relayPath(base: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith('/')) return `${base}${raw}`;
  try {
    const u = new URL(raw);
    const isHttp = u.protocol === 'http:' || u.protocol === 'https:';
    const standardPort = u.port === '' || u.port === '80' || u.port === '443';
    if (isHttp && standardPort) {
      return `${base}${u.pathname}${u.search}`;
    }
  } catch {
    // Unparseable — not relayable.
  }
  return null;
}

/**
 * Stream URL for a webcam. Falls back to OctoEverywhere's QuickCam relay path
 * (`/oe-webcam-stream`) when the raw URL can't be relayed directly — that's how
 * the Elegoo CC2 (jmpeg/:8080) is reached.
 */
export function relayWebcamUrl(baseUrl: string, rawStreamUrl: string | null): string {
  const base = baseUrl.replace(/\/+$/, '');
  return relayPath(base, rawStreamUrl) ?? `${base}/oe-webcam-stream`;
}

/** Map a raw `list-webcam` result into normalized, render-ready WebcamSources. */
export function mapWebcams(raw: RawListWebcams, baseUrl: string): WebcamSource[] {
  const base = baseUrl.replace(/\/+$/, '');
  return raw.Webcams.filter((w) => w.Enabled !== false).map((w) => ({
    name: w.Name,
    streamUrl: relayPath(base, w.StreamUrl) ?? `${base}/oe-webcam-stream`,
    snapshotUrl: relayPath(base, w.SnapshotUrl) ?? undefined,
    flipH: w.FlipH,
    flipV: w.FlipV,
    rotation: w.Rotation,
  }));
}
