import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from '../i18n/useTranslation';
import { Button, Card, colors } from './ui';

export interface SetTempTarget {
  /** Display title, e.g. "Nozzle 2" or "Bed". */
  label: string;
  /** Current target, °C. */
  current: number;
  /** Preset chips offered (excluding Off, which is always added). */
  presets: number[];
  /** Max accepted value, °C. */
  max: number;
}

/** Modal to pick a heater target: presets, a custom value, or Off (0). */
export function SetTempModal({
  target,
  onSet,
  onClose,
}: {
  target: SetTempTarget | null;
  onSet: (value: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState('');

  if (!target) return null;

  const apply = (value: number) => {
    const v = Math.max(0, Math.min(target.max, Math.round(value)));
    setCustom('');
    onSet(v);
  };

  const customValue = Number(custom);
  const customValid = custom.length > 0 && Number.isFinite(customValue) && customValue >= 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Card style={styles.card}>
            <Text style={styles.title}>{t('temp.setTitle', { label: target.label })}</Text>
            <Text style={styles.muted}>{t('temp.currentTarget', { value: Math.round(target.current) })}</Text>

            <View style={styles.presets}>
              <Pressable style={styles.chip} onPress={() => apply(0)}>
                <Text style={styles.chipText}>{t('common.off')}</Text>
              </Pressable>
              {target.presets.map((p) => (
                <Pressable key={p} style={styles.chip} onPress={() => apply(p)}>
                  <Text style={styles.chipText}>{p}°</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.customRow}>
              <TextInput
                style={styles.input}
                placeholder={t('temp.customPlaceholder', { max: target.max })}
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                value={custom}
                onChangeText={setCustom}
              />
              <Button label={t('common.set')} variant="primary" disabled={!customValid} onPress={() => apply(customValue)} />
            </View>

            <Button label={t('common.cancel')} onPress={onClose} />
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { gap: 14, minWidth: 300 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  customRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
    fontSize: 15,
  },
});
