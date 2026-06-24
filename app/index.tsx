import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { usePrintersStore, type PrinterConfig } from '../src/store/printers';
import { useTranslation } from '../src/i18n/useTranslation';
import { Button, Card, colors } from '../src/components/ui';

export default function PrinterListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const printers = usePrintersStore((s) => s.printers);
  const hydrated = usePrintersStore((s) => s.hydrated);
  const removePrinter = usePrintersStore((s) => s.removePrinter);

  const confirmRemove = (printer: PrinterConfig) => {
    Alert.alert(t('list.removeTitle'), t('list.removeConfirm', { name: printer.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => removePrinter(printer.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
              <Text style={styles.headerButton}>⚙</Text>
            </Pressable>
          ),
        }}
      />
      {hydrated && printers.length === 0 ? (
        <Card style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('list.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('list.emptyBody')}</Text>
        </Card>
      ) : (
        <FlatList
          data={printers}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/printer/${item.id}`} asChild>
              <Pressable onLongPress={() => confirmRemove(item)} delayLongPress={400}>
                <Card style={styles.row}>
                  <View style={styles.dot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.host} numberOfLines={1}>
                      {hostOf(item.baseUrl)}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Card>
              </Pressable>
            </Link>
          )}
          ListFooterComponent={<Text style={styles.hint}>{t('list.removeHint')}</Text>}
        />
      )}

      <View style={styles.footer}>
        <Button label={t('list.addPrinter')} variant="primary" onPress={() => router.push('/add-printer')} />
      </View>
    </View>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.muted },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  host: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 24 },
  empty: { alignItems: 'center', gap: 8, marginTop: 24 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: colors.muted, textAlign: 'center' },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingTop: 8 },
  headerButton: { color: colors.text, fontSize: 18 },
  footer: { position: 'absolute', left: 16, right: 16, bottom: 24 },
});
