import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  cancelSharedReservation,
  createSharedQuote,
  createSharedReservationHold,
  getSharedRole,
  listProviderInventory,
  listProviderOffers,
  listSharedOffers,
  listSharedProviders,
  listSharedReservations,
  listSharedReservationEvents,
  signInSharedAccount,
  signUpTravelerAccount,
  signOutSharedAccount,
  simulateSharedPayment,
  upsertProviderOffer,
  publishProviderInventory,
  type SharedQuote,
  type SharedReservation,
  type SharedReservationEvent,
  type SharedInventory,
  type SharedRole,
} from '../lib/reservationService';
import { brlFromCents } from '../utils/format';
import { colors, radius } from '../theme';

type PortalRow = Record<string, unknown>;

export function ReservationPortal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<SharedRole | null>(null);
  const [offers, setOffers] = useState<PortalRow[]>([]);
  const [providers, setProviders] = useState<PortalRow[]>([]);
  const [reservations, setReservations] = useState<SharedReservation[]>([]);
  const [events, setEvents] = useState<SharedReservationEvent[]>([]);
  const [providerOffers, setProviderOffers] = useState<PortalRow[]>([]);
  const [providerInventory, setProviderInventory] = useState<SharedInventory[]>([]);
  const [selectedProviderOfferId, setSelectedProviderOfferId] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<PortalRow | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('1');
  const [nights, setNights] = useState('1');
  const [quote, setQuote] = useState<SharedQuote | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'pix'>('card');
  const [offerTitle, setOfferTitle] = useState('Pousada laboratorio');
  const [offerPrice, setOfferPrice] = useState('32000');
  const [stock, setStock] = useState('1');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(nextRole = role) {
    const visibleOffers = await listSharedOffers();
    const visibleReservations = await listSharedReservations();
    setOffers(visibleOffers);
    setReservations(visibleReservations);
    if (nextRole === 'provider') {
      setProviderOffers(await listProviderOffers());
      setProviderInventory(await listProviderInventory());
    }
    if (nextRole === 'admin') {
      setProviders(await listSharedProviders());
      setEvents(await listSharedReservationEvents());
    }
  }

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const currentRole = await getSharedRole();
        if (!active) return;
        setRole(currentRole);
        if (!currentRole) return;
        const visibleOffers = await listSharedOffers();
        const visibleReservations = await listSharedReservations();
        const visibleProviders = currentRole === 'admin' ? await listSharedProviders() : [];
        const visibleEvents = currentRole === 'admin' ? await listSharedReservationEvents() : [];
        const ownedOffers = currentRole === 'provider' ? await listProviderOffers() : [];
        const ownedInventory = currentRole === 'provider' ? await listProviderInventory() : [];
        if (!active) return;
        setOffers(visibleOffers);
        setReservations(visibleReservations);
        setProviders(visibleProviders);
        setEvents(visibleEvents);
        setProviderOffers(ownedOffers);
        setProviderInventory(ownedInventory);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Error de conexion');
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    action()
      .catch(error => setMessage(error instanceof Error ? error.message : 'No se pudo completar la operacion'))
      .finally(() => setBusy(false));
  }

  function signIn() {
    run(async () => {
      await signInSharedAccount(email.trim(), password);
      const currentRole = await getSharedRole();
      setRole(currentRole);
      if (!currentRole) throw new Error('La cuenta no tiene un perfil Connectical asignado.');
      await refresh(currentRole);
      setPassword('');
    });
  }

  function signUp() {
    run(async () => {
      await signUpTravelerAccount({ email: email.trim(), password, name: name.trim() });
      setMessage('Cuenta viajero creada. Verifica tu correo si InsForge lo solicita y luego inicia sesion.');
      setPassword('');
    });
  }

  function signOut() {
    run(async () => {
      await signOutSharedAccount();
      setRole(null);
      setReservations([]);
      setProviders([]);
      setOffers([]);
      setEvents([]);
      setProviderOffers([]);
      setProviderInventory([]);
      setMessage('Sesion cerrada.');
    });
  }

  function createQuote() {
    if (!selectedOffer) return;
    run(async () => {
      const nextQuote = await createSharedQuote({
        offerId: String(selectedOffer.id),
        serviceDate: date,
        quantity: Number(quantity),
        nights: Number(nights),
        serviceFeeRateBps: 600,
      });
      setQuote(nextQuote);
      setMessage('Cotizacion BRL congelada por 15 minutos.');
    });
  }

  function reserve() {
    if (!quote) return;
    run(async () => {
      const held = await createSharedReservationHold(quote.id, quote.id);
      const confirmed = await simulateSharedPayment(held.id, 'approved', paymentMethod);
      setQuote(null);
      await refresh();
      setMessage(`Reserva ${confirmed.status}: ${confirmed.id}`);
    });
  }

  function createOffer() {
    run(async () => {
      const offer = await upsertProviderOffer({
        offerId: selectedProviderOfferId ?? undefined,
        category: 'pousadas',
        title: offerTitle.trim(),
        basePriceCents: Number(offerPrice),
        priceMode: 'night',
        published: true,
      });
      await publishProviderInventory({
        offerId: String(offer.id),
        serviceDate: date,
        totalUnits: Number(stock),
      });
      await refresh();
      setSelectedProviderOfferId(String(offer.id));
      setMessage('Oferta y disponibilidad guardadas en la base compartida.');
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.kicker}>CONNECTICAL · OPERACIONES</Text>
          <Text style={styles.title}>Reservas compartidas</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Cerrar</Text>
        </Pressable>
      </View>
      <Text style={styles.notice}>BRL contractual · pagos de laboratorio · sin cobro real</Text>
      {!role ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Acceso de cuenta</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Nombre" placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Correo" placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Contrasena" placeholderTextColor={colors.muted} style={styles.input} />
          <ActionButton title="Iniciar sesion" onPress={signIn} disabled={busy || !email || !password} />
          <ActionButton title="Crear cuenta de turista" onPress={signUp} disabled={busy || !name.trim() || !email || password.length < 8} secondary />
          <Text style={styles.helper}>Las cuentas y roles se aprovisionan en el backend. No se crean roles desde el dispositivo.</Text>
        </View>
      ) : (
        <>
          <View style={styles.roleBar}>
            <Text style={styles.roleLabel}>Sesion autenticada · {role}</Text>
            <Pressable onPress={signOut} accessibilityRole="button"><Text style={styles.link}>Salir</Text></Pressable>
          </View>
          {role === 'traveler' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Ofertas publicadas</Text>
                {offers.length ? offers.map(offer => (
                  <Pressable key={String(offer.id)} onPress={() => { setSelectedOffer(offer); setQuote(null); }} style={[styles.offer, selectedOffer?.id === offer.id && styles.selected]}>
                    <View style={styles.flex}>
                      <Text style={styles.offerName}>{String(offer.title)}</Text>
                      <Text style={styles.helper}>{String(offer.price_mode)} · {String(offer.currency)}</Text>
                    </View>
                    <Text style={styles.amount}>{brlFromCents(Number(offer.base_price_cents))}</Text>
                  </Pressable>
                )) : <Text style={styles.helper}>Todavia no hay ofertas publicadas.</Text>}
              </View>
              {selectedOffer ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Cotizar y reservar</Text>
                  <Field label="Fecha (AAAA-MM-DD)" value={date} onChange={setDate} />
                  <Field label="Habitaciones / unidades" value={quantity} onChange={setQuantity} numeric />
                  <Field label="Noches" value={nights} onChange={setNights} numeric />
                  <ActionButton title="Crear cotizacion" onPress={createQuote} disabled={busy} />
                  {quote ? (
                    <View style={styles.quote}>
                      <Text style={styles.helper}>Cotizacion congelada · {quote.quote_version}</Text>
                      <MoneyRow label="Subtotal" cents={quote.subtotal_cents} />
                      <MoneyRow label="Cargo servicio" cents={quote.service_fee_cents} />
                      <MoneyRow label="Total BRL" cents={quote.traveler_total_cents} strong />
                      <View style={styles.paymentOptions}>
                        {(['card', 'pix'] as const).map(method => (
                          <Pressable key={method} onPress={() => setPaymentMethod(method)} accessibilityRole="button" accessibilityState={{ selected: paymentMethod === method }} style={[styles.paymentOption, paymentMethod === method && styles.paymentOptionSelected]}>
                            <Text style={[styles.paymentLabel, paymentMethod === method && styles.paymentLabelSelected]}>{method === 'card' ? 'Tarjeta internacional' : 'Pix'} · simulado</Text>
                          </Pressable>
                        ))}
                      </View>
                      <ActionButton title="Reservar y aprobar pago simulado" onPress={reserve} disabled={busy} />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
          {role === 'provider' ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Mis ofertas</Text>
              {providerOffers.map(offer => (
                <Pressable
                  key={String(offer.id)}
                  onPress={() => {
                    setSelectedProviderOfferId(String(offer.id));
                    setOfferTitle(String(offer.title));
                    setOfferPrice(String(offer.base_price_cents));
                  }}
                  style={[styles.offer, selectedProviderOfferId === offer.id && styles.selected]}
                >
                  <Text style={styles.offerName}>{String(offer.title)}</Text>
                  <Text style={styles.amount}>{brlFromCents(Number(offer.base_price_cents))}</Text>
                </Pressable>
              ))}
              <ActionButton
                title="Crear otra oferta"
                secondary
                onPress={() => {
                  setSelectedProviderOfferId(null);
                  setOfferTitle('Pousada laboratorio');
                  setOfferPrice('32000');
                }}
              />
              <Text style={styles.sectionTitle}>{selectedProviderOfferId ? 'Editar precio y cupo' : 'Nueva oferta y disponibilidad'}</Text>
              <Field label="Nombre de la oferta" value={offerTitle} onChange={setOfferTitle} />
              <Field label="Precio BRL en centavos" value={offerPrice} onChange={setOfferPrice} numeric />
              <Field label="Fecha (AAAA-MM-DD)" value={date} onChange={setDate} />
              <Field label="Habitaciones disponibles" value={stock} onChange={setStock} numeric />
              <ActionButton title={selectedProviderOfferId ? 'Guardar cambios y cupo' : 'Publicar oferta y cupo'} onPress={createOffer} disabled={busy} />
              <Text style={styles.sectionTitle}>Mis cupos compartidos</Text>
              {providerInventory.length ? providerInventory.map(item => {
                const offer = providerOffers.find(entry => entry.id === item.offer_id);
                return (
                  <View key={`${item.offer_id}:${item.service_date}`} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.offerName}>{String(offer?.title ?? item.offer_id)}</Text>
                      <Text style={styles.helper}>{item.service_date} · {item.held_units} retenidos · {item.sold_units} vendidos</Text>
                    </View>
                    <Text style={styles.amount}>{item.total_units - item.held_units - item.sold_units} libres</Text>
                  </View>
                );
              }) : <Text style={styles.helper}>Todavia no hay cupos publicados.</Text>}
              <Text style={styles.sectionTitle}>Reservas recibidas</Text>
              <ReservationList reservations={reservations} onCancel={id => run(async () => { await cancelSharedReservation(id, 'provider_cancelled'); await refresh(); })} />
            </View>
          ) : null}
          {role === 'admin' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Proveedores · {providers.length}</Text>
                {providers.map(provider => (
                  <View key={String(provider.id)} style={styles.row}>
                    <Text style={styles.offerName}>{String(provider.name)}</Text>
                    <Text style={styles.helper}>{Number(provider.commission_rate_bps) / 100}% · {provider.active ? 'activo' : 'pausado'}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reservas · {reservations.length}</Text>
                <Text style={styles.helper}>Comision snapshot: {brlFromCents(reservations.reduce((sum, item) => sum + item.provider_commission_cents, 0))}</Text>
                <Text style={styles.helper}>Fee de servicio Connectical snapshot: {brlFromCents(reservations.reduce((sum, item) => sum + item.connectical_margin_cents, 0))}</Text>
                <ReservationList reservations={reservations} onCancel={id => run(async () => { await cancelSharedReservation(id, 'admin_review'); await refresh(); })} />
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Historial e incidencias · {events.length}</Text>
                {events.map(event => (
                  <View key={event.id} style={styles.eventRow}>
                    <Text style={styles.offerName}>{event.event_type}</Text>
                    <Text style={styles.helper}>{event.created_at} · {event.reservation_id}</Text>
                  </View>
                ))}
                {!events.length ? <Text style={styles.helper}>Sin eventos registrados.</Text> : null}
              </View>
            </>
          ) : null}
          {role === 'traveler' ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Mis reservas</Text>
              <ReservationList reservations={reservations} onCancel={id => run(async () => { await cancelSharedReservation(id, 'traveler_request'); await refresh(); })} />
            </View>
          ) : null}
          <ActionButton title="Actualizar datos" onPress={() => run(() => refresh())} disabled={busy} secondary />
        </>
      )}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

function ReservationList({ reservations, onCancel }: { reservations: SharedReservation[]; onCancel: (id: string) => void }) {
  if (!reservations.length) return <Text style={styles.helper}>Sin reservas visibles para esta cuenta.</Text>;
  return <>{reservations.map(reservation => (
    <View key={reservation.id} style={styles.reservation}>
      <View style={styles.flex}>
        <Text style={styles.offerName}>{reservation.status.toUpperCase()} · {brlFromCents(reservation.amount_cents)}</Text>
        <Text style={styles.helper}>{reservation.service_date} · proveedor recibe neto sujeto a conciliacion: {brlFromCents(reservation.amount_cents - reservation.provider_commission_cents)}</Text>
        <Text style={styles.helper}>Comision proveedor {brlFromCents(reservation.provider_commission_cents)} · fee Connectical {brlFromCents(reservation.connectical_margin_cents)}</Text>
        <Text selectable style={styles.id}>{reservation.id}</Text>
      </View>
      {reservation.status === 'held' || reservation.status === 'confirmed' ? <Pressable onPress={() => onCancel(reservation.id)} accessibilityRole="button"><Text style={styles.link}>Cancelar</Text></Pressable> : null}
    </View>
  ))}</>;
}

function Field({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} keyboardType={numeric ? 'number-pad' : 'default'} style={styles.input} placeholderTextColor={colors.muted} /></View>;
}

function MoneyRow({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return <View style={styles.row}><Text style={strong ? styles.strong : styles.helper}>{label}</Text><Text style={strong ? styles.strong : styles.helper}>{brlFromCents(cents)}</Text></View>;
}

function ActionButton({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonLabel, secondary && styles.secondaryLabel]}>{title}</Text></Pressable>;
}

const styles = StyleSheet.create({
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
  paymentOptions: { flexDirection: 'row', gap: 8 },
  paymentOption: { flex: 1, minHeight: 42, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: colors.track, borderRadius: radius.card },
  paymentOptionSelected: { borderColor: colors.sea, backgroundColor: '#E8F1EB' },
  paymentLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  paymentLabelSelected: { color: colors.dark },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
  strong: { color: colors.dark, fontSize: 14, fontWeight: '900' },
  reservation: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderTopWidth: 1, borderColor: colors.track },
  eventRow: { paddingVertical: 9, borderTopWidth: 1, borderColor: colors.track, gap: 3 },
  id: { color: colors.muted, fontSize: 10, marginTop: 3 },
  message: { color: colors.dark, backgroundColor: '#FFF3D7', padding: 11, borderRadius: radius.card, fontSize: 12, lineHeight: 18 },
});
