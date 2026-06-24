import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrintersStore } from '../../../src/store/printers';
import { usePrinterStatus } from '../../../src/hooks/usePrinterStatus';
import { useMoonrakerTools } from '../../../src/hooks/useMoonrakerTools';
import { useFilamentSystem } from '../../../src/hooks/useFilamentSystem';
import { OctoEverywhereClient, MoonrakerClient } from '@teleforge/core';
import type {
  Fan,
  Filament,
  FilamentSystem,
  FilamentTray,
  PrinterState,
  WebcamSource,
} from '@teleforge/core';
import { Button, Card, ProgressBar, colors } from '../../../src/components/ui';
import { WebcamView } from '../../../src/components/WebcamView';
import { SetTempModal, type SetTempTarget } from '../../../src/components/SetTempModal';
import { useTranslation, type Translator } from '../../../src/i18n/useTranslation';
import { formatClock, formatDuration } from '../../../src/lib/format';

type TempEdit =
  | { kind: 'bed'; current: number }
  | { kind: 'nozzle'; index: number; label: string; current: number };

export default function PrinterDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const printer = usePrintersStore((s) => s.printers.find((p) => p.id === id));
  const [fullscreen, setFullscreen] = useState(false);
  const [camIndex, setCamIndex] = useState(0);
  const [tempEdit, setTempEdit] = useState<TempEdit | null>(null);
  // Switches/sliders are controlled by polled state, which only refreshes every
  // few seconds — so a tap wouldn't visibly change until the next poll. Track
  // the intended value locally to update instantly, then let polling reconcile.
  const [optimisticLights, setOptimisticLights] = useState<Record<string, boolean>>({});
  const [optimisticFans, setOptimisticFans] = useState<Record<string, number>>({});
  const [optimisticTemps, setOptimisticTemps] = useState<Record<string, number>>({});

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
  // The CC2's combo unit (4 trays → 1 extruder) isn't in OE's normalized status;
  // pull it from the raw MQTT passthrough (CC2 only).
  const cfs = useFilamentSystem(printer?.baseUrl, state?.model === 'cc2');
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
        <Text style={styles.muted}>{t('common.printerGone')}</Text>
      </View>
    );
  }

  const runAction = async (fn: () => Promise<void>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      Alert.alert(t('common.actionFailed'), e instanceof Error ? e.message : t('common.unknownError'));
    }
  };

  // Apply a control change with instant feedback: stash the intended value so
  // the UI updates now, fire the request, then drop the override once polling
  // has caught up (or revert it immediately on failure).
  const runOptimistic = <V,>(
    setMap: Dispatch<SetStateAction<Record<string, V>>>,
    key: string,
    value: V,
    fn: () => Promise<void>,
  ) => {
    const clear = () =>
      setMap((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    setMap((m) => ({ ...m, [key]: value }));
    (async () => {
      try {
        await fn();
        refresh();
      } catch (e) {
        clear();
        Alert.alert(t('common.actionFailed'), e instanceof Error ? e.message : t('common.unknownError'));
        return;
      }
      setTimeout(clear, 4000);
    })();
  };

  const toggleLight = (name: string, on: boolean) =>
    runOptimistic(setOptimisticLights, name, on, () => client!.setLight(name, on));

  const confirmAction = (title: string, confirmLabel: string, destructive: boolean, fn: () => Promise<void>) => {
    Alert.alert(title, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => runAction(fn),
      },
    ]);
  };

  const applyTemp = (value: number) => {
    if (!tempEdit) return;
    const key = tempEdit.kind === 'bed' ? 'bed' : `n${tempEdit.index}`;
    const fn =
      tempEdit.kind === 'bed'
        ? () => (moonraker ? moonraker.setBedTemp(value) : client!.setTemp({ bedC: value }))
        : () =>
            moonraker
              ? moonraker.setExtruderTemp(tempEdit.index, value)
              : client!.setTemp({ toolC: value });
    setTempEdit(null);
    runOptimistic(setOptimisticTemps, key, value, fn);
  };

  const tempTarget: SetTempTarget | null = !tempEdit
    ? null
    : tempEdit.kind === 'bed'
      ? { label: t('dashboard.bed'), current: tempEdit.current, presets: [50, 60, 70, 80, 100], max: isKlipper ? 120 : 75 }
      : {
          label: tempEdit.label,
          current: tempEdit.current,
          presets: [190, 200, 210, 220, 240, 250],
          max: isKlipper ? 300 : 260,
        };

  const cam = webcams[camIndex] ?? webcams[0];
  const chamber = tools?.chamber ?? state?.chamber;
  const fans = (tools?.fans ?? []).map((f) =>
    optimisticFans[f.key] !== undefined ? { ...f, speedPct: optimisticFans[f.key] } : f,
  );
  const canSetTemp = state?.capabilities.canSetTemp ?? false;

  // On the CC2 the loaded tray feeds the single extruder, so surface its
  // filament on that nozzle's temp row. Apply any pending optimistic target.
  const activeTray = cfs?.units.flatMap((u) => u.trays).find((t) => t.active);
  const baseExtruders = tools?.extruders ?? state?.extruders ?? [];
  const extruders = baseExtruders.map((e) => {
    const o = optimisticTemps[`n${e.index}`];
    const filament = activeTray && baseExtruders.length === 1 ? activeTray.filament : e.filament;
    return { ...e, filament, target: o ?? e.target };
  });
  const bed =
    state?.bed && optimisticTemps.bed !== undefined
      ? { ...state.bed, target: optimisticTemps.bed }
      : state?.bed;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: printer.name,
          headerRight: () => (
            <View style={styles.headerButtons}>
              {isKlipper && (
                <Pressable onPress={() => router.push(`/printer/${printer.id}/files`)} hitSlop={8}>
                  <Text style={styles.headerButton}>📁</Text>
                </Pressable>
              )}
              <Pressable onPress={() => router.push(`/printer/${printer.id}/ui`)} hitSlop={8}>
                <Text style={styles.headerButton}>🎛️</Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/printer/${printer.id}/settings`)} hitSlop={8}>
                <Text style={styles.headerButton}>⚙</Text>
              </Pressable>
            </View>
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
            {state.job.fileName || t('dashboard.printingFile')}
          </Text>
          <ProgressBar pct={state.job.progressPct} />
          <View style={styles.jobRow}>
            <Text style={styles.muted}>{state.job.progressPct}%</Text>
            {state.job.etaEpochMs !== undefined && (
              <Text style={styles.muted}>
                {t('dashboard.eta', {
                  time: formatClock(state.job.etaEpochMs),
                  left: formatDuration(state.job.remainingSec ?? 0),
                })}
              </Text>
            )}
          </View>
          {state.job.totalLayers ? (
            <Text style={styles.muted}>
              {t('dashboard.layer', {
                current: state.job.currentLayer ?? 0,
                total: state.job.totalLayers,
              })}
            </Text>
          ) : null}
          {state.aiFailureScore !== undefined && (
            <Text style={[styles.muted, { color: aiColor(state.aiFailureScore) }]}>
              {t('dashboard.aiCheck', { pct: Math.round(state.aiFailureScore * 100) })}
            </Text>
          )}
        </Card>
      )}

      {state && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>{t('dashboard.temperatures')}</Text>
          {extruders.map((e) => {
            const label =
              extruders.length > 1 ? t('dashboard.nozzleN', { n: e.index + 1 }) : t('dashboard.nozzle');
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
          {bed && (
            <TempRow
              label={t('dashboard.bed')}
              actual={bed.actual}
              target={bed.target}
              onEdit={
                canSetTemp && bed.settable
                  ? () => setTempEdit({ kind: 'bed', current: bed.target })
                  : undefined
              }
            />
          )}
          {chamber && <TempRow label={t('dashboard.chamber')} actual={chamber.actual} target={chamber.target} />}
        </Card>
      )}

      {cfs && <FilamentSystemCard cfs={cfs} t={t} />}

      {moonraker && fans.length > 0 && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>{t('dashboard.fans')}</Text>
          {fans.map((f) => (
            <FanRow
              key={f.key}
              fan={f}
              t={t}
              onSet={(pct) => runOptimistic(setOptimisticFans, f.key, pct, () => moonraker.setFanSpeed(f.key, pct))}
            />
          ))}
        </Card>
      )}

      {state && client && state.capabilities.canSetLight && state.lights.length > 0 && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.sectionTitle}>{t('dashboard.lights')}</Text>
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
              label={t('dashboard.pause')}
              onPress={() =>
                confirmAction(t('dashboard.pauseConfirm'), t('dashboard.pause'), false, () => client.pause())
              }
            />
          )}
          {state.capabilities.canResume && (
            <Button label={t('dashboard.resume')} variant="primary" onPress={() => runAction(() => client.resume())} />
          )}
          {state.capabilities.canCancel && (
            <Button
              label={t('dashboard.cancelPrint')}
              variant="danger"
              onPress={() =>
                confirmAction(t('dashboard.cancelConfirm'), t('dashboard.cancelPrint'), true, () => client.cancel())
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
  const { t } = useTranslation();
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
        <Text style={styles.muted}>{t('common.connecting')}</Text>
      </Card>
    );
  }
  return (
    <Card style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: dotColor(state) }]} />
      <Text style={styles.statusText}>{t(`status.${state.connection}`)}</Text>
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

const FAN_PRESETS = [0, 25, 50, 75, 100];

function FanRow({ fan, onSet, t }: { fan: Fan; onSet: (pct: number) => void; t: Translator['t'] }) {
  // The shown speed snaps to the nearest preset so the active chip lines up.
  const nearest = FAN_PRESETS.reduce((a, b) =>
    Math.abs(b - fan.speedPct) < Math.abs(a - fan.speedPct) ? b : a,
  );
  // The part-cooling fan has a translatable name; generic fans keep their id.
  const label = fan.key === 'fan' ? t('dashboard.partCooling') : fan.label;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tempRow}>
        <Text style={styles.tempLabel}>{label}</Text>
        <Text style={styles.tempValue}>{fan.speedPct}%</Text>
      </View>
      {fan.settable && (
        <View style={styles.fanPresets}>
          {FAN_PRESETS.map((p) => {
            const on = p === nearest;
            return (
              <Pressable
                key={p}
                onPress={() => onSet(p)}
                style={[styles.fanChip, on && styles.fanChipActive]}
              >
                <Text style={[styles.fanChipText, on && styles.fanChipTextActive]}>
                  {p === 0 ? t('common.off') : `${p}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function FilamentSystemCard({ cfs, t }: { cfs: FilamentSystem; t: Translator['t'] }) {
  const trays = cfs.units.flatMap((u) => u.trays);
  if (trays.length === 0) return null;
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.cfsHeader}>
        <Text style={styles.sectionTitle}>{t('dashboard.filament')}</Text>
        {cfs.autoRefill && <Text style={styles.muted}>{t('dashboard.autoRefill')}</Text>}
      </View>
      <View style={styles.cfsGrid}>
        {trays.map((tray) => (
          <FilamentSlot key={tray.trayId} tray={tray} t={t} />
        ))}
      </View>
    </Card>
  );
}

function FilamentSlot({ tray, t }: { tray: FilamentTray; t: Translator['t'] }) {
  const { filament, active, present } = tray;
  return (
    <View style={[styles.cfsSlot, active && styles.cfsSlotActive, !present && styles.cfsSlotEmpty]}>
      <View
        style={[
          styles.cfsSwatch,
          { backgroundColor: present ? filament.colorHex || colors.border : 'transparent' },
        ]}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.cfsSlotLabel}>{t('dashboard.slotN', { n: tray.trayId + 1 })}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {present ? filament.material || t('dashboard.filament') : t('dashboard.empty')}
        </Text>
      </View>
      {active && <Text style={styles.cfsActiveTag}>{t('dashboard.active')}</Text>}
    </View>
  );
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
  headerButtons: { flexDirection: 'row', gap: 16 },
  headerButton: { color: colors.text, fontSize: 18 },
  fullscreen: { flex: 1, backgroundColor: '#000' },
  fullscreenView: { flex: 1 },
  cfsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cfsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cfsSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    minWidth: '47%',
    flexGrow: 1,
  },
  cfsSlotActive: { borderColor: colors.accent },
  cfsSlotEmpty: { opacity: 0.5 },
  cfsSwatch: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  cfsSlotLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  cfsActiveTag: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  fanPresets: { flexDirection: 'row', gap: 8 },
  fanChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  fanChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  fanChipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  fanChipTextActive: { color: colors.text },
});
