import { Text, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import type { SharedReservation } from '../lib/reservationService';
import { buildAgenda } from '../utils/agenda';
import { addDays } from '../utils/portalInput';
import { portalStyles as styles } from './PortalControls';

export function TravelerAgenda({
  reservations,
  offerTitles,
  today,
  language,
}: {
  reservations: SharedReservation[];
  offerTitles: Map<string, string>;
  today: string;
  language: Language;
}) {
  const words = portalCopy[language].agenda;
  const days = buildAgenda(reservations, today);
  const dayLabel = (date: string) => (date === today ? words.today : date === addDays(today, 1) ? words.tomorrow : date);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{words.title}</Text>
      {days.length ? days.map(day => (
        <View key={day.date} style={styles.eventRow}>
          <Text style={styles.offerName}>{dayLabel(day.date)}</Text>
          {day.items.map(item => (
            <Text key={`${item.reservation.id}:${item.night}`} style={styles.helper}>
              {offerTitles.get(item.reservation.offer_id) ?? item.reservation.offer_id} · ×{item.reservation.quantity}
              {item.nights > 1 ? ` · ${words.night.replace('{n}', String(item.night)).replace('{total}', String(item.nights))}` : ''}
              {item.reservation.status === 'confirmed' ? '' : ` · ${words.awaitingPayment}`}
              {item.reservation.voucher_code && item.night === 1 ? ` · ${item.reservation.voucher_code}` : ''}
            </Text>
          ))}
        </View>
      )) : <Text style={styles.helper}>{words.empty}</Text>}
    </View>
  );
}
