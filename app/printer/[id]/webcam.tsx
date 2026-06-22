import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { usePrintersStore } from '../../../src/store/printers';
import { OctoEverywhereClient } from '../../../src/core/octoeverywhere';
import type { WebcamSource } from '../../../src/core/model/printer';
import { Button, colors } from '../../../src/components/ui';

// OctoEverywhere caps a relayed webcam stream (~2 min) then back-to-back limits
// it (607/609). We stream for a window under the cap, then pause and prompt the
// user to resume — rather than auto-reconnecting in a loop. See docs/spike-findings.md.
const STREAM_WINDOW_MS = 110_000;

export default function WebcamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));

  const [cams, setCams] = useState<WebcamSource[]>();
  const [error, setError] = useState<string>();
  const [index, setIndex] = useState(0);
  const [streaming, setStreaming] = useState(true);
  const [nonce, setNonce] = useState(0); // forces a fresh stream connection on resume

  useEffect(() => {
    if (!printer) return;
    let cancelled = false;
    const client = new OctoEverywhereClient({ baseUrl: printer.baseUrl });
    client
      .listWebcams()
      .then((list) => !cancelled && setCams(list))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load webcams'));
    return () => {
      cancelled = true;
    };
  }, [printer]);

  // Auto-pause at the end of the streaming window.
  useEffect(() => {
    if (!streaming) return;
    const timer = setTimeout(() => setStreaming(false), STREAM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [streaming, nonce]);

  const cam = cams?.[index];
  const html = useMemo(() => (cam ? streamHtml(cam, nonce) : ''), [cam, nonce]);

  const resume = () => {
    setNonce((n) => n + 1);
    setStreaming(true);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: cam?.name ?? 'Webcam' }} />

      <View style={styles.stage}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !cams ? (
          <ActivityIndicator color={colors.accent} />
        ) : !cam ? (
          <Text style={styles.muted}>No webcam available.</Text>
        ) : streaming ? (
          <WebView
            key={nonce}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.webview}
            allowsInlineMediaPlayback
            scrollEnabled={false}
          />
        ) : (
          <Pressable style={styles.pausedOverlay} onPress={resume}>
            <Text style={styles.pausedTitle}>Stream paused</Text>
            <Text style={styles.muted}>Tap to resume watching</Text>
          </Pressable>
        )}
      </View>

      {cams && cams.length > 1 && (
        <View style={styles.selector}>
          {cams.map((c, i) => (
            <Button
              key={c.name + i}
              label={c.name}
              variant={i === index ? 'primary' : 'default'}
              onPress={() => {
                setIndex(i);
                resume();
              }}
            />
          ))}
        </View>
      )}

      {cam && !streaming && (
        <View style={styles.footer}>
          <Button label="Resume stream" variant="primary" onPress={resume} />
        </View>
      )}
    </View>
  );
}

/** Minimal HTML that renders an MJPEG stream centered, with the camera transform applied. */
function streamHtml(cam: WebcamSource, nonce: number): string {
  const transform = `rotate(${cam.rotation}deg) scaleX(${cam.flipH ? -1 : 1}) scaleY(${cam.flipV ? -1 : 1})`;
  const sep = cam.streamUrl.includes('?') ? '&' : '?';
  const src = `${cam.streamUrl}${sep}_t=${nonce}`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden">
<img src="${src}" style="max-width:100%;max-height:100%;transform:${transform}"/>
</body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  stage: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: { flex: 1, width: '100%', backgroundColor: '#000' },
  pausedOverlay: { alignItems: 'center', gap: 6, padding: 24 },
  pausedTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14, padding: 24, textAlign: 'center' },
  selector: { flexDirection: 'row', gap: 8, padding: 12, flexWrap: 'wrap' },
  footer: { padding: 16 },
});
