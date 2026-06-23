import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { usePrintersStore } from '../src/store/printers';
import { colors } from '../src/components/ui';

export default function RootLayout() {
  const hydrate = usePrintersStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

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
        <Stack.Screen name="add-printer" options={{ title: 'Add printer', presentation: 'modal' }} />
        <Stack.Screen name="printer/[id]/index" options={{ title: 'Printer' }} />
        <Stack.Screen name="printer/[id]/settings" options={{ title: 'Settings' }} />
      </Stack>
    </>
  );
}
