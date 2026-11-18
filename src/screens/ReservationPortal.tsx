import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  cancelSharedReservation,
  createSharedQuote,
  providerCheckIn,
  type CheckInResult,
  listProviderPromotions,
  saveProviderPromotion,
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
  restoreSharedSession,
  verifyTravelerEmail,
  resendVerificationCode,
  requestPasswordReset,
  resetAccountPassword,
  isSharedSessionPersisted,
  publishProviderInventoryRange,
  setProviderOfferDetails,
  setSharedProviderActive,
  getSweepHealth,
  listCommissionTerms,
  listPaymentReviews,
  type PaymentReview,
  setOfferCommission,
  type CommissionTerm,
  type SweepHealth,
  recordSharedRefund,
  type SharedInventory,
  type SharedOffer,
  type SharedProvider,
  type SharedQuote,
  type SharedReservation,
  type SharedReservationEvent,
  type SharedRole,
} from '../lib/reservationService';
import { AuthFlowError } from '../auth/authErrors';
import type { Language } from '../data/homeMock';
import {
  inputErrorText,
  PORTAL_CATEGORIES,
  portalCopy,
  type PortalCategory,
  type PortalPriceMode,
  type ReservationStatus,
  type SimulatedOutcome,
} from '../i18n/portalCopy';
import { brlFromCents } from '../utils/format';
import { voucherShareText } from '../utils/voucher';
import { DEMO_SERVICE_FEE_RATES, type DemoServiceFeeRate } from '../utils/journey';
import {
  addDays,
  buziosIsoDate,
  centsToBrlInput,
  parseBrlToCents,
  parseCount,
  parseIsoDate,
  parsePercentToBps,
  type ParseResult,
} from '../utils/portalInput';
import {
  findInconsistencies,
  newIdempotencyKey,
  refundAllowance,
  summarizeReservations,
} from '../utils/reservationTotals';
import {
  ActionButton,
  Chip,
  Field,
  formatBps,
  formatTime,
  minutesUntil,
  MoneyRow,
  portalStyles,
} from '../components/PortalControls';
import { colors } from '../theme';
import { OfferPhotoManager } from '../components/OfferPhotoManager';
import { PromotionManager } from '../components/PromotionManager';
import { ProviderStats } from '../components/ProviderStats';
import { TravelerAgenda } from '../components/TravelerAgenda';
import { OFFER_PHOTOS_ENABLED } from '../config/featureFlags';
import {
  deleteOwnPost,
  getOwnProviderProfile,
  getProviderStats,
  listOwnOfferMedia,
  listOwnPosts,
  saveOwnPost,
  updateOwnProviderProfile,
} from '../lib/platformService';
import { ProviderProfileForm } from '../components/ProviderProfileForm';
import { PostManager } from '../components/PostManager';
import { offerPhotoGateway } from '../media/offerPhotos';
import { sessionManager } from '../lib/insforge';
import { AdminConsole, type ConsoleSection } from './AdminConsole';
import { TravelerServices } from './TravelerServices';

const CATEGORIES: PortalCategory[] = PORTAL_CATEGORIES;
const PRICE_MODES: PortalPriceMode[] = ['night', 'person', 'ticket', 'group'];
const OUTCOMES: SimulatedOutcome[] = ['approved', 'rejected', 'pending'];
const STATUSES: ReservationStatus[] = ['held', 'pending_payment', 'confirmed', 'expired', 'cancelled', 'refunded'];
const MAX_NIGHTS = 30;
const MAX_UNITS = 500;
// Igual que el límite de connectical_provider_upsert_offer.
const MAX_TITLE_LENGTH = 120;
// Igual que el límite de connectical_admin_record_refund.
const MAX_REFUND_REASON_LENGTH = 500;
// Igual que el límite de connectical_provider_publish_inventory_range.
const MAX_PUBLISH_NIGHTS = 90;
const DEFAULT_OFFER = { title: 'Pousada laboratorio', price: '320,00' };
// Límites de connectical_provider_set_offer_details.
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 160;
const EMPTY_DETAILS = { description: '', location: '', meetingPoint: '', schedule: '', minQuantity: '1', maxQuantity: '' };

type CancelReason = 'traveler_request' | 'provider_cancelled' | 'admin_review';

// Se lanza para mostrar un mensaje ya traducido sin pasar por el mapa de errores.
class InputValidationError extends Error {}

const loadOfferMedia = (offerId: string) => listOwnOfferMedia(offerId);
const currentAccessToken = async () => (await sessionManager?.currentAccessToken()) ?? null;

type ProviderTab = 'bookings' | 'offers' | 'business';
// Administración en seis áreas; cada una muestra sus bloques y solo las secciones de la consola que le tocan.
type AdminArea = 'providers' | 'catalog' | 'bookings' | 'content' | 'finance' | 'settings';
const ADMIN_AREAS: AdminArea[] = ['providers', 'catalog', 'bookings', 'content', 'finance', 'settings'];
const ADMIN_AREA_SECTIONS: Record<AdminArea, ConsoleSection[]> = {
  providers: ['applications', 'categoryRates'],
  catalog: ['moderation', 'photos'],
  bookings: ['incidents'],
  content: ['posts', 'campaigns'],
  finance: ['kpis'],
  settings: ['users', 'audit'],
};
const PROVIDER_TABS: ProviderTab[] = ['bookings', 'offers', 'business'];

export function ReservationPortal({
  onClose,
  language = 'es',
  photosEnabled = OFFER_PHOTOS_ENABLED,
  shareText = Share.share,
  initialBooking,
}: {
  onClose: () => void;
  language?: Language;
  // Oferta, fecha y cantidades elegidas en el detalle del catálogo: el portal abre con la oferta seleccionada y
  // el turista solo confirma la cotización (se aplica una vez, tras iniciar sesión).
  initialBooking?: { offerId: string; date: string; quantity: number; nights: number } | null;
  // Hoja de compartir del sistema; inyectable en pruebas.
  shareText?: (content: { message: string }) => Promise<unknown>;
  // Solo para pruebas: el gestor de fotos depende del despliegue de offer-media (OFFER_PHOTOS_ENABLED).
  photosEnabled?: boolean;
}) {
  const words = portalCopy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  // Correo pendiente de verificar tras registrarse; muestra el campo del código.
  const [pendingVerification, setPendingVerification] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  // Correo con un código de cambio de contraseña pedido; muestra el código y la contraseña nueva.
  const [pendingReset, setPendingReset] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [role, setRole] = useState<SharedRole | null>(null);
  const [offers, setOffers] = useState<SharedOffer[]>([]);
  const [providers, setProviders] = useState<SharedProvider[]>([]);
  const [reservations, setReservations] = useState<SharedReservation[]>([]);
  const [events, setEvents] = useState<SharedReservationEvent[]>([]);
  const [sweepHealth, setSweepHealth] = useState<SweepHealth | null>(null);
  const [commissionTerms, setCommissionTerms] = useState<CommissionTerm[]>([]);
  const [paymentReviews, setPaymentReviews] = useState<PaymentReview[]>([]);
  const [commissionEdit, setCommissionEdit] = useState<{ offerId: string; value: string } | null>(null);
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
  const [offerDetails, setOfferDetails] = useState(EMPTY_DETAILS);
  const [stock, setStock] = useState('1');
  const [publishNights, setPublishNights] = useState('1');
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | null>(null);
  const [refundTarget, setRefundTarget] = useState<SharedReservation | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  // Panel del proveedor en tres pestañas: lo diario (reservas y check-in) primero.
  const [providerTab, setProviderTab] = useState<ProviderTab>('bookings');
  const [adminArea, setAdminArea] = useState<AdminArea>('bookings');
  const [voucherInput, setVoucherInput] = useState('');
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const bookingApplied = useRef(false);
  // Se incrementa al cambiar los datos de la cotización; una respuesta tardía con otro valor se descarta.
  const quoteRequest = useRef(0);
  // Una clave por reserva e importe: reintentar, descartar o reabrir el formulario reutiliza la misma,
  // así una respuesta perdida no duplica el reembolso. Se libera solo tras recargar con éxito.
  const refundKeys = useRef(new Map<string, string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function describeError(error: unknown): string {
    if (error instanceof ReservationError && error.code) return words.errors[error.code];
    if (error instanceof AuthFlowError) {
      return error.kind === 'unknown' ? `${words.authErrors.unknown} (${error.serverMessage})` : words.authErrors[error.kind];
    }
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
    const pending = nextRole === 'traveler' && !bookingApplied.current ? initialBooking : null;
    const preselected = pending ? visibleOffers.find(offer => offer.id === pending.offerId) : undefined;
    if (pending && preselected) {
      bookingApplied.current = true;
      setSelectedOffer(preselected);
      setDate(pending.date);
      setQuantity(String(pending.quantity));
      setNights(preselected.price_mode === 'night' ? String(pending.nights) : '1');
      setQuote(null);
      listOfferAvailability(preselected.id, buziosIsoDate())
        .then(dates => {
          if (mounted.current) setAvailability(dates);
        })
        .catch(() => undefined);
    }
    setProviders(visibleProviders);
    setEvents(visibleEvents);
    setProviderOffers(ownedOffers);
    setProviderInventory(ownedInventory);
    if (nextRole === 'admin') {
      // La salud del barrido es informativa: si la migración 202611140006 falta, no bloquea el panel.
      // Secciones informativas: si falta una migración opcional, el resto del panel sigue funcionando.
      const [health, terms, reviews] = await Promise.all([
        getSweepHealth().catch(() => null),
        listCommissionTerms().catch(() => []),
        listPaymentReviews().catch(() => []),
      ]);
      if (mounted.current) {
        setSweepHealth(health);
        setCommissionTerms(terms);
        setPaymentReviews(reviews);
      }
    }
  }

  useEffect(() => {
    async function restoreSession() {
      try {
        // Sesión guardada en Keychain/Keystore: se renueva antes de leer el rol.
        const notice = await restoreSharedSession();
        if (!mounted.current) return;
        if (notice === 'expired') setMessage(words.errors.authentication_required);
        else if (notice === 'unavailable') setMessage(words.errors.session_unavailable);
        else if (notice === 'not_persisted') setMessage(words.sessionNotPersisted);
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
      if (!isSharedSessionPersisted()) return words.sessionNotPersisted;
    });
  }

  function signUp() {
    run(async () => {
      await signUpTravelerAccount({ email: email.trim(), password, name: name.trim() });
      setPassword('');
      setPendingVerification(email.trim());
      return words.signUpDone;
    });
  }

  function verify() {
    if (!pendingVerification) return;
    run(async () => {
      const code = verificationCode.trim();
      if (!/^\d{6}$/.test(code)) throw new InputValidationError(words.codeFormat);
      await verifyTravelerEmail(pendingVerification, code);
      const currentRole = await getSharedRole();
      setRole(currentRole);
      if (!currentRole) throw new InputValidationError(words.noProfile);
      setPendingVerification(null);
      setVerificationCode('');
      await loadForRole(currentRole);
      if (!isSharedSessionPersisted()) return words.sessionNotPersisted;
    });
  }

  function resend() {
    if (!pendingVerification) return;
    run(async () => {
      await resendVerificationCode(pendingVerification);
      return words.codeResent;
    });
  }

  function requestReset(target: string) {
    run(async () => {
      await requestPasswordReset(target);
      setPendingVerification(null);
      setPendingReset(target);
      setResetCode('');
      return words.resetSent;
    });
  }

  function changePassword() {
    if (!pendingReset) return;
    run(async () => {
      const code = resetCode.trim();
      if (!/^\d{6}$/.test(code)) throw new InputValidationError(words.codeFormat);
      if (newPassword.length < 8) throw new InputValidationError(words.passwordHint);
      await resetAccountPassword(pendingReset, code, newPassword);
      setPendingReset(null);
      setResetCode('');
      setNewPassword('');
      setPassword('');
      return words.passwordChanged;
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
      const units = valueOf(
        parseCount(quantity, { min: selectedOffer.min_quantity ?? 1, max: selectedOffer.max_quantity ?? MAX_UNITS }),
        words.quantity[selectedOffer.price_mode],
      );
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

  function openRefund(reservation: SharedReservation) {
    const { maxCents } = refundAllowance(reservation);
    setRefundTarget(reservation);
    setRefundAmount(centsToBrlInput(maxCents));
    setRefundReason('');
  }

  function submitRefund() {
    if (!refundTarget) return;
    run(async () => {
      const amountCents = valueOf(parseBrlToCents(refundAmount), words.refundAmount);
      const reason = refundReason.trim();
      if (!reason) throw new InputValidationError(words.refundReasonRequired);
      const keyId = `${refundTarget.id}:${amountCents}`;
      const idempotencyKey = refundKeys.current.get(keyId) ?? newIdempotencyKey();
      refundKeys.current.set(keyId, idempotencyKey);
      await recordSharedRefund({ reservationId: refundTarget.id, amountCents, reason, idempotencyKey });
      setRefundTarget(null);
      if (role) await loadForRole(role);
      // Con la lista ya actualizada, otro reembolso del mismo importe es una solicitud nueva.
      refundKeys.current.delete(keyId);
      return words.refundRecorded;
    });
  }

  function saveOfferCommission() {
    if (!commissionEdit) return;
    run(async () => {
      const rateBps = valueOf(parsePercentToBps(commissionEdit.value), words.commissionRateLabel);
      await setOfferCommission(commissionEdit.offerId, rateBps);
      setCommissionEdit(null);
      if (role) await loadForRole(role);
      return words.commissionSaved;
    });
  }

  function toggleProvider(provider: SharedProvider) {
    run(async () => {
      await setSharedProviderActive(provider.id, !provider.active);
      if (role) await loadForRole(role);
      return words.providerUpdated;
    });
  }

  function editProviderOffer(offer: SharedOffer) {
    setSelectedProviderOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferPrice(centsToBrlInput(offer.base_price_cents));
    setOfferCategory(offer.category);
    setOfferPriceMode(offer.price_mode);
    setOfferDetails({
      description: offer.description ?? '',
      location: offer.location ?? '',
      meetingPoint: offer.meeting_point ?? '',
      schedule: offer.schedule ?? '',
      minQuantity: String(offer.min_quantity ?? 1),
      maxQuantity: offer.max_quantity ? String(offer.max_quantity) : '',
    });
  }

  function startNewOffer() {
    setSelectedProviderOfferId(null);
    setOfferTitle(DEFAULT_OFFER.title);
    setOfferPrice(DEFAULT_OFFER.price);
    setOfferCategory('pousadas');
    setOfferPriceMode('night');
    setOfferDetails(EMPTY_DETAILS);
  }

  function saveOffer() {
    run(async () => {
      const title = offerTitle.trim();
      if (!title) throw new InputValidationError(words.errors.invalid_offer);
      const basePriceCents = valueOf(parseBrlToCents(offerPrice), words.priceBrl);
      const serviceDate = valueOf(parseIsoDate(date, buziosIsoDate()), words.date);
      const totalUnits = valueOf(parseCount(stock, { min: 0, max: MAX_UNITS }), words.units);
      // Todo se valida antes de la primera llamada para no dejar una oferta guardada a medias.
      const minQuantity = valueOf(parseCount(offerDetails.minQuantity, { max: MAX_UNITS }), words.minQuantity);
      const maxQuantity = offerDetails.maxQuantity.trim()
        ? valueOf(parseCount(offerDetails.maxQuantity, { min: minQuantity, max: MAX_UNITS }), words.maxQuantity)
        : null;
      const nightsToPublish = valueOf(parseCount(publishNights, { max: MAX_PUBLISH_NIGHTS }), words.publishNights);
      const offerFields = { category: offerCategory, title, basePriceCents, priceMode: offerPriceMode };
      // Una oferta nueva se crea sin publicar y solo se publica cuando ya tiene detalle y cupo: si algo
      // falla a mitad, no queda a la venta incompleta y el reintento actualiza esa misma oferta.
      const isNew = !selectedProviderOfferId;
      const offer = await upsertProviderOffer({
        ...offerFields,
        offerId: selectedProviderOfferId ?? undefined,
        published: !isNew,
      });
      setSelectedProviderOfferId(offer.id);
      await setProviderOfferDetails({
        offerId: offer.id,
        description: offerDetails.description.trim(),
        location: offerDetails.location.trim(),
        meetingPoint: offerDetails.meetingPoint.trim(),
        schedule: offerDetails.schedule.trim(),
        minQuantity,
        maxQuantity,
      });
      if (nightsToPublish === 1) {
        await publishProviderInventory({ offerId: offer.id, serviceDate, totalUnits });
      } else {
        await publishProviderInventoryRange({ offerId: offer.id, fromDate: serviceDate, nights: nightsToPublish, totalUnits });
      }
      if (isNew) await upsertProviderOffer({ ...offerFields, offerId: offer.id, published: true });
      if (role) await loadForRole(role);
      return words.offerSaved;
    });
  }

  const offerTitles = new Map([...offers, ...providerOffers].map(offer => [offer.id, offer.title]));
  const visibleReservations = statusFilter
    ? reservations.filter(reservation => reservation.status === statusFilter)
    : reservations;
  const totals = summarizeReservations(visibleReservations);
  const inconsistencies = role === 'admin' ? findInconsistencies(reservations) : [];
  const perNight = selectedOffer?.price_mode === 'night';
  const parsedNights = Number(nights);
  const checkOut =
    perNight && parseIsoDate(date, '0000-01-01').ok && Number.isInteger(parsedNights) && parsedNights > 0
      ? addDays(date.trim(), parsedNights)
      : null;

  function shareVoucher(reservation: SharedReservation) {
    const text = voucherShareText(reservation, offerTitles.get(reservation.offer_id) ?? '', language);
    if (text) shareText({ message: text }).catch(() => undefined);
  }

  function checkIn() {
    run(async () => {
      const result = await providerCheckIn(voucherInput);
      setCheckInResult(result);
      if (result.status === 'checked_in') setVoucherInput('');
      await loadForRole('provider');
      return words.vouchers.results[result.status];
    });
  }

  const reservationList = (reason: CancelReason, list = reservations) => (
    <ReservationList
      reservations={list}
      offerTitles={offerTitles}
      words={words}
      onCancel={id => cancel(id, reason)}
      // Solo el turista paga; el backend rechaza pagos de reservas ajenas.
      onPay={role === 'traveler' ? pay : undefined}
      onRefund={role === 'admin' ? openRefund : undefined}
      onShare={role === 'traveler' ? shareVoucher : undefined}
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
      {words.translationNotice ? <Text style={styles.warning}>{words.translationNotice}</Text> : null}
      {!role ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{words.accountAccess}</Text>
          <TextInput value={name} onChangeText={setName} placeholder={words.name} accessibilityLabel={words.name} placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={words.email} accessibilityLabel={words.email} placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder={words.password} accessibilityLabel={words.password} placeholderTextColor={colors.muted} style={styles.input} />
          <ActionButton title={words.signIn} onPress={signIn} disabled={busy || !email.trim() || !password} />
          <ActionButton title={words.signUp} onPress={signUp} disabled={busy || !name.trim() || !email.trim() || password.length < 8} secondary />
          {password && password.length < 8 ? <Text style={styles.helper}>{words.passwordHint}</Text> : null}
          <Pressable onPress={() => requestReset(email.trim())} disabled={busy || !email.trim()} accessibilityRole="button" accessibilityState={{ disabled: busy || !email.trim() }}>
            <Text style={styles.link}>{words.forgotPassword}</Text>
          </Pressable>
          {pendingReset ? (
            <View style={styles.quote}>
              <Text style={styles.helper}>{pendingReset}</Text>
              <TextInput value={resetCode} onChangeText={setResetCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" placeholder={words.verificationCode} accessibilityLabel={words.verificationCode} placeholderTextColor={colors.muted} style={styles.input} />
              <TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry autoComplete="new-password" placeholder={words.newPassword} accessibilityLabel={words.newPassword} placeholderTextColor={colors.muted} style={styles.input} />
              <ActionButton title={words.changePassword} onPress={changePassword} disabled={busy} />
              <ActionButton title={words.resendCode} onPress={() => requestReset(pendingReset)} disabled={busy} secondary />
            </View>
          ) : null}
          {pendingVerification ? (
            <View style={styles.quote}>
              <Text style={styles.helper}>{pendingVerification}</Text>
              <TextInput value={verificationCode} onChangeText={setVerificationCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" placeholder={words.verificationCode} accessibilityLabel={words.verificationCode} placeholderTextColor={colors.muted} style={styles.input} />
              <ActionButton title={words.verifyEmail} onPress={verify} disabled={busy} />
              <ActionButton title={words.resendCode} onPress={resend} disabled={busy} secondary />
            </View>
          ) : null}
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
                  {selectedOffer.description ? <Text style={styles.helper}>{selectedOffer.description}</Text> : null}
                  {[selectedOffer.location, selectedOffer.meeting_point, selectedOffer.schedule].some(Boolean) ? (
                    <Text style={styles.helper}>{[selectedOffer.location, selectedOffer.meeting_point, selectedOffer.schedule].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  {(selectedOffer.min_quantity ?? 1) > 1 || selectedOffer.max_quantity ? (
                    <Text style={styles.helper}>
                      {words.quantityLimits
                        .replace('{min}', String(selectedOffer.min_quantity ?? 1))
                        .replace('{max}', String(selectedOffer.max_quantity ?? MAX_UNITS))}
                    </Text>
                  ) : null}
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
                      {quote.discount_cents ? (
                        <>
                          <MoneyRow label={words.promotions.listPrice} cents={quote.list_subtotal_cents ?? quote.subtotal_cents + quote.discount_cents} />
                          <MoneyRow label={words.promotions.discount} cents={-quote.discount_cents} />
                        </>
                      ) : null}
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
              <TravelerAgenda reservations={reservations} offerTitles={offerTitles} today={buziosIsoDate()} language={language} />
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{words.myReservations}</Text>
                {reservationList('traveler_request')}
              </View>
            </>
          ) : null}
          {role === 'provider' ? (
            <View style={styles.section}>
              <View style={styles.chips}>
                {PROVIDER_TABS.map(tab => (
                  <Chip key={tab} label={words.providerTabs[tab]} selected={providerTab === tab} onPress={() => setProviderTab(tab)} />
                ))}
              </View>
              {providerTab === 'bookings' ? (
                <>
                  <Text style={styles.sectionTitle}>{words.vouchers.checkInTitle}</Text>
                  <Text style={styles.helper}>{words.vouchers.checkInHint}</Text>
                  <Field label={words.vouchers.checkInCode} value={voucherInput} onChange={setVoucherInput} maxLength={20} />
                  <ActionButton title={words.vouchers.checkInButton} onPress={checkIn} disabled={busy || !voucherInput.trim()} />
                  {checkInResult?.reservation ? (
                    <Text style={styles.helper}>
                      {offerTitles.get(checkInResult.reservation.offer_id) ?? checkInResult.reservation.offer_id} · {checkInResult.reservation.service_date} · ×{checkInResult.reservation.quantity}
                    </Text>
                  ) : null}
                  <Text style={styles.sectionTitle}>{words.receivedReservations}</Text>
                  {reservationList('provider_cancelled')}
                </>
              ) : null}
              {providerTab === 'offers' ? (
                <>
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
                  <Field label={words.offerDescription} value={offerDetails.description} onChange={description => setOfferDetails({ ...offerDetails, description })} maxLength={MAX_DESCRIPTION_LENGTH} multiline />
                  <Field label={words.offerLocation} value={offerDetails.location} onChange={location => setOfferDetails({ ...offerDetails, location })} maxLength={MAX_DETAIL_LENGTH} />
                  <Field label={words.offerMeetingPoint} value={offerDetails.meetingPoint} onChange={meetingPoint => setOfferDetails({ ...offerDetails, meetingPoint })} maxLength={MAX_DETAIL_LENGTH} />
                  <Field label={words.offerSchedule} value={offerDetails.schedule} onChange={schedule => setOfferDetails({ ...offerDetails, schedule })} maxLength={MAX_DETAIL_LENGTH} />
                  <Field label={words.minQuantity} value={offerDetails.minQuantity} onChange={minQuantity => setOfferDetails({ ...offerDetails, minQuantity })} numeric />
                  <Field label={words.maxQuantity} value={offerDetails.maxQuantity} onChange={maxQuantity => setOfferDetails({ ...offerDetails, maxQuantity })} numeric />
                  <Text style={styles.helper}>{words.offerDetailsHint}</Text>
                  <Field label={words.date} value={date} onChange={setDate} />
                  <Field label={words.units} value={stock} onChange={setStock} numeric />
                  <Field label={words.publishNights} value={publishNights} onChange={setPublishNights} numeric />
                  <Text style={styles.helper}>{words.publishNightsHint}</Text>
                  <ActionButton title={selectedProviderOfferId ? words.saveOffer : words.publishOffer} onPress={saveOffer} disabled={busy} />
                  <PostManager
                    offerId={selectedProviderOfferId}
                    language={language}
                    load={listOwnPosts}
                    save={saveOwnPost}
                    remove={deleteOwnPost}
                    describeError={describeError}
                  />
                  <PromotionManager
                    offerId={selectedProviderOfferId}
                    language={language}
                    today={buziosIsoDate()}
                    load={listProviderPromotions}
                    save={saveProviderPromotion}
                    describeError={describeError}
                  />
                  {photosEnabled && offerPhotoGateway ? (
                    <OfferPhotoManager
                      offerId={selectedProviderOfferId}
                      language={language}
                      gateway={offerPhotoGateway}
                      loadMedia={loadOfferMedia}
                      getAccessToken={currentAccessToken}
                    />
                  ) : null}
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
                </>
              ) : null}
              {providerTab === 'business' ? (
                <>
                  <Text style={styles.sectionTitle}>{words.providerEarnings}</Text>
                  <Text style={styles.helper}>{words.providerNetTotal}: {brlFromCents(totals.providerNetCents)}</Text>
                  <Text style={styles.helper}>{words.providerCommissionTotal}: {brlFromCents(totals.commissionCents)}</Text>
                  <Text style={styles.helper}>{words.heldTotal}: {brlFromCents(totals.heldAmountCents)}</Text>
                  <Text style={styles.helper}>{words.providerEarningsHint}</Text>
                  <ProviderProfileForm language={language} load={getOwnProviderProfile} save={updateOwnProviderProfile} run={run} busy={busy} />
                  <ProviderStats language={language} today={buziosIsoDate()} load={getProviderStats} run={run} busy={busy} />
                </>
              ) : null}
            </View>
          ) : null}
          {role === 'admin' ? (
            <>
              <View style={styles.chips}>
                {ADMIN_AREAS.map(area => (
                  <Chip key={area} label={words.adminAreas[area]} selected={adminArea === area} onPress={() => setAdminArea(area)} />
                ))}
              </View>
              {adminArea === 'providers' ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{words.providers} · {providers.length}</Text>
                    {providers.map(provider => (
                      <View key={provider.id} style={styles.row}>
                        <View style={styles.flex}>
                          <Text style={styles.offerName}>{provider.name}</Text>
                          <Text style={styles.helper}>{provider.commission_rate_bps / 100}% · {provider.active ? words.active : words.paused}</Text>
                        </View>
                        <Pressable
                          onPress={() => toggleProvider(provider)}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityLabel={`${provider.active ? words.pauseProvider : words.resumeProvider} ${provider.name}`}
                        >
                          <Text style={styles.link}>{provider.active ? words.pauseProvider : words.resumeProvider}</Text>
                        </Pressable>
                      </View>
                    ))}
                    {providers.length ? <Text style={styles.helper}>{words.pauseHint}</Text> : null}
                  </View>
                  <AdminConsole key="providers" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.providers} />
                </>
              ) : null}
              {adminArea === 'catalog' ? (
                <>
                  <AdminConsole key="catalog" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.catalog} />
                </>
              ) : null}
              {adminArea === 'bookings' ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{words.reservations} · {visibleReservations.length}</Text>
                    <Text style={styles.helper}>
                      {words.statusCounts
                        .replace('{held}', String(totals.heldCount))
                        .replace('{confirmed}', String(totals.confirmedCount))
                        .replace('{cancelled}', String(totals.cancelledCount))
                        .replace('{refunded}', String(totals.refundedCount))}
                    </Text>
                    <Text style={styles.helper}>{words.heldTotal}: {brlFromCents(totals.heldAmountCents)}</Text>
                    <Text style={styles.helper}>{words.confirmedGross}: {brlFromCents(totals.confirmedGrossCents)}</Text>
                    <Text style={styles.helper}>{words.providerNetTotal}: {brlFromCents(totals.providerNetCents)}</Text>
                    <Text style={styles.helper}>{words.commissionTotal}: {brlFromCents(totals.commissionCents)}</Text>
                    <Text style={styles.helper}>{words.feeTotal}: {brlFromCents(totals.connecticalFeeCents)}</Text>
                    <Text style={styles.helper}>{words.collectedTotal}: {brlFromCents(totals.collectedCents)} · {words.refundedTotal}: {brlFromCents(totals.refundedCents)}</Text>
                    <Text style={styles.helper}>{words.netCollected}: {brlFromCents(totals.netCollectedCents)}</Text>
                    {inconsistencies.length ? (
                      <View style={styles.warning}>
                        <Text style={styles.offerName}>{words.inconsistencyTitle.replace('{count}', String(inconsistencies.length))}</Text>
                        {inconsistencies.map(item => (
                          <Text key={`${item.id}:${item.code}`} selectable style={styles.helper}>{words.inconsistencies[item.code]} · {item.id}</Text>
                        ))}
                      </View>
                    ) : null}
                    {totals.pendingRefundReviewCount ? (
                      <Text style={styles.warning}>{words.pendingRefundReview.replace('{count}', String(totals.pendingRefundReviewCount))}</Text>
                    ) : null}
                    <View style={styles.chips}>
                      <Chip label={words.allStatuses} selected={statusFilter === null} onPress={() => setStatusFilter(null)} />
                      {STATUSES.map(status => (
                        <Chip key={status} label={words.status[status]} selected={statusFilter === status} onPress={() => setStatusFilter(status)} />
                      ))}
                    </View>
                    {refundTarget ? (
                      <View style={styles.quote}>
                        <Text style={styles.sectionTitle}>{words.refundTitle}</Text>
                        <Text style={styles.helper}>{brlFromCents(refundTarget.amount_cents)} · {refundTarget.id}</Text>
                        <Text style={styles.helper}>{words.refundMax}: {brlFromCents(refundAllowance(refundTarget).maxCents)}</Text>
                        {refundAllowance(refundTarget).fullRequiresCancellation ? (
                          <Text style={styles.helper}>{words.refundFullNeedsCancel}</Text>
                        ) : null}
                        <Field label={words.refundAmount} value={refundAmount} onChange={setRefundAmount} decimal />
                        <Field label={words.refundReason} value={refundReason} onChange={setRefundReason} maxLength={MAX_REFUND_REASON_LENGTH} />
                        <Text style={styles.helper}>{words.refundReasonVisible}</Text>
                        <ActionButton title={words.refundSubmit} onPress={submitRefund} disabled={busy} />
                        <ActionButton title={words.refundDiscard} onPress={() => setRefundTarget(null)} disabled={busy} secondary />
                      </View>
                    ) : null}
                    {reservationList('admin_review', visibleReservations)}
                  </View>
                  {paymentReviews.length ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{words.paymentReviews} · {paymentReviews.length}</Text>
                      <Text style={styles.warning}>{words.paymentReviewHint}</Text>
                      {paymentReviews.map(review => (
                        <View key={review.id} style={styles.eventRow}>
                          <Text style={styles.offerName}>{words.paymentReviewOutcomes[review.outcome] ?? review.outcome} · {brlFromCents(review.amount_cents)} {review.currency}</Text>
                          <Text selectable style={styles.helper}>{review.gateway} · {review.event_id} · {review.reservation_id ?? '—'} · {review.received_at}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
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
                  <AdminConsole key="bookings" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.bookings} />
                </>
              ) : null}
              {adminArea === 'content' ? (
                <>
                  <AdminConsole key="content" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.content} />
                </>
              ) : null}
              {adminArea === 'finance' ? (
                <>
                  {commissionTerms.length ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{words.commissionTerms}</Text>
                      <Text style={styles.helper}>{words.commissionTermsHint}</Text>
                      {commissionTerms.map(term => (
                        <View key={term.offer_id} style={styles.row}>
                          <View style={styles.flex}>
                            <Text style={styles.offerName}>{term.offer_title} · {term.provider_name}</Text>
                            <Text style={styles.helper}>
                              {words.categories[term.category]} · {words.commissionEffective.replace('{rate}', formatBps(term.effective_rate_bps))}
                              {term.offer_rate_bps !== null ? ` · ${words.commissionOverride}` : ''}
                            </Text>
                            <Text style={term.outside_reference ? styles.warning : styles.helper}>
                              {term.reference_min_bps === null
                                ? words.commissionNoReference
                                : words.commissionReference
                                    .replace('{range}', term.reference_max_bps !== null && term.reference_max_bps !== term.reference_min_bps
                                      ? `${formatBps(term.reference_min_bps)}–${formatBps(term.reference_max_bps)}`
                                      : formatBps(term.reference_min_bps))
                                    .replace('{status}', words.commissionStatus[term.reference_status])}
                              {term.outside_reference ? ` · ${words.commissionOutside}` : ''}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => setCommissionEdit({ offerId: term.offer_id, value: term.offer_rate_bps === null ? '' : formatBps(term.offer_rate_bps).replace(' %', '') })}
                            disabled={busy}
                            accessibilityRole="button"
                            accessibilityLabel={`${words.commissionEdit} ${term.offer_title}`}
                          >
                            <Text style={styles.link}>{words.commissionEdit}</Text>
                          </Pressable>
                        </View>
                      ))}
                      {commissionEdit ? (
                        <View style={styles.quote}>
                          <Field label={words.commissionRateLabel} value={commissionEdit.value} onChange={value => setCommissionEdit({ ...commissionEdit, value })} decimal />
                          <ActionButton title={words.commissionSave} onPress={saveOfferCommission} disabled={busy} />
                          <ActionButton title={words.refundDiscard} onPress={() => setCommissionEdit(null)} disabled={busy} secondary />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <AdminConsole key="finance" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.finance} />
                </>
              ) : null}
              {adminArea === 'settings' ? (
                <>
                  {sweepHealth ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{words.sweepTitle}</Text>
                      <Text style={sweepHealth.last_success_at ? styles.helper : styles.warning}>
                        {sweepHealth.last_success_at
                          ? words.sweepLast.replace('{time}', formatTime(sweepHealth.last_success_at))
                          : words.sweepNever}
                      </Text>
                      {sweepHealth.stale && sweepHealth.last_success_at ? <Text style={styles.warning}>{words.sweepStale}</Text> : null}
                      {sweepHealth.partial_runs_last_hour ? (
                        <Text style={styles.warning}>{words.sweepPartial.replace('{count}', String(sweepHealth.partial_runs_last_hour))}</Text>
                      ) : null}
                      <Text style={styles.helper}>{words.sweepOverdue.replace('{count}', String(sweepHealth.overdue_holds))}</Text>
                    </View>
                  ) : null}
                  <AdminConsole key="settings" language={language} busy={busy} run={run} providers={providers} sections={ADMIN_AREA_SECTIONS.settings} />
                </>
              ) : null}
            </>
          ) : null}
          {role === 'traveler' || role === 'provider' ? (
            <TravelerServices language={language} role={role} reservations={reservations} busy={busy} run={run} />
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
  onRefund,
  onShare,
  disabled,
}: {
  reservations: SharedReservation[];
  offerTitles: Map<string, string>;
  words: PortalWords;
  onCancel: (id: string) => void;
  onPay?: (id: string) => void;
  onRefund?: (reservation: SharedReservation) => void;
  onShare?: (reservation: SharedReservation) => void;
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
          {reservation.provider_commission_cents !== null ? (
            <>
              <Text style={styles.helper}>{words.providerNet}: {brlFromCents(reservation.amount_cents - reservation.service_fee_cents - reservation.provider_commission_cents)}</Text>
              <Text style={styles.helper}>{words.travelerFee} {reservation.service_fee_rate_bps / 100}% · {brlFromCents(reservation.service_fee_cents)} · {words.providerCommission} {brlFromCents(reservation.provider_commission_cents)} · {words.connecticalIncome} {brlFromCents(reservation.connectical_margin_cents)}</Text>
            </>
          ) : (
            // El turista ve lo que pagó; la comisión entre proveedor y plataforma no le corresponde.
            <Text style={styles.helper}>{words.travelerFee} {reservation.service_fee_rate_bps / 100}% · {brlFromCents(reservation.service_fee_cents)}</Text>
          )}
          {reservation.refund_cents > 0 ? (
            <Text style={styles.helper}>{brlFromCents(reservation.refund_cents)} {words.refundedSoFar}</Text>
          ) : null}
          {awaitingPayment && reservation.hold_expires_at ? (
            <Text style={styles.helper}>
              {words.holdExpires}: {formatTime(reservation.hold_expires_at)} ·{' '}
              {minutesUntil(reservation.hold_expires_at) === 0
                ? words.holdLapsed
                : words.holdMinutesLeft.replace('{n}', String(minutesUntil(reservation.hold_expires_at)))}
            </Text>
          ) : null}
          {reservation.voucher_code ? (
            <Text selectable style={styles.offerName}>{words.vouchers.code}: {reservation.voucher_code}</Text>
          ) : null}
          {reservation.checked_in_at ? (
            <Text style={styles.helper}>{words.vouchers.checkedIn} · {formatTime(reservation.checked_in_at)}</Text>
          ) : null}
          <Text selectable style={styles.id}>{reservation.id}</Text>
        </View>
        <View>
          {onShare && reservation.voucher_code && reservation.status === 'confirmed' ? (
            <Pressable onPress={() => onShare(reservation)} accessibilityRole="button" accessibilityLabel={`${words.vouchers.share} ${reservation.voucher_code}`}>
              <Text style={styles.link}>{words.vouchers.share}</Text>
            </Pressable>
          ) : null}
          {awaitingPayment && onPay ? (
            <Pressable onPress={() => onPay(reservation.id)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${words.payNow} ${reservation.id}`}>
              <Text style={styles.link}>{words.payNow}</Text>
            </Pressable>
          ) : null}
          {onRefund && refundAllowance(reservation).maxCents > 0 ? (
            <Pressable onPress={() => onRefund(reservation)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${words.refund} ${reservation.id}`}>
              <Text style={styles.link}>{words.refund}</Text>
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

const styles = portalStyles;
