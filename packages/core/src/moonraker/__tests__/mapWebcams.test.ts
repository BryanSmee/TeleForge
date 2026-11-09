import { describe, it, expect } from '@jest/globals';
import { mapMoonrakerWebcams } from '../mapWebcams';

const LAN = 'http://192.168.1.50/';

describe('mapMoonrakerWebcams', () => {
  it('resolves relative URLs against the LAN base and keeps the transform', () => {
    const [cam] = mapMoonrakerWebcams(
      [
        {
          name: 'Nozzle',
          enabled: true,
          stream_url: '/webcam/stream.mjpg?fps=10',
          snapshot_url: '/webcam/snapshot.jpg',
          flip_horizontal: true,
          flip_vertical: false,
          rotation: 90,
        },
      ],
      LAN,
    );
    expect(cam).toEqual({
      name: 'Nozzle',
      kind: 'mjpeg',
      streamUrl: 'http://192.168.1.50/webcam/stream.mjpg',
      snapshotUrl: 'http://192.168.1.50/webcam/snapshot.jpg',
      flipH: true,
      flipV: false,
      rotation: 90,
    });
  });

  it('keeps absolute URLs (e.g. a camera on another port) and maps viewers as pages', () => {
    const cams = mapMoonrakerWebcams(
      [
        { name: 'Cam', stream_url: 'http://192.168.1.50:8080/?action=stream' },
        { name: 'Screen', stream_url: '/screen/' },
      ],
      LAN,
    );
    expect(cams[0]).toMatchObject({ kind: 'mjpeg', streamUrl: 'http://192.168.1.50:8080/?action=stream', rotation: 0 });
    expect(cams[0].snapshotUrl).toBeUndefined();
    expect(cams[1]).toMatchObject({ kind: 'page', streamUrl: 'http://192.168.1.50/screen/' });
  });

  it('skips disabled cameras and unusable URLs', () => {
    const cams = mapMoonrakerWebcams(
      [
        { name: 'Off', enabled: false, stream_url: '/webcam/?action=stream' },
        { name: 'Weird', stream_url: 'jmpeg://cam' },
        { name: 'None' },
      ],
      LAN,
    );
    expect(cams).toEqual([]);
  });
});
