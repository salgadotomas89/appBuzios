import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  listOfferAvailability,
  ReservationError,
  signInSharedAccount,
  signUpTravelerAccount,
  signOutSharedAccount,
  simulateSharedPayment,
  upsertProviderOffer,
  publishProviderInventory,
  type SharedInventory,
  type SharedOffer,
  type SharedProvider,
  type SharedQuote,
  type SharedReservation,
  type SharedReservationEvent,
  type SharedRole,
} from '../lib/reservationService';
import type { Language } from '../data/homeMock';
import {
  inputErrorText,
  portalCopy,
  type PortalCategory,
  type PortalPriceMode,
  type ReservationStatus,
  type SimulatedOutcome,
} from '../i18n/portalCopy';
import { brlFromCents } from '../utils/format';
import { DEMO_SERVICE_FEE_RATES, type DemoServiceFeeRate } from '../utils/journey';
import {
  addDays,
  buziosIsoDate,
  centsToBrlInput,
  parseBrlToCents,
  parseCount,
  parseIsoDate,
  type ParseResult,
} from '../utils/portalInput';
import { colors, radius } from '../theme';

const CATEGORIES: PortalCategory[] = ['pousadas', 'barcos', 'noche', 'buggy'];
const PRICE_MODES: PortalPriceMode[] = ['night', 'person', 'ticket', 'group'];
const OUTCOMES: SimulatedOutcome[] = ['approved', 'rejected', 'pending'];
const STATUSES: ReservationStatus[] = ['held', 'pending_payment', 'confirmed', 'expired', 'cancelled', 'refunded'];
const MAX_NIGHTS = 30;
const MAX_UNITS = 500;
// Igual que el límite de connectical_provider_upsert_offer.
const MAX_TITLE_LENGTH = 120;
const DEFAULT_OFFER = { title: 'Pousada laboratorio', price: '320,00' };

type CancelReason = 'traveler_request' | 'provider_cancelled' | 'admin_review';

// Se lanza para mostrar un mensaje ya traducido sin pasar por el mapa de errores.
class InputValidationError extends Error {}

export function ReservationPortal({
  onClose,
  language = 'es',
}: {
  onClose: () => void;
  language?: Language;
}) {
  const words = portalCopy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<SharedRole | null>(null);
  const [offers, setOffers] = useState<SharedOffer[]>([]);
  const [providers, setProviders] = useState<SharedProvider[]>([]);
  const [reservations, setReservations] = useState<SharedReservation[]>([]);
  const [events, setEvents] = useState<SharedReservationEvent[]>([]);
  const [providerOffers, setProviderOffers] = useState<SharedOffer[]>([]);
  const [providerInventory, setProviderInventory] = useState<SharedInventory[]>([]);
  const [selectedProviderOfferId, setSelectedProviderOfferId] = useState<string | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<SharedOffer | null>(null);
  const [availability, setAvailability] = useState<SharedInventory[] | null>(null);
  const [date, setDate] = useState(buziosIsoDate());
  const [quantity, setQuantity] = useState('1');
  const [nights, setNights] = useState('1');
  const [serviceFeeRateBps, setServiceFeeRateBps] = useState<DemoServiceFeeRate>(600);
  const [quote, setQuote] = useState<SharedQuote | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'pix'>('card');
  const [paymentOutcome, setPaymentOutcome] = useState<SimulatedOutcome>('approved');
  const [offerTitle, setOfferTitle] = useState(DEFAULT_OFFER.title);
  const [offerPrice, setOfferPrice] = useState(DEFAULT_OFFER.price);
  const [offerCategory, setOfferCategory] = useState<PortalCategory>('pousadas');
  const [offerPriceMode, setOfferPriceMode] = useState<PortalPriceMode>('night');
  const [stock, setStock] = useState('1');
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // Se incrementa al cambiar los datos de la cotización; una respuesta tardía con otro valor se descarta.
  const quoteRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function describeError(error: unknown): string {
    if (error instanceof ReservationError && error.code) return words.errors[error.code];
    if (error instanceof Error) return error.message;
    return words.genericError;
  }

  function valueOf<T>(result: ParseResult<T>, label: string): T {
    if (!result.ok) throw new InputValidationError(inputErrorText(language, label, result.error));
    return result.value;
  }

  async function loadForRole(nextRole: SharedRole) {
    const [visibleOffers, visibleReservations] = await Promise.all([
      listSharedOffers(),
      listSharedReservations(),
    ]);
    const [visibleProviders, visibleEvents, ownedOffers, ownedInventory] = await Promise.all([
      nextRole === 'admin' ? listSharedProviders() : Promise.resolve([]),
      nextRole === 'admin' ? listSharedReservationEvents() : Promise.resolve([]),
      nextRole === 'provider' ? listProviderOffers() : Promise.resolve([]),
      nextRole === 'provider' ? listProviderInventory() : Promise.resolve([]),
    ]);
    if (!mounted.current) return;
    setOffers(visibleOffers);
    setReservations(visibleReservations);
    setProviders(visibleProviders);
    setEvents(visibleEvents);
    setProviderOffers(ownedOffers);
    setProviderInventory(ownedInventory);
  }

  useEffect(() => {
    async function restoreSession() {
      try {
        const currentRole = await getSharedRole();
        if (!mounted.current) return;
        setRole(currentRole);
        if (currentRole) await loadForRole(currentRole);
      } catch (error) {
        if (mounted.current) setMessage(describeError(error));
      }
    }
    restoreSession();
    // Solo restaura la sesión al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(action: () => Promise<string | void>) {
    setBusy(true);
    setMessage('');
    action()
      .then(result => {
        if (mounted.current && result) setMessage(result);
      })
      .catch(error => {
        if (mounted.current) setMessage(describeError(error));
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }

  function refresh() {
    run(async () => {
      if (role) await loadForRole(role);
    });
  }

  function signIn() {
    run(async () => {
      await signInSharedAccount(email.trim(), password);
      const currentRole = await getSharedRole();
      setRole(currentRole);
      if (!currentRole) throw new InputValidationError(words.noProfile);
      setPassword('');
      await loadForRole(currentRole);
    });
  }

  function signUp() {
    run(async () => {
      await signUpTravelerAccount({ email: email.trim(), password, name: name.trim() });
      setPassword('');
      return words.signUpDone;
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
      setSelectedOffer(null);
      setQuote(null);
      return words.signedOut;
    });
  }

  function invalidateQuote() {
    quoteRequest.current += 1;
    setQuote(null);
  }

  function selectOffer(offer: SharedOffer) {
    setSelectedOffer(offer);
    setAvailability(null);
    invalidateQuote();
    if (offer.price_mode !== 'night') setNights('1');
    run(async () => {
      const dates = await listOfferAvailability(offer.id, buziosIsoDate());
      if (mounted.current) setAvailability(dates);
    });
  }

  function createQuote() {
    if (!selectedOffer) return;
    const perNight = selectedOffer.price_mode === 'night';
    const requestId = ++quoteRequest.current;
    run(async () => {
      const serviceDate = valueOf(
        parseIsoDate(date, buziosIsoDate()),
        perNight ? words.checkIn : words.date,
      );
      const units = valueOf(parseCount(quantity, { max: MAX_UNITS }), words.quantity[selectedOffer.price_mode]);
      const stayNights = perNight ? valueOf(parseCount(nights, { max: MAX_NIGHTS }), words.nights) : 1;
      const nextQuote = await createSharedQuote({
        offerId: selectedOffer.id,
        serviceDate,
        quantity: units,
        nights: stayNights,
        serviceFeeRateBps,
      });
      if (requestId !== quoteRequest.current) return;
      setQuote(nextQuote);
      return words.quoteCreated;
    });
  }

  function reserve() {
    if (!quote) return;
    run(async () => {
      // La cotización solo admite una reserva, así que su id sirve como clave de idempotencia.
      const held = await createSharedReservationHold(quote.id, quote.id);
      const result = await simulateSharedPayment(held.id, paymentOutcome, paymentMethod);
      setQuote(null);
      if (role) await loadForRole(role);
      return `${words.reserved}: ${words.status[result.status]} · ${result.id}`;
    });
  }

  function pay(reservationId: string) {
    run(async () => {
      const result = await simulateSharedPayment(reservationId, paymentOutcome, paymentMethod);
      if (role) await loadForRole(role);
      return `${words.reserved}: ${words.status[result.status]} · ${result.id}`;
    });
  }

  function cancel(reservationId: string, reason: CancelReason) {
    run(async () => {
      await cancelSharedReservation(reservationId, reason);
      if (role) await loadForRole(role);
      return words.cancelled;
    });
  }

  function editProviderOffer(offer: SharedOffer) {
    setSelectedProviderOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferPrice(centsToBrlInput(offer.base_price_cents));
    setOfferCategory(offer.category);
    setOfferPriceMode(offer.price_mode);
  }

  function startNewOffer() {
    setSelectedProviderOfferId(null);
    setOfferTitle(DEFAULT_OFFER.title);
    setOfferPrice(DEFAULT_OFFER.price);
    setOfferCategory('pousadas');
    setOfferPriceMode('night');
  }

  function saveOffer() {
    run(async () => {
      const title = offerTitle.trim();
      if (!title) throw new InputValidationError(words.errors.invalid_offer);
      const basePriceCents = valueOf(parseBrlToCents(offerPrice), words.priceBrl);
      const serviceDate = valueOf(parseIsoDate(date, buziosIsoDate()), words.date);
      const totalUnits = valueOf(parseCount(stock, { min: 0, max: MAX_UNITS }), words.units);
      const offer = await upsertProviderOffer({
        offerId: selectedProviderOfferId ?? undefined,
        category: offerCategory,
        title,
        basePriceCents,
        priceMode: offerPriceMode,
        published: true,
      });
      await publishProviderInventory({ offerId: offer.id, serviceDate, totalUnits });
      setSelectedProviderOfferId(offer.id);
      if (role) await loadForRole(role);
      return words.offerSaved;
    });
  }

  const offerTitles = new Map([...offers, ...providerOffers].map(offer => [offer.id, offer.title]));
  const visibleReservations = statusFilter
    ? reservations.filter(reservation => reservation.status === statusFilter)
    : reservations;
  const perNight = selectedOffer?.price_mode === 'night';
  const parsedNights = Number(nights);
  const checkOut =
    perNight && parseIsoDate(date, '0000-01-01').ok && Number.isInteger(parsedNights) && parsedNights > 0
      ? addDays(date.trim(), parsedNights)
      : null;

  const reservationList = (reason: CancelReason, list = reservations) => (
    <ReservationList
      reservations={list}
      offerTitles={offerTitles}
      words={words}
      onCancel={id => cancel(id, reason)}
      // Solo el turista paga; el backend rechaza pagos de reservas ajenas.
      onPay={role === 'traveler' ? pay : undefined}
      disabled={busy}
    />
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}>
        <View>
          <Text style={styles.kicker}>{words.kicker}</Text>
          <Text style={styles.title}>{words.title}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={styles.textButton}>
          <Text style={styles.textButtonLabel}>{words.close}</Text>
        </Pressable>
      </View>
      <Text style={styles.notice}>{words.notice}</Text>
      {!role ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{words.accountAccess}</Text>
          <TextInput value={name} onChangeText={setName} placeholder={words.name} accessibilityLabel={words.name} placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={words.email} accessibilityLabel={words.email} placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder={words.password} accessibilityLabel={words.password} placeholderTextColor={colors.muted} style={styles.input} />
          <ActionButton title={words.signIn} onPress={signIn} disabled={busy || !email.trim() || !password} />
          <ActionButton title={words.signUp} onPress={signUp} disabled={busy || !name.trim() || !email.trim() || password.length < 8} secondary />
          {password && password.length < 8 ? <Text style={styles.helper}>{words.passwordHint}</Text> : null}
          <Text style={styles.helper}>{words.rolesHint}</Text>
        </View>
      ) : (
        <>
          <View style={styles.roleBar}>
            <Text style={styles.roleLabel}>{words.signedInAs} · {words.roles[role]}</Text>
            <Pressable onPress={signOut} disabled={busy} accessibilityRole="button"><Text style={styles.link}>{words.signOut}</Text></Pressable>
          </View>
          {role === 'traveler' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.publishedOffers}</Text>
                {offers.length ? offers.map(offer => (
                  <Pressable
                    key={offer.id}
                    onPress={() => selectOffer(offer)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedOffer?.id === offer.id }}
                    style={[styles.offer, selectedOffer?.id === offer.id && styles.selected]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.offerName}>{offer.title}</Text>
                      <Text style={styles.helper}>{words.categories[offer.category]} · {words.priceUnit[offer.price_mode]}</Text>
                    </View>
                    <Text style={styles.amount}>{brlFromCents(offer.base_price_cents)}</Text>
                  </Pressable>
                )) : <Text style={styles.helper}>{words.noOffers}</Text>}
              </View>
              {selectedOffer ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{words.quoteAndBook} · {selectedOffer.title}</Text>
                  {availability ? (
                    <>
                      <Text style={styles.fieldLabel}>{words.availability}</Text>
                      {availability.some(item => item.total_units - item.held_units - item.sold_units > 0) ? (
                        <View style={styles.chips}>
                          {availability
                            .filter(item => item.total_units - item.held_units - item.sold_units > 0)
                            .slice(0, 12)
                            .map(item => (
                              <Chip
                                key={item.service_date}
                                label={`${item.service_date} · ${item.total_units - item.held_units - item.sold_units}`}
                                selected={date.trim() === item.service_date}
                                onPress={() => {
                                  setDate(item.service_date);
                                  invalidateQuote();
                                }}
                              />
                            ))}
                        </View>
                      ) : <Text style={styles.helper}>{words.noAvailability}</Text>}
                    </>
                  ) : null}
                  <Field label={perNight ? words.checkIn : words.date} value={date} onChange={value => { setDate(value); invalidateQuote(); }} />
                  <Field label={words.quantity[selectedOffer.price_mode]} value={quantity} onChange={value => { setQuantity(value); invalidateQuote(); }} numeric />
                  {perNight ? (
                    <>
                      <Field label={words.nights} value={nights} onChange={value => { setNights(value); invalidateQuote(); }} numeric />
                      {checkOut ? <Text style={styles.helper}>{words.checkOut}: {checkOut}</Text> : null}
                    </>
                  ) : null}
                  <Text style={styles.helper}>{words.feeHint}</Text>
                  <View style={styles.chips}>
                    {DEMO_SERVICE_FEE_RATES.map(rate => (
                      <Chip
                        key={rate}
                        label={`${rate / 100}%`}
                        selected={serviceFeeRateBps === rate}
                        onPress={() => {
                          setServiceFeeRateBps(rate);
                          invalidateQuote();
                        }}
                      />
                    ))}
                  </View>
                  <ActionButton title={words.createQuote} onPress={createQuote} disabled={busy} />
                  {quote ? (
                    <View style={styles.quote}>
                      <Text style={styles.helper}>{words.frozenQuote} · {quote.quote_version} · {quote.service_date}{quote.nights > 1 ? ` → ${addDays(quote.service_date, quote.nights)}` : ''}</Text>
                      <MoneyRow label={words.subtotal} cents={quote.subtotal_cents} />
                      <MoneyRow label={`${words.travelerFee} · ${quote.service_fee_rate_bps / 100}%`} cents={quote.service_fee_cents} />
                      <MoneyRow label={words.total} cents={quote.traveler_total_cents} strong />
                      <View style={styles.chips}>
                        {(['card', 'pix'] as const).map(method => (
                          <Chip
                            key={method}
                            label={`${method === 'card' ? words.card : words.pix} · ${words.simulated}`}
                            selected={paymentMethod === method}
                            onPress={() => setPaymentMethod(method)}
                          />
                        ))}
                      </View>
                      <Text style={styles.fieldLabel}>{words.outcome}</Text>
                      <View style={styles.chips}>
                        {OUTCOMES.map(outcome => (
                          <Chip key={outcome} label={words.outcomes[outcome]} selected={paymentOutcome === outcome} onPress={() => setPaymentOutcome(outcome)} />
                        ))}
                      </View>
                      <ActionButton title={words.reserve} onPress={reserve} disabled={busy} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.myReservations}</Text>
                {reservationList('traveler_request')}
              </View>
            </>
          ) : null}
          {role === 'provider' ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{words.myOffers}</Text>
              {providerOffers.map(offer => (
                <Pressable
                  key={offer.id}
                  onPress={() => editProviderOffer(offer)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedProviderOfferId === offer.id }}
                  style={[styles.offer, selectedProviderOfferId === offer.id && styles.selected]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.offerName}>{offer.title}</Text>
                    <Text style={styles.helper}>{words.categories[offer.category]} · {words.priceUnit[offer.price_mode]}</Text>
                  </View>
                  <Text style={styles.amount}>{brlFromCents(offer.base_price_cents)}</Text>
                </Pressable>
              ))}
              <ActionButton title={words.newOffer} secondary onPress={startNewOffer} disabled={busy} />
              <Text style={styles.sectionTitle}>{selectedProviderOfferId ? words.editOffer : words.createOfferTitle}</Text>
              <Field label={words.offerName} value={offerTitle} onChange={setOfferTitle} maxLength={MAX_TITLE_LENGTH} />
              <Text style={styles.fieldLabel}>{words.category}</Text>
              <View style={styles.chips}>
                {CATEGORIES.map(category => (
                  <Chip key={category} label={words.categories[category]} selected={offerCategory === category} onPress={() => setOfferCategory(category)} />
                ))}
              </View>
              <Text style={styles.fieldLabel}>{words.priceMode}</Text>
              <View style={styles.chips}>
                {PRICE_MODES.map(mode => (
                  <Chip key={mode} label={words.priceUnit[mode]} selected={offerPriceMode === mode} onPress={() => setOfferPriceMode(mode)} />
                ))}
              </View>
              <Field label={words.priceBrl} value={offerPrice} onChange={setOfferPrice} decimal />
              <Field label={words.date} value={date} onChange={setDate} />
              <Field label={words.units} value={stock} onChange={setStock} numeric />
              <ActionButton title={selectedProviderOfferId ? words.saveOffer : words.publishOffer} onPress={saveOffer} disabled={busy} />
              <Text style={styles.sectionTitle}>{words.myInventory}</Text>
              {providerInventory.length ? providerInventory.map(item => (
                <View key={`${item.offer_id}:${item.service_date}`} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.offerName}>{offerTitles.get(item.offer_id) ?? item.offer_id}</Text>
                    <Text style={styles.helper}>{item.service_date} · {item.held_units} {words.held} · {item.sold_units} {words.sold}</Text>
                  </View>
                  <Text style={styles.amount}>{item.total_units - item.held_units - item.sold_units} {words.free}</Text>
                </View>
              )) : <Text style={styles.helper}>{words.noInventory}</Text>}
              <Text style={styles.sectionTitle}>{words.receivedReservations}</Text>
              {reservationList('provider_cancelled')}
            </View>
          ) : null}
          {role === 'admin' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.providers} · {providers.length}</Text>
                {providers.map(provider => (
                  <View key={provider.id} style={styles.row}>
                    <Text style={styles.offerName}>{provider.name}</Text>
                    <Text style={styles.helper}>{provider.commission_rate_bps / 100}% · {provider.active ? words.active : words.paused}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.reservations} · {visibleReservations.length}</Text>
                <Text style={styles.helper}>{words.commissionTotal}: {brlFromCents(visibleReservations.reduce((sum, item) => sum + item.provider_commission_cents, 0))}</Text>
                <Text style={styles.helper}>{words.feeTotal}: {brlFromCents(visibleReservations.reduce((sum, item) => sum + item.connectical_margin_cents, 0))}</Text>
                <View style={styles.chips}>
                  <Chip label={words.allStatuses} selected={statusFilter === null} onPress={() => setStatusFilter(null)} />
                  {STATUSES.map(status => (
                    <Chip key={status} label={words.status[status]} selected={statusFilter === status} onPress={() => setStatusFilter(status)} />
                  ))}
                </View>
                {reservationList('admin_review', visibleReservations)}
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.history} · {events.length}</Text>
                {events.map(event => (
                  <View key={event.id} style={styles.eventRow}>
                    <Text style={styles.offerName}>{words.eventTypes[event.event_type] ?? event.event_type}</Text>
                    <Text style={styles.helper}>{event.created_at} · {event.reservation_id}</Text>
                  </View>
                ))}
                {!events.length ? <Text style={styles.helper}>{words.noEvents}</Text> : null}
              </View>
            </>
          ) : null}
          <ActionButton title={words.refresh} onPress={refresh} disabled={busy} secondary />
        </>
      )}
      {busy ? (
        <View style={styles.busy} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.sea} />
          <Text style={styles.helper}>{words.working}</Text>
        </View>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

type PortalWords = (typeof portalCopy)[Language];

function ReservationList({
  reservations,
  offerTitles,
  words,
  onCancel,
  onPay,
  disabled,
}: {
  reservations: SharedReservation[];
  offerTitles: Map<string, string>;
  words: PortalWords;
  onCancel: (id: string) => void;
  onPay?: (id: string) => void;
  disabled: boolean;
}) {
  if (!reservations.length) return <Text style={styles.helper}>{words.noReservations}</Text>;
  return <>{reservations.map(reservation => {
    const nights = reservation.nights ?? 1;
    const awaitingPayment = reservation.status === 'held' || reservation.status === 'pending_payment';
    const dates = nights > 1
      ? `${reservation.service_date} → ${addDays(reservation.service_date, nights)}`
      : reservation.service_date;
    return (
      <View key={reservation.id} style={styles.reservation}>
        <View style={styles.flex}>
          <Text style={styles.offerName}>{words.status[reservation.status] ?? reservation.status} · {brlFromCents(reservation.amount_cents)}</Text>
          <Text style={styles.helper}>{offerTitles.get(reservation.offer_id) ?? reservation.offer_id} · {dates} · ×{reservation.quantity}</Text>
          <Text style={styles.helper}>{words.providerNet}: {brlFromCents(reservation.amount_cents - reservation.service_fee_cents - reservation.provider_commission_cents)}</Text>
          <Text style={styles.helper}>{words.travelerFee} {reservation.service_fee_rate_bps / 100}% · {brlFromCents(reservation.service_fee_cents)} · {words.providerCommission} {brlFromCents(reservation.provider_commission_cents)} · {words.connecticalIncome} {brlFromCents(reservation.connectical_margin_cents)}</Text>
          {awaitingPayment && reservation.hold_expires_at ? (
            <Text style={styles.helper}>{words.holdExpires}: {formatTime(reservation.hold_expires_at)}</Text>
          ) : null}
          <Text selectable style={styles.id}>{reservation.id}</Text>
        </View>
        <View>
          {awaitingPayment && onPay ? (
            <Pressable onPress={() => onPay(reservation.id)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${words.payNow} ${reservation.id}`}>
              <Text style={styles.link}>{words.payNow}</Text>
            </Pressable>
          ) : null}
          {awaitingPayment || reservation.status === 'confirmed' ? (
            <Pressable onPress={() => onCancel(reservation.id)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${words.cancel} ${reservation.id}`}>
              <Text style={styles.link}>{words.cancel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  })}</>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
  decimal = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  decimal?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        maxLength={maxLength}
        keyboardType={decimal ? 'decimal-pad' : numeric ? 'number-pad' : 'default'}
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function MoneyRow({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return <View style={styles.row}><Text style={strong ? styles.strong : styles.helper}>{label}</Text><Text style={strong ? styles.strong : styles.helper}>{brlFromCents(cents)}</Text></View>;
}

function ActionButton({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.buttonLabel, secondary && styles.secondaryLabel]}>{title}</Text></Pressable>;
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
  message: { color: colors.dark, backgroundColor: '#FFF3D7', padding: 11, borderRadius: radius.card, fontSize: 12, lineHeight: 18 },
});
