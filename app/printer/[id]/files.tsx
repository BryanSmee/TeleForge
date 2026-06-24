import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { MoonrakerClient, type GcodeFile } from '../../../src/core/moonraker';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { colors } from '../../../src/components/ui';
import { formatBytes, formatRelative } from '../../../src/lib/format';

/**
 * Browse the printer's g-code files (Moonraker `gcodes` root) and start/restart
 * a print. Klipper/Moonraker only — the dashboard hides the entry for the CC2,
 * whose file ops aren't exposed over the OE command API.
 */
export default function FilesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));

  const client = useMemo(
    () => (printer ? new MoonrakerClient({ baseUrl: printer.baseUrl }) : undefined),
    [printer],
  );

  const [files, setFiles] = useState<GcodeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const [starting, setStarting] = useState<string>();

  // `loading` starts true and is re-armed by the refresh/retry handlers, so the
  // effect never sets it synchronously (which the react-hooks lint rule flags).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .listFiles()
      .then((f) => {
        if (cancelled) return;
        setFiles(f);
        setError(undefined);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load files');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, nonce]);

  if (!printer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t('common.printerGone')}</Text>
      </View>
    );
  }

  const confirmStart = (file: GcodeFile) => {
    Alert.alert(t('files.startTitle'), basename(file.path), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('files.start'),
        onPress: async () => {
          try {
            setStarting(file.path);
            await client!.startPrint(file.path);
            router.back(); // back to the dashboard to watch progress
          } catch (e) {
            Alert.alert(t('files.couldNotStart'), e instanceof Error ? e.message : t('common.unknownError'));
          } finally {
            setStarting(undefined);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${printer.name} — ${t('nav.files')}` }} />

      {loading && files.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              setNonce((n) => n + 1);
            }}
            hitSlop={8}
          >
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : files.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>{t('files.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(f) => f.path}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => {
            setLoading(true);
            setNonce((n) => n + 1);
          }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => confirmStart(item)}
              disabled={!!starting}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {basename(item.path)}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {formatBytes(item.sizeBytes)}
                  {item.modifiedEpochSec ? ` · ${formatRelative(item.modifiedEpochSec)}` : ''}
                </Text>
              </View>
              {starting === item.path ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.play}>▶</Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { color: colors.muted, fontSize: 13 },
  retry: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  play: { color: colors.accent, fontSize: 18, fontWeight: '700' },
});
