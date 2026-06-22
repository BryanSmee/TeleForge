import { describe, it, expect } from '@jest/globals';
import { mapWebcams, webcamStreamUrl } from '../mapWebcams';
import type { RawListWebcams } from '../raw';

const BASE = 'https://shared-test.octoeverywhere.com';

// Mirrors the real list-webcam payload from the spike (LAN StreamUrl).
const raw: RawListWebcams = {
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

describe('mapWebcams', () => {
  it('builds the bare relay stream URL for the default camera, ignoring the LAN StreamUrl', () => {
    const cams = mapWebcams(raw, BASE);
    expect(cams).toHaveLength(1);
    expect(cams[0].streamUrl).toBe(`${BASE}/oe-webcam-stream`);
    expect(cams[0].streamUrl).not.toContain('192.168');
  });

  it('carries name and display transforms through', () => {
    const cam = mapWebcams(raw, BASE)[0];
    expect(cam.name).toBe('Elegoo CC2 Cam');
    expect(cam.flipV).toBe(true);
    expect(cam.rotation).toBe(90);
  });

  it('skips disabled cameras', () => {
    const disabled: RawListWebcams = {
      ...raw,
      Webcams: [{ ...raw.Webcams[0], Enabled: false }],
    };
    expect(mapWebcams(disabled, BASE)).toHaveLength(0);
  });

  it('uses the bare path for the default camera and ?index= for others', () => {
    expect(webcamStreamUrl(`${BASE}/`, 0)).toBe(`${BASE}/oe-webcam-stream`);
    expect(webcamStreamUrl(`${BASE}/`, 1)).toBe(`${BASE}/oe-webcam-stream?index=1`);
  });
});
