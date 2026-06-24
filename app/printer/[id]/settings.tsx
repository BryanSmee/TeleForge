import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { useTranslation } from '../../../src/i18n/useTranslation';
import { Button, Card, colors } from '../../../src/components/ui';

export default function PrinterSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const updatePrinter = usePrintersStore((s) => s.updatePrinter);
  const removePrinter = usePrintersStore((s) => s.removePrinter);

  const [name, setName] = useState(printer?.name ?? '');
  const [url, setUrl] = useState(printer?.baseUrl ?? '');

  if (!printer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t('common.printerGone')}</Text>
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
    Alert.alert(t('list.removeTitle'), t('list.removeConfirm', { name: printer.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
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
      <Stack.Screen options={{ title: t('nav.settings') }} />

      <Card style={{ gap: 16 }}>
        <View>
          <Text style={styles.label}>{t('add.name')}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
        </View>
        <View>
          <Text style={styles.label}>{t('add.url')}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>{t('settings.urlHint')}</Text>
        </View>
        <Button label={t('common.save')} variant="primary" onPress={save} disabled={!dirty || !valid} />
      </Card>

      <Button label={t('settings.removePrinter')} variant="danger" onPress={confirmRemove} />
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
