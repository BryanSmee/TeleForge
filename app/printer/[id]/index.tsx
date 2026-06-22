import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { usePrinterStatus } from '../../../src/hooks/usePrinterStatus';
import { useMoonrakerTools } from '../../../src/hooks/useMoonrakerTools';
import { OctoEverywhereClient } from '../../../src/core/octoeverywhere';
import type { PrinterState, WebcamSource } from '../../../src/core/model/printer';
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

  // The U1 has 4 nozzles; OE status only carries one. Pull the full set from
  // Moonraker for Klipper printers and prefer it; otherwise use the OE hotend.
  const tools = useMoonrakerTools(printer?.baseUrl, state?.model === 'klipper');

  // Webcams must come from list-webcam (status omits the stream/snapshot URLs).
  const [webcams, setWebcams] = useState<WebcamSource[]>([]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .listWebcams()
      .then((w) => !cancelled && setWebcams(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

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

  const cam = webcams[0];
  const extruders = tools?.extruders ?? state?.extruders ?? [];
  const chamber = tools?.chamber ?? state?.chamber;

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
          {extruders.map((e) => (
            <TempRow
              key={`e${e.index}`}
              label={extruders.length > 1 ? e.label : 'Nozzle'}
              actual={e.actual}
              target={e.target}
              active={extruders.length > 1 ? e.active : undefined}
            />
          ))}
          {state.bed && <TempRow label="Bed" actual={state.bed.actual} target={state.bed.target} />}
          {chamber && <TempRow label="Chamber" actual={chamber.actual} target={chamber.target} />}
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

function TempRow({
  label,
  actual,
  target,
  active,
}: {
  label: string;
  actual: number;
  target: number;
  active?: boolean;
}) {
  return (
    <View style={styles.tempRow}>
      <View style={styles.tempLabelRow}>
        {active !== undefined && (
          <View style={[styles.activeDot, { backgroundColor: active ? colors.ok : colors.border }]} />
        )}
        <Text style={styles.tempLabel}>{label}</Text>
      </View>
      <Text style={styles.tempValue}>
        {Math.round(actual)}°
        {target > 0 ? <Text style={styles.muted}> → {Math.round(target)}°</Text> : null}
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
  tempLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  tempLabel: { color: colors.text, fontSize: 15 },
  tempValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 12 },
  webcamPreview: { height: 220, borderRadius: 12 },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenView: { flex: 1 },
});
