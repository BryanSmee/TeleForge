import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSettingsStore } from '../src/store/settings';
import { useTranslation } from '../src/i18n/useTranslation';
import type { LocalePref } from '../src/i18n';
import { Card, colors } from '../src/components/ui';

// Endonyms aren't translated (a French speaker looks for "Français", not "French").
const LANGUAGE_OPTIONS: { value: LocalePref; label: string; system?: boolean }[] = [
  { value: 'system', label: '', system: true },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

export default function AppSettingsScreen() {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={{ gap: 4 }}>
        <Text style={styles.section}>{t('appSettings.language')}</Text>
        {LANGUAGE_OPTIONS.map((opt) => {
          const selected = locale === opt.value;
          return (
            <Pressable key={opt.value} style={styles.row} onPress={() => setLocale(opt.value)}>
              <Text style={styles.label}>{opt.system ? t('appSettings.languageSystem') : opt.label}</Text>
              {selected && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16 },
  section: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  label: { color: colors.text, fontSize: 16 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
});
