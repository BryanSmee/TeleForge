import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { Button, Card, colors } from '../../../src/components/ui';

export default function PrinterSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const updatePrinter = usePrintersStore((s) => s.updatePrinter);
  const removePrinter = usePrintersStore((s) => s.removePrinter);

  const [name, setName] = useState(printer?.name ?? '');
  const [url, setUrl] = useState(printer?.baseUrl ?? '');

  if (!printer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This printer no longer exists.</Text>
      </View>
    );
  }

  const dirty = name.trim() !== printer.name || url.trim().replace(/\/+$/, '') !== printer.baseUrl;
  const valid = name.trim().length > 0 && /^https?:\/\//.test(url.trim());

  const save = async () => {
    await updatePrinter(printer.id, { name, baseUrl: url });
    router.back();
  };

  const confirmRemove = () => {
    Alert.alert('Remove printer', `Remove "${printer.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removePrinter(printer.id);
          router.replace('/');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <Card style={{ gap: 16 }}>
        <View>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
        </View>
        <View>
          <Text style={styles.label}>Shared Connection URL</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>The URL is a secret — stored in the device secure store.</Text>
        </View>
        <Button label="Save" variant="primary" onPress={save} disabled={!dirty || !valid} />
      </Card>

      <Button label="Remove printer" variant="danger" onPress={confirmRemove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 13 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
    fontSize: 15,
  },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
