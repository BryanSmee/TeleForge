import { describe, it, expect } from '@jest/globals';
import { mapWebcams, relayWebcamUrl } from '../mapWebcams';
import type { RawListWebcams } from '../raw';

const BASE = 'https://shared-test.octoeverywhere.com';

// The real CC2 list-webcam payload from the spike: jmpeg scheme, port 8080.
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

describe('relayWebcamUrl', () => {
  it('falls back to the QuickCam path for a custom scheme / non-standard port (CC2)', () => {
    expect(relayWebcamUrl(BASE, 'jmpeg://192.168.1.240:8080/?action=stream')).toBe(
      `${BASE}/oe-webcam-stream`,
    );
  });

  it('relays the path for a same-host HTTP webcam on a standard port (Klipper)', () => {
    expect(relayWebcamUrl(BASE, 'http://192.168.1.50/webcam/?action=stream')).toBe(
      `${BASE}/webcam/?action=stream`,
    );
    expect(relayWebcamUrl(`${BASE}/`, 'https://192.168.1.50/webcam2/stream')).toBe(
      `${BASE}/webcam2/stream`,
    );
  });

  it('falls back to the QuickCam path when StreamUrl is missing/unparseable', () => {
    expect(relayWebcamUrl(BASE, null)).toBe(`${BASE}/oe-webcam-stream`);
    expect(relayWebcamUrl(BASE, 'not a url')).toBe(`${BASE}/oe-webcam-stream`);
  });
});

describe('mapWebcams', () => {
  it('derives the CC2 stream URL and never leaks the LAN address', () => {
    const cams = mapWebcams(cc2, BASE);
    expect(cams).toHaveLength(1);
    expect(cams[0].streamUrl).toBe(`${BASE}/oe-webcam-stream`);
    expect(cams[0].streamUrl).not.toContain('192.168');
  });

  it('carries name and display transforms through', () => {
    const cam = mapWebcams(cc2, BASE)[0];
    expect(cam.name).toBe('Elegoo CC2 Cam');
    expect(cam.flipV).toBe(true);
    expect(cam.rotation).toBe(90);
  });

  it('relays a Klipper-style same-host webcam path', () => {
    const klipper: RawListWebcams = {
      Webcams: [
        {
          Name: 'U1',
          FlipH: false,
          FlipV: false,
          Rotation: 0,
          Enabled: true,
          SnapshotUrl: null,
          StreamUrl: 'http://192.168.1.50/webcam/?action=stream',
        },
      ],
      DefaultIndex: 0,
    };
    expect(mapWebcams(klipper, BASE)[0].streamUrl).toBe(`${BASE}/webcam/?action=stream`);
  });

  it('skips disabled cameras', () => {
    const disabled: RawListWebcams = {
      ...cc2,
      Webcams: [{ ...cc2.Webcams[0], Enabled: false }],
    };
    expect(mapWebcams(disabled, BASE)).toHaveLength(0);
  });
});
