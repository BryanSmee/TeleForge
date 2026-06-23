import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Image as ExpoImage } from 'expo-image';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { WebcamSource } from '../core/model/printer';
import { colors } from './ui';

// OctoEverywhere caps a relayed MJPEG stream (~2 min); the stream path runs for a
// window under the cap, then pauses for a manual resume. (Snapshot polling is NOT
// a way around this — through the relay it trips the back-to-back limit, 609 — so
// it's reserved for local LAN / the snapshot-stream toggle.)
const STREAM_WINDOW_MS = 110_000;
const ASSUME_LIVE_MS = 2500;

/**
 * Webcam rendering mode.
 * - `stream`: one continuous MJPEG connection (default). Subject to OE's ~2-min
 *   stream cap, handled with pause/resume.
 * - `snapshot`: poll single JPEGs. Through the OE relay this trips the
 *   back-to-back webcam limit (609), so it's only suitable over local LAN — kept
 *   for the planned per-printer snapshot/stream toggle.
 */
export type WebcamMode = 'stream' | 'snapshot';

function transformStyle(cam: WebcamSource) {
  return [
    { rotate: `${cam.rotation}deg` },
    { scaleX: cam.flipH ? -1 : 1 },
    { scaleY: cam.flipV ? -1 : 1 },
  ];
}

export function WebcamView({
  cam,
  style,
  fullscreen = false,
  mode = 'stream',
  onFullscreen,
  onClose,
}: {
  cam: WebcamSource;
  style?: ViewStyle;
  fullscreen?: boolean;
  /** Defaults to the MJPEG stream; snapshot is for local LAN / the future toggle. */
  mode?: WebcamMode;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  // In fullscreen, match the screen to the camera's aspect: landscape cameras
  // (wider than tall, after any 90/270 rotation) lock to landscape. Restore
  // portrait on exit. Measured from the snapshot; defaults to landscape if the
  // size can't be read (e.g. MJPEG-only cameras).
  useEffect(() => {
    if (!fullscreen) return;
    let active = true;
    const lock = (landscape: boolean) => {
      if (!active) return;
      ScreenOrientation.lockAsync(
        landscape
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
    };
    Image.getSize(
      cam.snapshotUrl ?? cam.streamUrl,
      (w, h) => {
        const rotated = cam.rotation === 90 || cam.rotation === 270;
        lock((rotated ? h : w) >= (rotated ? w : h));
      },
      () => lock(true),
    );
    return () => {
      active = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [fullscreen, cam]);

  const controls = (
    <>
      {onFullscreen && (
        <Pressable style={[styles.iconButton, styles.topRight]} onPress={onFullscreen} hitSlop={8}>
          <Text style={styles.icon}>⤢</Text>
        </Pressable>
      )}
      {onClose && (
        <Pressable style={[styles.iconButton, styles.topRight]} onPress={onClose} hitSlop={8}>
          <Text style={styles.icon}>✕</Text>
        </Pressable>
      )}
    </>
  );

  // Snapshot only over local LAN (it trips OE's 609 limit through the relay) and
  // only for the inline preview; fullscreen always streams.
  const useSnapshot = !fullscreen && mode === 'snapshot' && !!cam.snapshotUrl;

  return (
    <View style={[styles.container, style]}>
      {useSnapshot ? <SnapshotView cam={cam} intervalMs={1000} /> : <MjpegView cam={cam} />}
      {controls}
    </View>
  );
}

/**
 * Polls the camera's JPEG snapshot via expo-image. expo-image keeps the last
 * frame on screen while the next loads (no flash) and `cachePolicy="none"`
 * forces a fresh network fetch every tick.
 *
 * The source uses a `#fragment` to make expo-image treat each tick as a new
 * source (so it refetches) — but a URL fragment is NOT sent to the server, so
 * the actual request stays the bare snapshot URL. A query-string timestamp made
 * the camera serve stale "recording" frames; this avoids any query string.
 */
function SnapshotView({ cam, intervalMs }: { cam: WebcamSource; intervalMs: number }) {
  const [tick, setTick] = useState(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [errMsg, setErrMsg] = useState<string>();

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const source = `${cam.snapshotUrl}#${tick}`;

  return (
    <>
      <ExpoImage
        source={source}
        style={[styles.media, { transform: transformStyle(cam) }]}
        contentFit="contain"
        cachePolicy="none"
        transition={0}
        onLoad={() => {
          setLoadedOnce(true);
          setErrMsg(undefined);
        }}
        onError={(e) => setErrMsg(e?.error || 'Failed to load snapshot')}
      />
      {!loadedOnce && !errMsg && (
        <View style={styles.overlayCenter} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {!loadedOnce && errMsg && (
        <Pressable
          style={styles.overlayCenter}
          onPress={() => {
            setErrMsg(undefined);
            setTick((t) => t + 1);
          }}
        >
          <Text style={styles.title}>Webcam unavailable</Text>
          <Text style={styles.muted} numberOfLines={3}>
            {errMsg}
          </Text>
          <Text style={[styles.muted, { marginTop: 8 }]}>Tap to retry</Text>
        </Pressable>
      )}
    </>
  );
}

/**
 * MJPEG fallback for cameras with no snapshot URL (e.g. the Elegoo CC2's
 * QuickCam). Rendered inside an <img> so a relay redirect fails the image
 * rather than navigating the whole view away.
 */
function MjpegView({ cam }: { cam: WebcamSource }) {
  const [streaming, setStreaming] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!streaming) return;
    const timer = setTimeout(() => setStreaming(false), STREAM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [streaming, nonce]);

  useEffect(() => {
    if (!streaming) return;
    liveTimer.current = setTimeout(() => setStatus('live'), ASSUME_LIVE_MS);
    return () => clearTimeout(liveTimer.current);
  }, [streaming, nonce]);

  const origin = useMemo(() => originOf(cam.streamUrl), [cam.streamUrl]);
  const html = useMemo(() => streamHtml(cam), [cam]);

  const restart = () => {
    setStreaming(true);
    setStatus('connecting');
    setNonce((n) => n + 1);
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'load') {
      clearTimeout(liveTimer.current);
      setStatus('live');
    } else if (msg === 'error') {
      clearTimeout(liveTimer.current);
      setStatus('error');
    }
  };

  if (!streaming) {
    return (
      <Pressable style={styles.overlayCenter} onPress={restart}>
        <Text style={styles.title}>Stream paused</Text>
        <Text style={styles.muted}>Tap to resume</Text>
      </Pressable>
    );
  }

  return (
    <>
      <WebView
        key={nonce}
        originWhitelist={['*']}
        source={{ html, baseUrl: origin }}
        style={styles.media}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowsInlineMediaPlayback
        scrollEnabled={false}
        onMessage={onMessage}
        onError={() => setStatus('error')}
      />
      {status === 'connecting' && (
        <View style={styles.overlayCenter} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {status === 'error' && (
        <Pressable style={styles.overlayCenter} onPress={restart}>
          <Text style={styles.title}>Stream unavailable</Text>
          <Text style={styles.muted}>Tap to retry</Text>
        </Pressable>
      )}
    </>
  );
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function streamHtml(cam: WebcamSource): string {
  const transform = `rotate(${cam.rotation}deg) scaleX(${cam.flipH ? -1 : 1}) scaleY(${cam.flipV ? -1 : 1})`;
  const post = (m: string) => `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('${m}')`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden">
<img src="${cam.streamUrl}" onload="${post('load')}" onerror="${post('error')}"
     style="max-width:100%;max-height:100%;transform:${transform}"/>
</body></html>`;
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden', position: 'relative' },
  media: { flex: 1, width: '100%', backgroundColor: '#000' },
  overlayCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 4 },
  iconButton: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRight: { top: 8, right: 8 },
  icon: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
