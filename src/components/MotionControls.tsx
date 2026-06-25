import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, colors } from './ui';
import type { Translator } from '../i18n/useTranslation';

/** Jog distances (mm) offered for axis moves. */
const STEPS = [0.1, 1, 10, 50] as const;
/** Extrude/retract lengths (mm). */
const AMOUNTS = [1, 5, 10, 50] as const;
const AXES = ['X', 'Y', 'Z'] as const;

export interface MotionControlsProps {
  canMove: boolean;
  canHome: boolean;
  /** Tools available to extrude on; selector is shown only when there's >1. */
  extruders: { index: number; label: string }[];
  /** True while a print is active — motion is unsafe, so controls are locked. */
  disabled?: boolean;
  onHome: () => void;
  onMove: (axis: (typeof AXES)[number], distanceMm: number) => void;
  onExtrude: (extruder: number, distanceMm: number) => void;
  t: Translator['t'];
}

/**
 * Manual motion: home, per-axis jog, and extrude/retract. Backed by the OE
 * command API (cross-platform), gated by the printer's reported capabilities.
 * Jogs are relative; the selected step/amount applies to the next tap.
 */
export function MotionControls({
  canMove,
  canHome,
  extruders,
  disabled = false,
  onHome,
  onMove,
  onExtrude,
  t,
}: MotionControlsProps) {
  const [step, setStep] = useState<number>(10);
  const [amount, setAmount] = useState<number>(5);
  const [extruder, setExtruder] = useState<number>(extruders[0]?.index ?? 0);

  if (!canMove && !canHome) return null;

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>{t('motion.title')}</Text>
        {disabled && <Text style={styles.muted}>{t('motion.disabledPrinting')}</Text>}
      </View>

      {canHome && (
        <Button label={t('motion.home')} onPress={onHome} disabled={disabled} />
      )}

      {canMove && (
        <>
          <ChipRow
            label={t('motion.stepMm')}
            options={STEPS}
            selected={step}
            onSelect={setStep}
            format={(v) => String(v)}
            disabled={disabled}
          />
          {AXES.map((axis) => (
            <View key={axis} style={styles.axisRow}>
              <Text style={styles.axisLabel}>{axis}</Text>
              <View style={styles.axisButtons}>
                <JogButton label={`− ${step}`} onPress={() => onMove(axis, -step)} disabled={disabled} />
                <JogButton label={`+ ${step}`} onPress={() => onMove(axis, step)} disabled={disabled} />
              </View>
            </View>
          ))}

          <View style={styles.divider} />

          <ChipRow
            label={t('motion.amountMm')}
            options={AMOUNTS}
            selected={amount}
            onSelect={setAmount}
            format={(v) => String(v)}
            disabled={disabled}
          />
          {extruders.length > 1 && (
            <ChipRow
              options={extruders.map((e) => e.index)}
              selected={extruder}
              onSelect={setExtruder}
              format={(i) => extruders.find((e) => e.index === i)?.label ?? String(i)}
              disabled={disabled}
            />
          )}
          <View style={styles.controls}>
            <Button
              label={t('motion.retract')}
              onPress={() => onExtrude(extruder, -amount)}
              disabled={disabled}
            />
            <Button
              label={t('motion.extrude')}
              variant="primary"
              onPress={() => onExtrude(extruder, amount)}
              disabled={disabled}
            />
          </View>
        </>
      )}
    </Card>
  );
}

function ChipRow<T extends number>({
  label,
  options,
  selected,
  onSelect,
  format,
  disabled,
}: {
  label?: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  format: (value: T) => string;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.muted}>{label}</Text>}
      <View style={styles.chips}>
        {options.map((opt) => {
          const on = opt === selected;
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(opt)}
              disabled={disabled}
              style={[styles.chip, on && styles.chipActive, disabled && styles.dim]}
            >
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{format(opt)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function JogButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.jog, disabled && styles.dim, pressed && !disabled && styles.jogPressed]}
    >
      <Text style={styles.jogText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  axisRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  axisLabel: { color: colors.text, fontSize: 15, fontWeight: '600', width: 24 },
  axisButtons: { flexDirection: 'row', gap: 10, flex: 1, justifyContent: 'flex-end' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  controls: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.text },
  jog: {
    minWidth: 64,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  jogPressed: { opacity: 0.7 },
  jogText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dim: { opacity: 0.4 },
});
