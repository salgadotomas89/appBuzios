import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import { totalProviderStats, type ProviderOfferStats } from '../lib/platformService';
import { brlFromCents } from '../utils/format';
import { addDays } from '../utils/portalInput';
import { ActionButton, formatBps, portalStyles as styles } from './PortalControls';

// Estadísticas del proveedor: se cargan a demanda (una RPC agregada en el servidor) para no sumar una consulta
// más a cada apertura del portal. Periodo fijo de 30 días terminando hoy (fecha de Búzios).
export function ProviderStats({
  language,
  today,
  load,
  run,
  busy,
}: {
  language: Language;
  today: string;
  load: (from: string, to: string) => Promise<ProviderOfferStats[]>;
  run: (action: () => Promise<string | void>) => void;
  busy: boolean;
}) {
  const words = portalCopy[language].stats;
  const categories = portalCopy[language].categories;
  const [rows, setRows] = useState<ProviderOfferStats[] | null>(null);

  function show() {
    run(async () => {
      setRows(await load(addDays(today, -29), today));
    });
  }

  const totals = rows ? totalProviderStats(rows) : null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{words.title}</Text>
      <Text style={styles.helper}>{words.hint}</Text>
      <ActionButton title={words.load} onPress={show} disabled={busy} secondary />
      {rows && !rows.length ? <Text style={styles.helper}>{words.empty}</Text> : null}
      {totals && rows?.length ? (
        <View style={styles.quote}>
          <Text style={styles.offerName}>{words.total}</Text>
          <Text style={styles.helper}>
            {words.quotes}: {totals.quotes} · {words.confirmed}: {totals.confirmed} · {words.cancelled}: {totals.cancelled} ·{' '}
            {words.conversion}: {formatBps(totals.conversionBps)}
          </Text>
          <Text style={styles.helper}>{words.gross}: {brlFromCents(totals.gross_cents)} · {words.net}: {brlFromCents(totals.net_cents)}</Text>
          <Text style={styles.helper}>
            {words.commission}: {brlFromCents(totals.commission_cents)} · {words.discount}: {brlFromCents(totals.discount_cents)} ·{' '}
            {words.refunded}: {brlFromCents(totals.refunded_cents)}
          </Text>
          <Text style={styles.helper}>{words.checkedIn}: {totals.checked_in} · {words.upcoming}: {totals.upcoming_7d}</Text>
        </View>
      ) : null}
      {rows?.map(row => (
        <View key={row.offer_id} style={styles.eventRow}>
          <Text style={styles.offerName}>{row.title} · {categories[row.category]}</Text>
          <Text style={styles.helper}>
            {words.confirmed}: {row.confirmed}/{row.reservations} · {words.units}: {row.units_sold} · {words.net}: {brlFromCents(row.net_cents)}
          </Text>
          {row.upcoming_7d ? <Text style={styles.helper}>{words.upcoming}: {row.upcoming_7d}</Text> : null}
        </View>
      ))}
    </View>
  );
}
