import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { usePrintersStore } from '../src/store/printers';
import { useSettingsStore } from '../src/store/settings';
import { useTranslation } from '../src/i18n/useTranslation';
import { colors } from '../src/components/ui';

export default function RootLayout() {
  const hydrate = usePrintersStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const { t } = useTranslation();

  useEffect(() => {
    hydrate();
    hydrateSettings();
  }, [hydrate, hydrateSettings]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'TeleForge' }} />
        <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
        <Stack.Screen name="add-printer" options={{ title: t('nav.addPrinter'), presentation: 'modal' }} />
        <Stack.Screen name="printer/[id]/index" options={{ title: t('nav.printer') }} />
        <Stack.Screen name="printer/[id]/settings" options={{ title: t('nav.settings') }} />
        <Stack.Screen name="printer/[id]/files" options={{ title: t('nav.files') }} />
        <Stack.Screen name="printer/[id]/ui" options={{ title: t('nav.webUi') }} />
      </Stack>
    </>
  );
}
