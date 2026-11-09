import type { WebcamSource } from '../model/printer';
import { isMjpegUrl, stripFps } from '../octoeverywhere/mapWebcams';

/** One entry of Moonraker's `server/webcams/list` result (fields we use). */
export interface RawMoonrakerWebcam {
  name?: string;
  enabled?: boolean;
  stream_url?: string;
  snapshot_url?: string;
  flip_horizontal?: boolean;
  flip_vertical?: boolean;
  rotation?: number;
}

/** Resolve a Moonraker webcam URL (usually a path like `/webcam/?action=stream`) against the LAN base. */
function resolve(base: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return /^https?:\/\//i.test(raw) ? raw : undefined;
}

/**
 * Map Moonraker's configured webcams into render-ready WebcamSources reached
 * directly on the LAN (no relay, so no URL rewriting beyond the base).
 */
export function mapMoonrakerWebcams(webcams: RawMoonrakerWebcam[], baseUrl: string): WebcamSource[] {
  const base = baseUrl.replace(/\/+$/, '');
  return webcams
    .filter((w) => w.enabled !== false)
    .flatMap((w) => {
      const stream = resolve(base, w.stream_url);
      if (!stream) return [];
      const streamUrl = stripFps(stream);
      return [
        {
          name: w.name ?? '',
          kind: isMjpegUrl(streamUrl) ? 'mjpeg' : 'page',
          streamUrl,
          snapshotUrl: resolve(base, w.snapshot_url),
          flipH: !!w.flip_horizontal,
          flipV: !!w.flip_vertical,
          rotation: w.rotation ?? 0,
        } satisfies WebcamSource,
      ];
    });
}
