import type { WebcamSource } from '../model/printer';
import type { RawListWebcams } from './raw';

/**
 * Derive the remote MJPEG stream URL for a webcam through the OE relay.
 *
 * The raw `StreamUrl` from `list-webcam` is a LAN address, so it can't be used
 * directly — but its shape tells us how to reach the camera remotely (verified
 * behaviour differs by platform, see docs/spike-findings.md):
 *
 *  - A same-host HTTP(S) webcam on a standard port (e.g. Klipper/Mainsail's
 *    `http://<ip>/webcam/?action=stream`) is reachable by **relaying its path**
 *    through the connection: `<base>/webcam/?action=stream`.
 *  - A custom scheme (`jmpeg://`, `webrtc://`) or a non-standard port (e.g. the
 *    Elegoo CC2's `:8080`) can't be relayed on the single connection host, so
 *    OctoEverywhere serves it at the fixed QuickCam path `/oe-webcam-stream`.
 */
export function relayWebcamUrl(baseUrl: string, rawStreamUrl: string | null): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (rawStreamUrl) {
    try {
      const u = new URL(rawStreamUrl);
      const isHttp = u.protocol === 'http:' || u.protocol === 'https:';
      const standardPort = u.port === '' || u.port === '80' || u.port === '443';
      if (isHttp && standardPort) {
        return `${base}${u.pathname}${u.search}`;
      }
    } catch {
      // Unparseable — fall through to the QuickCam path.
    }
  }
  return `${base}/oe-webcam-stream`;
}

/** Map a raw `list-webcam` result into normalized, render-ready WebcamSources. */
export function mapWebcams(raw: RawListWebcams, baseUrl: string): WebcamSource[] {
  return raw.Webcams.filter((w) => w.Enabled !== false).map((w) => ({
    name: w.Name,
    streamUrl: relayWebcamUrl(baseUrl, w.StreamUrl),
    flipH: w.FlipH,
    flipV: w.FlipV,
    rotation: w.Rotation,
  }));
}
