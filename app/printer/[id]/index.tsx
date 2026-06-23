import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { usePrinterStatus } from '../../../src/hooks/usePrinterStatus';
import { useMoonrakerTools } from '../../../src/hooks/useMoonrakerTools';
import { OctoEverywhereClient } from '../../../src/core/octoeverywhere';
import { MoonrakerClient } from '../../../src/core/moonraker';
import type { Filament, PrinterState, WebcamSource } from '../../../src/core/model/printer';
import { Button, Card, ProgressBar, colors } from '../../../src/components/ui';
import { WebcamView } from '../../../src/components/WebcamView';
import { SetTempModal, type SetTempTarget } from '../../../src/components/SetTempModal';
import { formatClock, formatDuration } from '../../../src/lib/format';

type TempEdit =
  | { kind: 'bed'; current: number }
  | { kind: 'nozzle'; index: number; label: string; current: number };

export default function PrinterDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const [fullscreen, setFullscreen] = useState(false);
  const [camIndex, setCamIndex] = useState(0);
  const [tempEdit, setTempEdit] = useState<TempEdit | null>(null);
  // Switches are controlled by polled state, which only refreshes every few
  // seconds — so a tap wouldn't visibly flip until the next poll. Track the
  // intended value locally to flip instantly, then let polling reconcile.
  const [optimisticLights, setOptimisticLights] = useState<Record<string, boolean>>({});

  const { state, error, refresh } = usePrinterStatus(printer?.baseUrl);
  const client = useMemo(
    () => (printer ? new OctoEverywhereClient({ baseUrl: printer.baseUrl }) : undefined),
    [printer],
  );

  // The U1 has 4 nozzles; OE status only carries one. Pull the full set from
  // Moonraker — OE reports a useless platform version ("1.0.0") for Moonraker,
  // so enable for any non-CC2 printer (the query no-ops if it isn't Moonraker).
  const isKlipper = !!state && state.model !== 'cc2';
  const tools = useMoonrakerTools(printer?.baseUrl, isKlipper);
  // Klipper temp-setting goes straight to Moonraker (OE's set-temp ignores the
  // tool number, so it can't target a specific nozzle).
  const moonraker = useMemo(
    () => (printer && isKlipper ? new MoonrakerClient({ baseUrl: printer.baseUrl }) : undefined),
    [printer, isKlipper],
  );

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

  const toggleLight = async (name: string, on: boolean) => {
    setOptimisticLights((m) => ({ ...m, [name]: on })); // flip the switch now
    try {
      await client!.setLight(name, on);
      refresh();
    } catch (e) {
      setOptimisticLights((m) => {
        const next = { ...m };
        delete next[name];
        return next;
      });
      Alert.alert('Action failed', e instanceof Error ? e.message : 'Unknown error');
      return;
    }
    // Drop the override once polling has had time to catch up, so an external
    // change to the light isn't masked by a stale optimistic value.
    setTimeout(() => {
      setOptimisticLights((m) => {
        const next = { ...m };
        delete next[name];
        return next;
      });
    }, 4000);
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

  const applyTemp = (value: number) => {
    if (!tempEdit) return;
    const fn =
      tempEdit.kind === 'bed'
        ? () => (moonraker ? moonraker.setBedTemp(value) : client!.setTemp({ bedC: value }))
        : () =>
            moonraker
              ? moonraker.setExtruderTemp(tempEdit.index, value)
              : client!.setTemp({ toolC: value });
    setTempEdit(null);
    runAction(fn);
  };

  const tempTarget: SetTempTarget | null = !tempEdit
    ? null
    : tempEdit.kind === 'bed'
      ? { label: 'Bed', current: tempEdit.current, presets: [50, 60, 70, 80, 100], max: isKlipper ? 120 : 75 }
      : {
          label: tempEdit.label,
          current: tempEdit.current,
          presets: [190, 200, 210, 220, 240, 250],
          max: isKlipper ? 300 : 260,
        };

  const cam = webcams[camIndex] ?? webcams[0];
  const extruders = tools?.extruders ?? state?.extruders ?? [];
  const chamber = tools?.chamber ?? state?.chamber;
  const canSetTemp = state?.capabilities.canSetTemp ?? false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: printer.name,
          headerRight: () => (
            <Pressable onPress={() => router.push(`/printer/${printer.id}/settings`)} hitSlop={8}>
              <Text style={styles.headerButton}>⚙</Text>
            </Pressable>
          ),
        }}
      />

      <ConnectionBanner state={state} error={error} />

      {cam && !fullscreen && (
        <View style={{ gap: 8 }}>
          <WebcamView
            key={camIndex}
            cam={cam}
            style={styles.webcamPreview}
            onFullscreen={() => setFullscreen(true)}
          />
          {webcams.length > 1 && (
            <CameraSelector webcams={webcams} selected={camIndex} onSelect={setCamIndex} />
          )}
        </View>
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
              key={camIndex}
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
          {state.aiFailureScore !== undefined && (
            <Text style={[styles.muted, { color: aiColor(state.aiFailureScore) }]}>
              AI failure check: {Math.round(state.aiFailureScore * 100)}%
            </Text>
          )}
        </Card>
      )}

      {state && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Temperatures</Text>
          {extruders.map((e) => {
            const label = extruders.length > 1 ? e.label : 'Nozzle';
            return (
              <TempRow
                key={`e${e.index}`}
                label={label}
                actual={e.actual}
                target={e.target}
                active={extruders.length > 1 ? e.active : undefined}
                filament={e.filament}
                onEdit={
                  canSetTemp && e.settable
                    ? () => setTempEdit({ kind: 'nozzle', index: e.index, label, current: e.target })
                    : undefined
                }
              />
            );
          })}
          {state.bed && (
            <TempRow
              label="Bed"
              actual={state.bed.actual}
              target={state.bed.target}
              onEdit={
                canSetTemp && state.bed.settable
                  ? () => setTempEdit({ kind: 'bed', current: state.bed!.target })
                  : undefined
              }
            />
          )}
          {chamber && <TempRow label="Chamber" actual={chamber.actual} target={chamber.target} />}
        </Card>
      )}

      {state && client && state.capabilities.canSetLight && state.lights.length > 0 && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>Lights</Text>
          {state.lights.map((l) => (
            <View key={l.name} style={styles.tempRow}>
              <Text style={styles.tempLabel}>{prettyLightName(l.name)}</Text>
              <Switch
                value={optimisticLights[l.name] ?? l.on}
                onValueChange={(on) => toggleLight(l.name, on)}
              />
            </View>
          ))}
        </Card>
      )}

      <SetTempModal target={tempTarget} onSet={applyTemp} onClose={() => setTempEdit(null)} />

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

function CameraSelector({
  webcams,
  selected,
  onSelect,
}: {
  webcams: WebcamSource[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <View style={styles.camSelector}>
      {webcams.map((w, i) => (
        <Pressable
          key={`${w.name}-${i}`}
          onPress={() => onSelect(i)}
          style={[styles.camChip, i === selected && styles.camChipActive]}
        >
          <Text style={[styles.camChipText, i === selected && styles.camChipTextActive]} numberOfLines={1}>
            {w.name || `Cam ${i + 1}`}
          </Text>
        </Pressable>
      ))}
    </View>
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
  filament,
  onEdit,
}: {
  label: string;
  actual: number;
  target: number;
  active?: boolean;
  filament?: Filament;
  onEdit?: () => void;
}) {
  const value = (
    <Text style={styles.tempValue}>
      {Math.round(actual)}°
      {target > 0 ? <Text style={styles.muted}> → {Math.round(target)}°</Text> : null}
    </Text>
  );
  return (
    <View style={styles.tempRow}>
      <View style={styles.tempLabelRow}>
        {active !== undefined && (
          <View style={[styles.activeDot, { backgroundColor: active ? colors.ok : colors.border }]} />
        )}
        <Text style={styles.tempLabel}>{label}</Text>
        {filament && (
          <View style={styles.filamentTag}>
            {filament.colorHex && (
              <View style={[styles.swatch, { backgroundColor: filament.colorHex }]} />
            )}
            {filament.material ? <Text style={styles.muted}>{filament.material}</Text> : null}
          </View>
        )}
      </View>
      {onEdit ? (
        <Pressable style={styles.tempEdit} onPress={onEdit} hitSlop={8}>
          {value}
          <Text style={styles.tempEditIcon}>✎</Text>
        </Pressable>
      ) : (
        value
      )}
    </View>
  );
}

function aiColor(score: number): string {
  if (score >= 0.6) return colors.danger;
  if (score >= 0.3) return colors.accent;
  return colors.ok;
}

function prettyLightName(name: string): string {
  const cleaned = name.replace(/_/g, ' ').replace(/\bled\b/i, '').trim() || name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
  tempEdit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tempEditIcon: { color: colors.accent, fontSize: 14 },
  filamentTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  tempValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 12 },
  webcamPreview: { height: 220, borderRadius: 12 },
  camSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  camChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  camChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  camChipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  camChipTextActive: { color: colors.text },
  headerButton: { color: colors.text, fontSize: 20, paddingHorizontal: 4 },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenView: { flex: 1 },
});
