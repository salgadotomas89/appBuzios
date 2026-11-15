import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../theme';
import { brlFromCents } from '../utils/format';

// Controles y estilos compartidos por las pantallas del portal (reservas, administración y servicios).

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return `${whole}${fraction ? `,${String(fraction).padStart(2, '0').replace(/0$/, '')}` : ''} %`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Minutos enteros que faltan hasta `iso` (0 si ya pasó; null si la fecha no es válida). No depende de la zona horaria.
export function minutesUntil(iso: string, now: number = Date.now()): number | null {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 60000));
}

export function Field({
  label,
  value,
  onChange,
  numeric = false,
  decimal = false,
  maxLength,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  decimal?: boolean;
  maxLength?: number;
  multiline?: boolean;
}) {
  return (
    <View style={portalStyles.field}>
      <Text style={portalStyles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        maxLength={maxLength}
        multiline={multiline}
        keyboardType={decimal ? 'decimal-pad' : numeric ? 'number-pad' : 'default'}
        style={portalStyles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[portalStyles.chip, selected && portalStyles.chipSelected]}>
      <Text style={[portalStyles.chipLabel, selected && portalStyles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function MoneyRow({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return <View style={portalStyles.row}><Text style={strong ? portalStyles.strong : portalStyles.helper}>{label}</Text><Text style={strong ? portalStyles.strong : portalStyles.helper}>{brlFromCents(cents)}</Text></View>;
}

export function ActionButton({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[portalStyles.button, secondary && portalStyles.secondary, disabled && portalStyles.disabled]}><Text style={[portalStyles.buttonLabel, secondary && portalStyles.secondaryLabel]}>{title}</Text></Pressable>;
}

export const portalStyles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 46, gap: 14, backgroundColor: colors.background },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kicker: { color: colors.sea, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  title: { color: colors.dark, fontSize: 24, fontWeight: '800', marginTop: 4 },
  notice: { color: colors.dark, backgroundColor: '#E8F1EB', padding: 10, borderRadius: radius.card, fontSize: 12, fontWeight: '700' },
  section: { paddingVertical: 8, gap: 10 },
  sectionTitle: { color: colors.dark, fontSize: 16, fontWeight: '800', marginTop: 4 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.track, borderRadius: radius.card, paddingHorizontal: 12, color: colors.dark, backgroundColor: colors.card },
  field: { gap: 5 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  button: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.card, backgroundColor: colors.sea },
  buttonLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.track },
  secondaryLabel: { color: colors.dark },
  disabled: { opacity: 0.55 },
  textButton: { padding: 8 },
  textButtonLabel: { color: colors.sea, fontSize: 13, fontWeight: '800' },
  roleBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.track },
  roleLabel: { color: colors.dark, fontSize: 13, fontWeight: '800' },
  link: { color: colors.sea, fontSize: 12, fontWeight: '800', padding: 6 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: colors.track, borderRadius: radius.card, backgroundColor: colors.card },
  selected: { borderColor: colors.sea, borderWidth: 2 },
  flex: { flex: 1, gap: 3 },
  offerName: { color: colors.dark, fontSize: 13, fontWeight: '800' },
  amount: { color: colors.sea, fontSize: 14, fontWeight: '800' },
  quote: { gap: 10, padding: 12, backgroundColor: colors.card, borderRadius: radius.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.track, borderRadius: radius.card, backgroundColor: colors.card },
  chipSelected: { borderColor: colors.sea, backgroundColor: '#E8F1EB' },
  chipLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  chipLabelSelected: { color: colors.dark },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
  strong: { color: colors.dark, fontSize: 14, fontWeight: '900' },
  reservation: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderTopWidth: 1, borderColor: colors.track },
  eventRow: { paddingVertical: 9, borderTopWidth: 1, borderColor: colors.track, gap: 3 },
  id: { color: colors.muted, fontSize: 10, marginTop: 3 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warning: { color: colors.dark, backgroundColor: '#FFF3D7', padding: 9, borderRadius: radius.card, fontSize: 12, lineHeight: 18 },
  message: { color: colors.dark, backgroundColor: '#FFF3D7', padding: 11, borderRadius: radius.card, fontSize: 12, lineHeight: 18 },
});
