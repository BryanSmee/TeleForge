import { describe, it, expect } from '@jest/globals';
import { mapWebcams, relayWebcamUrl } from '../mapWebcams';
import type { RawListWebcams } from '../raw';

const BASE = 'https://shared-test.octoeverywhere.com';

// Real CC2 list-webcam payload: jmpeg scheme, port 8080, no snapshot.
const cc2: RawListWebcams = {
  Webcams: [
    {
      Name: 'Elegoo CC2 Cam',
      FlipH: false,
      FlipV: true,
      Rotation: 90,
      Enabled: true,
      SnapshotUrl: null,
      StreamUrl: 'jmpeg://192.168.1.240:8080/?action=stream',
    },
  ],
  DefaultIndex: 0,
};

// Real U1 (Klipper/camera-streamer) payload: relative paths.
const u1: RawListWebcams = {
  Webcams: [
    {
      Name: 'Case',
      FlipH: false,
      FlipV: false,
      Rotation: 0,
      Enabled: true,
      SnapshotUrl: '/webcam/snapshot.jpg',
      StreamUrl: '/webcam/stream.mjpg?fps=10',
    },
  ],
  DefaultIndex: 0,
};

describe('relayWebcamUrl', () => {
  it('relays a relative Moonraker path directly, stripping the rejected fps param', () => {
    expect(relayWebcamUrl(BASE, '/webcam/stream.mjpg?fps=10')).toBe(`${BASE}/webcam/stream.mjpg`);
    expect(relayWebcamUrl(`${BASE}/`, '/webcam/stream.mjpg')).toBe(`${BASE}/webcam/stream.mjpg`);
  });

  it('relays the path of an absolute HTTP webcam on a standard port', () => {
    expect(relayWebcamUrl(BASE, 'http://192.168.1.50/webcam/stream')).toBe(`${BASE}/webcam/stream`);
  });

  it('falls back to the QuickCam path for a custom scheme / non-standard port (CC2)', () => {
    expect(relayWebcamUrl(BASE, 'jmpeg://192.168.1.240:8080/?action=stream')).toBe(
      `${BASE}/oe-webcam-stream`,
    );
  });

  it('falls back to the QuickCam path when StreamUrl is missing/unparseable', () => {
    expect(relayWebcamUrl(BASE, null)).toBe(`${BASE}/oe-webcam-stream`);
    expect(relayWebcamUrl(BASE, 'not a url')).toBe(`${BASE}/oe-webcam-stream`);
  });
});

describe('mapWebcams', () => {
  it('maps the U1 (relative paths) to relayed stream + snapshot URLs (fps stripped)', () => {
    const cam = mapWebcams(u1, BASE)[0];
    expect(cam.streamUrl).toBe(`${BASE}/webcam/stream.mjpg`);
    expect(cam.snapshotUrl).toBe(`${BASE}/webcam/snapshot.jpg`);
    expect(cam.name).toBe('Case');
  });

  it('maps the CC2 to the QuickCam path with no snapshot, never leaking the LAN address', () => {
    const cam = mapWebcams(cc2, BASE)[0];
    expect(cam.streamUrl).toBe(`${BASE}/oe-webcam-stream`);
    expect(cam.snapshotUrl).toBeUndefined();
    expect(cam.streamUrl).not.toContain('192.168');
    expect(cam.flipV).toBe(true);
    expect(cam.rotation).toBe(90);
  });

  it('skips disabled cameras', () => {
    const disabled: RawListWebcams = {
      ...u1,
      Webcams: [{ ...u1.Webcams[0], Enabled: false }],
    };
    expect(mapWebcams(disabled, BASE)).toHaveLength(0);
  });
});
