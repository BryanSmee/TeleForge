import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { usePrintersStore } from '../src/store/printers';
import { Button, Card, colors } from '../src/components/ui';

export default function PrinterListScreen() {
  const router = useRouter();
  const printers = usePrintersStore((s) => s.printers);
  const hydrated = usePrintersStore((s) => s.hydrated);

  return (
    <View style={styles.container}>
      {hydrated && printers.length === 0 ? (
        <Card style={styles.empty}>
          <Text style={styles.emptyTitle}>No printers yet</Text>
          <Text style={styles.emptyBody}>
            Add a printer using its OctoEverywhere Shared Connection URL.
          </Text>
        </Card>
      ) : (
        <FlatList
          data={printers}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/printer/${item.id}`} asChild>
              <Pressable>
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
        />
      )}

      <View style={styles.footer}>
        <Button label="Add printer" variant="primary" onPress={() => router.push('/add-printer')} />
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
  footer: { position: 'absolute', left: 16, right: 16, bottom: 24 },
});
