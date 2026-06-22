import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { WebcamSource } from '../core/model/printer';
import { colors } from './ui';

// OctoEverywhere caps a relayed webcam stream (~2 min) then back-to-back limits
// it (607/609). Stream for a window under the cap, then pause and let the user
// resume — never auto-reconnect in a loop. See docs/spike-findings.md.
const STREAM_WINDOW_MS = 110_000;

type Status = 'connecting' | 'live' | 'error';

export function WebcamView({
  cam,
  style,
  onFullscreen,
  onClose,
}: {
  cam: WebcamSource;
  style?: ViewStyle;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  const [streaming, setStreaming] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<Status>('connecting');

  // Auto-pause at the end of the streaming window.
  useEffect(() => {
    if (!streaming) return;
    const timer = setTimeout(() => setStreaming(false), STREAM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [streaming, nonce]);

  const origin = useMemo(() => originOf(cam.streamUrl), [cam.streamUrl]);
  const html = useMemo(() => streamHtml(cam), [cam]);

  const resume = () => {
    setStatus('connecting');
    setNonce((n) => n + 1);
    setStreaming(true);
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'load') setStatus('live');
    else if (msg === 'error') setStatus('error');
  };

  return (
    <View style={[styles.container, style]}>
      {streaming ? (
        <>
          <WebView
            key={nonce}
            originWhitelist={['*']}
            source={{ html, baseUrl: origin }}
            style={styles.webview}
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
            <Pressable style={styles.overlayCenter} onPress={resume}>
              <Text style={styles.title}>Stream unavailable</Text>
              <Text style={styles.muted}>Tap to retry</Text>
            </Pressable>
          )}
        </>
      ) : (
        <Pressable style={styles.overlayCenter} onPress={resume}>
          <Text style={styles.title}>Stream paused</Text>
          <Text style={styles.muted}>Tap to resume</Text>
        </Pressable>
      )}

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
    </View>
  );
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Minimal HTML rendering the MJPEG stream centered, with the camera transform
 * applied. `<img>` load/error are reported back to RN via postMessage so the
 * component can show connecting/error states (and surface logs).
 */
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
  webview: { flex: 1, backgroundColor: '#000' },
  overlayCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
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
