import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePrintersStore } from '../src/store/printers';
import { OctoEverywhereClient } from '@teleforge/core';
import { useTranslation } from '../src/i18n/useTranslation';
import { Button, Card, colors } from '../src/components/ui';

type TestState = { kind: 'idle' | 'testing' } | { kind: 'ok'; name: string } | { kind: 'err'; message: string };

export default function AddPrinterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const addPrinter = usePrintersStore((s) => s.addPrinter);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const canSave = name.trim().length > 0 && /^https?:\/\//.test(url.trim());

  const runTest = async () => {
    setTest({ kind: 'testing' });
    try {
      const client = new OctoEverywhereClient({ baseUrl: url.trim() });
      const state = await client.getStatus();
      setTest({ kind: 'ok', name: state.platformVersion ?? state.model });
    } catch (e) {
      setTest({ kind: 'err', message: e instanceof Error ? e.message : t('add.connectionFailed') });
    }
  };

  const save = async () => {
    await addPrinter({ name, baseUrl: url });
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={{ gap: 16 }}>
        <View>
          <Text style={styles.label}>{t('add.name')}</Text>
          <TextInput
            style={styles.input}
            placeholder="Centauri Carbon 2"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
          />
        </View>

        <View>
          <Text style={styles.label}>{t('add.url')}</Text>
          <TextInput
            style={styles.input}
            placeholder="https://shared-xxxx.octoeverywhere.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={(next) => {
              setUrl(next);
              setTest({ kind: 'idle' });
            }}
          />
          <Text style={styles.hint}>{t('add.urlHint')}</Text>
        </View>

        {test.kind === 'ok' && <Text style={styles.ok}>✓ {t('add.connectedTo', { name: test.name })}</Text>}
        {test.kind === 'err' && <Text style={styles.err}>✗ {test.message}</Text>}

        <Button
          label={test.kind === 'testing' ? t('add.testing') : t('add.testConnection')}
          onPress={runTest}
          disabled={!/^https?:\/\//.test(url.trim()) || test.kind === 'testing'}
        />
      </Card>

      <Button label={t('add.save')} variant="primary" onPress={save} disabled={!canSave} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
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
  ok: { color: colors.ok, fontSize: 14 },
  err: { color: colors.danger, fontSize: 14 },
});
