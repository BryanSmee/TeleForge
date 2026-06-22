import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebcamSource } from '../core/model/printer';
import { Button, colors } from './ui';

// OctoEverywhere caps a relayed webcam stream (~2 min) then back-to-back limits
// it (607/609). Stream for a window under the cap, then pause and let the user
// resume — never auto-reconnect in a loop. See docs/spike-findings.md.
const STREAM_WINDOW_MS = 110_000;
// A streaming response never fires onLoadEnd, so drop the spinner after this.
const ASSUME_LIVE_MS = 2000;

type Status = 'connecting' | 'live' | 'error';

export function WebcamView({
  cam,
  active,
  style,
  onFullscreen,
  onClose,
}: {
  cam: WebcamSource;
  /** Whether the printer is printing/paused — the CC2 only streams then. */
  active: boolean;
  style?: ViewStyle;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  // When idle we don't auto-stream (it would just hang); the user can force it.
  const [forced, setForced] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<Status>('connecting');
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const shouldStream = (active || forced) && streaming;

  // Auto-pause at the end of the streaming window.
  useEffect(() => {
    if (!shouldStream) return;
    const timer = setTimeout(() => setStreaming(false), STREAM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [shouldStream, nonce]);

  // A multipart MJPEG response keeps loading forever, so assume it's live after
  // a short grace period unless an error fires first. (Status is reset to
  // 'connecting' by restart() and the initial state, not synchronously here.)
  useEffect(() => {
    if (!shouldStream) return;
    liveTimer.current = setTimeout(() => setStatus('live'), ASSUME_LIVE_MS);
    return () => clearTimeout(liveTimer.current);
  }, [shouldStream, nonce]);

  const restart = () => {
    setForced(true);
    setStreaming(true);
    setStatus('connecting');
    setNonce((n) => n + 1);
  };

  const fail = () => {
    clearTimeout(liveTimer.current);
    setStatus('error');
  };

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

  // Idle and not forced: explain why, offer to try anyway.
  if (!active && !forced) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.overlayCenter}>
          <Text style={styles.title}>Webcam idle</Text>
          <Text style={styles.muted}>The printer streams its camera while printing.</Text>
          <View style={{ marginTop: 12 }}>
            <Button label="Try anyway" onPress={restart} />
          </View>
        </View>
        {controls}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {shouldStream ? (
        <WebView
          key={nonce}
          originWhitelist={['*']}
          source={{ uri: cam.streamUrl }}
          style={styles.webview}
          allowsInlineMediaPlayback
          scrollEnabled={false}
          onError={fail}
          onHttpError={fail}
        />
      ) : (
        <Pressable style={styles.overlayCenter} onPress={restart}>
          <Text style={styles.title}>Stream paused</Text>
          <Text style={styles.muted}>Tap to resume</Text>
        </Pressable>
      )}

      {shouldStream && status === 'connecting' && (
        <View style={styles.overlayCenter} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {shouldStream && status === 'error' && (
        <Pressable style={styles.overlayCenter} onPress={restart}>
          <Text style={styles.title}>Stream unavailable</Text>
          <Text style={styles.muted}>
            {active ? 'Tap to retry' : 'The camera may only stream while printing — tap to retry'}
          </Text>
        </Pressable>
      )}

      {controls}
    </View>
  );
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
