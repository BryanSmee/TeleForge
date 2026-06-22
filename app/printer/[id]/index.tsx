import { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { usePrinterStatus } from '../../../src/hooks/usePrinterStatus';
import { OctoEverywhereClient } from '../../../src/core/octoeverywhere';
import type { PrinterState, TempChannel } from '../../../src/core/model/printer';
import { Button, Card, ProgressBar, colors } from '../../../src/components/ui';
import { WebcamView } from '../../../src/components/WebcamView';
import { formatClock, formatDuration } from '../../../src/lib/format';

export default function PrinterDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const [fullscreen, setFullscreen] = useState(false);

  const { state, error, refresh } = usePrinterStatus(printer?.baseUrl);
  const client = useMemo(
    () => (printer ? new OctoEverywhereClient({ baseUrl: printer.baseUrl }) : undefined),
    [printer],
  );

  if (!printer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This printer no longer exists.</Text>
      </View>
    );
  }

  const runAction = async (fn: () => Promise<void>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      Alert.alert('Action failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const confirmAction = (title: string, confirmLabel: string, destructive: boolean, fn: () => Promise<void>) => {
    Alert.alert(title, undefined, [
      { text: 'Back', style: 'cancel' },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => runAction(fn),
      },
    ]);
  };

  const cam = state?.webcams[0];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: printer.name }} />

      <ConnectionBanner state={state} error={error} />

      {cam && !fullscreen && (
        <WebcamView
          cam={cam}
          style={styles.webcamPreview}
          onFullscreen={() => setFullscreen(true)}
        />
      )}

      <Modal
        visible={fullscreen}
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setFullscreen(false)}
      >
        <View style={styles.fullscreen}>
          {cam && (
            <WebcamView
              cam={cam}
              fullscreen
              style={styles.fullscreenView}
              onClose={() => setFullscreen(false)}
            />
          )}
        </View>
      </Modal>

      {state?.isActive && state.job && (
        <Card style={{ gap: 10 }}>
          <Text style={styles.fileName} numberOfLines={1}>
            {state.job.fileName || 'Printing'}
          </Text>
          <ProgressBar pct={state.job.progressPct} />
          <View style={styles.jobRow}>
            <Text style={styles.muted}>{state.job.progressPct}%</Text>
            {state.job.etaEpochMs !== undefined && (
              <Text style={styles.muted}>
                ETA {formatClock(state.job.etaEpochMs)} ·{' '}
                {formatDuration(state.job.remainingSec ?? 0)} left
              </Text>
            )}
          </View>
          {state.job.totalLayers ? (
            <Text style={styles.muted}>
              Layer {state.job.currentLayer ?? 0} / {state.job.totalLayers}
            </Text>
          ) : null}
        </Card>
      )}

      {state && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Temperatures</Text>
          {state.temps.map((t) => (
            <TempRow key={t.id} temp={t} />
          ))}
        </Card>
      )}

      {state && client && (
        <View style={styles.controls}>
          {state.capabilities.canPause && (
            <Button
              label="Pause"
              onPress={() => confirmAction('Pause print?', 'Pause', false, () => client.pause())}
            />
          )}
          {state.capabilities.canResume && (
            <Button label="Resume" variant="primary" onPress={() => runAction(() => client.resume())} />
          )}
          {state.capabilities.canCancel && (
            <Button
              label="Cancel"
              variant="danger"
              onPress={() =>
                confirmAction('Cancel print?', 'Cancel print', true, () => client.cancel())
              }
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

function ConnectionBanner({ state, error }: { state?: PrinterState; error?: Error }) {
  if (error) {
    return (
      <Card style={{ borderColor: colors.danger }}>
        <Text style={{ color: colors.danger }}>{error.message}</Text>
      </Card>
    );
  }
  if (!state) {
    return (
      <Card>
        <Text style={styles.muted}>Connecting…</Text>
      </Card>
    );
  }
  return (
    <Card style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: dotColor(state) }]} />
      <Text style={styles.statusText}>{state.connection}</Text>
      {state.platformVersion ? <Text style={styles.muted}>{state.platformVersion}</Text> : null}
    </Card>
  );
}

function TempRow({ temp }: { temp: TempChannel }) {
  return (
    <View style={styles.tempRow}>
      <Text style={styles.tempLabel}>{temp.label}</Text>
      <Text style={styles.tempValue}>
        {Math.round(temp.actual)}°
        {temp.target > 0 ? <Text style={styles.muted}> → {Math.round(temp.target)}°</Text> : null}
      </Text>
    </View>
  );
}

function dotColor(state: PrinterState): string {
  switch (state.connection) {
    case 'printing':
      return colors.ok;
    case 'paused':
      return colors.accent;
    case 'error':
      return colors.danger;
    default:
      return colors.muted;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 13 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  fileName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  jobRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.text, fontSize: 16, fontWeight: '600', textTransform: 'capitalize', flex: 1 },
  tempRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tempLabel: { color: colors.text, fontSize: 15 },
  tempValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 12 },
  webcamPreview: { height: 220, borderRadius: 12 },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenView: { flex: 1 },
});
