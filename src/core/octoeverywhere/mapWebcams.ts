import type { WebcamSource } from '../model/printer';
import type { RawListWebcams } from './raw';

/**
 * Build the remote MJPEG stream URL for a webcam through the OE relay.
 *
 * The `StreamUrl` from `list-webcam` is a LAN address and won't work remotely;
 * OE serves the stream at the fixed relay path `/oe-webcam-stream` (confirmed
 * live, see docs/spike-findings.md). The camera index selection (`?index=` vs
 * the `oe-webcam-index` header) is still TO CONFIRM empirically — we pass it as
 * a query param for now, which is harmless for single-camera printers.
 */
export function webcamStreamUrl(baseUrl: string, index: number): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/oe-webcam-stream?index=${index}`;
}

/** Map a raw `list-webcam` result into normalized, render-ready WebcamSources. */
export function mapWebcams(raw: RawListWebcams, baseUrl: string): WebcamSource[] {
  return raw.Webcams.filter((w) => w.Enabled !== false).map((w, i) => ({
    name: w.Name,
    streamUrl: webcamStreamUrl(baseUrl, i),
    flipH: w.FlipH,
    flipV: w.FlipV,
    rotation: w.Rotation,
  }));
}
