import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { WebView } from 'react-native-webview';
import { usePrintersStore } from '../../../src/store/printers';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { colors } from '../../../src/components/ui';

/**
 * Opens the printer's own web interface (Mainsail/Fluidd for Klipper, the Elegoo
 * UI for the CC2) through the OctoEverywhere relay — i.e. the connection base URL.
 */
export default function PrinterWebUiScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const [loading, setLoading] = useState(true);

  if (!printer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t('common.printerGone')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${printer.name} — ${t('nav.webUi')}` }} />
      <WebView
        source={{ uri: printer.baseUrl }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onLoadEnd={() => setLoading(false)}
      />
      {loading && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 13 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
