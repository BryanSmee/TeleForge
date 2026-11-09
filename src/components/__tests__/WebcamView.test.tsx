import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, act } from '@testing-library/react-native';
import type { WebcamSource } from '@teleforge/core';
import { WebcamView } from '../WebcamView';

jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { WebView: (props: object) => <View testID="webview" {...props} /> };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => {}),
  OrientationLock: { LANDSCAPE: 1, PORTRAIT_UP: 2 },
}));
// Echo the key back so assertions read against the key.
jest.mock('../../i18n/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const CAM: WebcamSource = {
  name: 'Cam',
  kind: 'mjpeg',
  streamUrl: 'https://shared-x.octoeverywhere.com/oe-webcam-stream',
  flipH: false,
  flipV: false,
  rotation: 0,
};

// Just past the stream window (110 s) that keeps relayed streams under OE's ~2-min cap.
const PAST_WINDOW_MS = 111_000;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WebcamView stream window', () => {
  it('pauses a relayed stream (limited by default) before the OE cap', async () => {
    const view = await render(<WebcamView cam={CAM} />);
    expect(view.getByTestId('webview')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(PAST_WINDOW_MS);
    });
    expect(view.queryByTestId('webview')).toBeNull();
    expect(view.getByText('webcam.streamPaused')).toBeTruthy();
  });

  it('pauses when limited is set explicitly', async () => {
    const view = await render(<WebcamView cam={CAM} limited />);
    await act(async () => {
      jest.advanceTimersByTime(PAST_WINDOW_MS);
    });
    expect(view.getByText('webcam.streamPaused')).toBeTruthy();
  });

  it('keeps streaming on the LAN (limited=false)', async () => {
    const view = await render(<WebcamView cam={{ ...CAM, streamUrl: 'http://192.168.1.50/webcam/?action=stream' }} limited={false} />);
    await act(async () => {
      jest.advanceTimersByTime(PAST_WINDOW_MS * 5);
    });
    expect(view.getByTestId('webview')).toBeTruthy();
    expect(view.queryByText('webcam.streamPaused')).toBeNull();
  });
});
