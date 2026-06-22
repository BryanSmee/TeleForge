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
import type { WebcamSource } from '../core/model/printer';
import { colors } from './ui';

// OctoEverywhere caps a relayed MJPEG stream (~2 min) then back-to-back limits it
// (607/609). The MJPEG path streams for a window under the cap, then pauses for a
// manual resume. The snapshot path polls single JPEGs and isn't subject to that.
const STREAM_WINDOW_MS = 110_000;
const ASSUME_LIVE_MS = 2500;

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
  onFullscreen,
  onClose,
}: {
  cam: WebcamSource;
  style?: ViewStyle;
  /** Fullscreen polls snapshots faster for a smoother view. */
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
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

  return (
    <View style={[styles.container, style]}>
      {cam.snapshotUrl ? (
        <SnapshotView cam={cam} intervalMs={fullscreen ? 400 : 1000} />
      ) : (
        <MjpegView cam={cam} />
      )}
      {controls}
    </View>
  );
}

/**
 * Polls the camera's JPEG snapshot via a native <Image>. This is the robust
 * default: no WebView, no MJPEG quirks, and not subject to the stream cap.
 */
function SnapshotView({ cam, intervalMs }: { cam: WebcamSource; intervalMs: number }) {
  const [tick, setTick] = useState(0);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (error) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, error]);

  const uri = useMemo(() => {
    const sep = cam.snapshotUrl!.includes('?') ? '&' : '?';
    return `${cam.snapshotUrl}${sep}_t=${tick}`;
  }, [cam.snapshotUrl, tick]);

  if (error) {
    return (
      <Pressable
        style={styles.overlayCenter}
        onPress={() => {
          setError(false);
          setTick((t) => t + 1);
        }}
      >
        <Text style={styles.title}>Webcam unavailable</Text>
        <Text style={styles.muted}>Tap to retry</Text>
      </Pressable>
    );
  }

  return (
    <>
      <Image
        source={{ uri }}
        style={[styles.media, { transform: transformStyle(cam) }]}
        resizeMode="contain"
        onLoad={() => setLoadedOnce(true)}
        onError={() => setError(true)}
        fadeDuration={0}
      />
      {!loadedOnce && (
        <View style={styles.overlayCenter} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
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
