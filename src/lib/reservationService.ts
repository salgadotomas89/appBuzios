import {
  portalCopy,
  type PortalCategory,
  type PortalPriceMode,
  type ReservationErrorCode,
  type ReservationStatus,
} from '../i18n/portalCopy';
import { toAuthFlowError } from '../auth/authErrors';
import { SessionError } from '../auth/sessionManager';
import { insforge, sessionManager } from './insforge';

export type SharedRole = 'traveler' | 'provider' | 'admin';
export type SharedReservation = {
  id: string;
  quote_id: string;
  offer_id: string;
  provider_id: string;
  service_date: string;
  // Columna de la migración 202611140001; la app requiere todas las migraciones aplicadas.
  nights?: number;
  quantity: number;
  status: ReservationStatus;
  hold_expires_at: string | null;
  payment_status: 'approved' | 'rejected' | 'pending' | 'requires_action' | null;
  payment_method: 'card' | 'pix' | null;
  amount_cents: number;
  service_fee_rate_bps: 400 | 600 | 800;
  service_fee_cents: number;
  // Nulos para el turista: la comisión solo la ven el proveedor dueño y la administración.
  provider_commission_rate_bps: number | null;
  provider_commission_cents: number | null;
  connectical_margin_cents: number;
  refund_cents: number;
  quote_version: string;
  created_at: string;
  updated_at: string;
};

export type SharedQuote = {
  id: string;
  offer_id: string;
  service_date: string;
  quantity: number;
  nights: number;
  service_fee_rate_bps: 400 | 600 | 800;
  subtotal_cents: number;
  service_fee_cents: number;
  traveler_total_cents: number;
  // Nulos en la respuesta al turista (migración 202611140010).
  provider_commission_rate_bps: number | null;
  provider_commission_cents: number | null;
  quote_version: string;
  expires_at: string;
};

export type SharedReservationEvent = {
  id: number;
  reservation_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type SharedOffer = {
  id: string;
  provider_id: string;
  category: PortalCategory;
  title: string;
  base_price_cents: number;
  price_mode: PortalPriceMode;
  currency: 'BRL';
  published: boolean;
  // Detalle de la migración 202611140009; vacío si el proveedor no lo cargó.
  description?: string;
  location?: string;
  meeting_point?: string;
  schedule?: string;
  min_quantity?: number;
  max_quantity?: number | null;
};

export const OFFER_COLUMNS =
  'id, provider_id, category, title, base_price_cents, price_mode, currency, published, ' +
  'description, location, meeting_point, schedule, min_quantity, max_quantity';

export type SharedProvider = {
  id: string;
  name: string;
  country_code: string;
  commission_rate_bps: number;
  active: boolean;
};

export type SharedInventory = {
  offer_id: string;
  service_date: string;
  total_units: number;
  held_units: number;
  sold_units: number;
  version: number;
  updated_at: string;
};

function getClient() {
  if (!insforge) {
    throw new Error('InsForge no está configurado. No se puede acceder a reservas compartidas.');
  }
  return insforge;
}

// En el flujo móvil el SDK no renueva el token solo: se renueva antes de cada petición autenticada.
// Exportada para los demás servicios del portal.
export async function freshClient() {
  const client = getClient();
  try {
    await sessionManager?.ensureFresh();
  } catch (error) {
    throw toSessionReservationError(error);
  }
  return client;
}

function toSessionReservationError(error: unknown): Error {
  if (error instanceof SessionError && error.code === 'session_expired') {
    return new ReservationError(RESERVATION_ERROR_MESSAGES.authentication_required, 'authentication_required');
  }
  if (error instanceof SessionError && error.code === 'session_unavailable') {
    return new ReservationError(RESERVATION_ERROR_MESSAGES.session_unavailable, 'session_unavailable');
  }
  return error instanceof Error ? error : new Error(String(error));
}

// Códigos que las funciones SQL lanzan con `raise exception`; el texto por
// defecto es español y la pantalla puede traducirlo con `code`.
const RESERVATION_ERROR_MESSAGES = portalCopy.es.errors;

export class ReservationError extends Error {
  constructor(message: string, readonly code: ReservationErrorCode | null) {
    super(message);
    this.name = 'ReservationError';
  }
}

export function toReservationError(operation: string, rawMessage: string): ReservationError {
  const code = (Object.keys(RESERVATION_ERROR_MESSAGES) as ReservationErrorCode[]).find(key =>
    new RegExp(`\\b${key}\\b`).test(rawMessage),
  );
  if (code) return new ReservationError(RESERVATION_ERROR_MESSAGES[code], code);
  return new ReservationError(`InsForge ${operation}: ${rawMessage}`, null);
}

// Exportada para los demás servicios del portal: renueva la sesión y traduce los códigos de error SQL.
export async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await freshClient()).database.rpc(name, args);
  if (error) throw toReservationError(name, error.message);
  if (data === null) throw new Error(`InsForge ${name}: respuesta vacía`);
  return data as T;
}

export async function createSharedQuote(input: {
  offerId: string;
  serviceDate: string;
  quantity: number;
  nights: number;
  serviceFeeRateBps: number;
}): Promise<SharedQuote> {
  return callRpc('connectical_create_quote', {
    p_offer_id: input.offerId,
    p_service_date: input.serviceDate,
    p_quantity: input.quantity,
    p_nights: input.nights,
    p_service_fee_rate_bps: input.serviceFeeRateBps,
  });
}

export async function createSharedReservationHold(
  quoteId: string,
  idempotencyKey: string,
): Promise<SharedReservation> {
  return callRpc('connectical_create_reservation_hold', {
    p_quote_id: quoteId,
    p_idempotency_key: idempotencyKey,
  });
}

export async function simulateSharedPayment(
  reservationId: string,
  outcome: 'approved' | 'rejected' | 'pending' | 'requires_action',
  method: 'card' | 'pix',
): Promise<SharedReservation> {
  return callRpc('connectical_simulate_payment', {
    p_reservation_id: reservationId,
    p_outcome: outcome,
    p_method: method,
    p_reference: `lab-${reservationId}`,
  });
}

export async function cancelSharedReservation(
  reservationId: string,
  reason: string,
): Promise<SharedReservation> {
  return callRpc('connectical_cancel_reservation', {
    p_reservation_id: reservationId,
    p_reason: reason,
  });
}

// Solo administración. Registra un importe ya decidido; la base de datos no aplica política
// comercial, solo impide superar lo cobrado y duplicar la misma solicitud.
export async function recordSharedRefund(input: {
  reservationId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<SharedReservation> {
  return callRpc('connectical_admin_record_refund', {
    p_reservation_id: input.reservationId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
}

export type SessionNotice = 'expired' | 'unavailable' | 'not_persisted' | null;

// Al abrir el portal: restaura la sesión guardada en el dispositivo, si existe.
export async function restoreSharedSession(): Promise<SessionNotice> {
  getClient();
  if (!sessionManager) return null;
  const result = await sessionManager.restore();
  if (result === 'expired') return 'expired';
  if (result === 'unavailable') return 'unavailable';
  const state = sessionManager.getState();
  return state.status === 'signed_in' && !state.persisted ? 'not_persisted' : null;
}

export function isSharedSessionPersisted(): boolean {
  const state = sessionManager?.getState();
  return state?.status === 'signed_in' && state.persisted;
}

export async function getSharedRole(): Promise<SharedRole | null> {
  getClient();
  // En el flujo móvil getCurrentUser del SDK no conoce al usuario: lo aporta el gestor de sesión.
  const state = sessionManager?.getState();
  if (state?.status !== 'signed_in') return null;
  // InsForge no permite triggers sobre auth.users: el primer inicio de sesión crea aquí el perfil de turista
  // (con el nombre de auth.users.profile) y siempre devuelve el rol actual.
  const role = await callRpc<string | null>('connectical_ensure_profile', {}).catch(error => {
    throw error instanceof ReservationError ? error : new Error(`InsForge perfil: ${error instanceof Error ? error.message : String(error)}`);
  });
  return role === 'traveler' || role === 'provider' || role === 'admin' ? role : null;
}

export async function signInSharedAccount(email: string, password: string): Promise<void> {
  getClient();
  if (!sessionManager) throw new Error('InsForge no está configurado.');
  try {
    await sessionManager.signIn(email, password);
  } catch (error) {
    if (error instanceof SessionError && error.status !== undefined) throw toAuthFlowError('sign_in', { message: error.message, statusCode: error.status });
    throw new Error(`No se pudo iniciar sesión: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function signUpTravelerAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<void> {
  const { data, error } = await getClient().auth.signUp({
    email: input.email,
    password: input.password,
    name: input.name,
  });
  if (error) throw toAuthFlowError('sign_up', error);
  if (!data) throw new Error('InsForge no devolvio una respuesta de registro.');
  // Si el registro devolvió una sesión, el SDK la dejó activa sin pasar por el gestor: se descarta
  // para que la persistencia empiece en un inicio de sesión explícito.
  if ((data as { accessToken?: string | null }).accessToken) await getClient().auth.signOut();
}

// El tenant de ensayo exige verificar el correo con un código de 6 dígitos (verifyEmailMethod = code).
// Verificar inicia la sesión y la guarda en el almacenamiento seguro, igual que una contraseña.
export async function verifyTravelerEmail(email: string, code: string): Promise<void> {
  getClient();
  if (!sessionManager) throw new Error('InsForge no está configurado.');
  try {
    await sessionManager.verifyEmail(email, code);
  } catch (error) {
    if (error instanceof SessionError && error.status !== undefined) throw toAuthFlowError('verify', { message: error.message, statusCode: error.status });
    throw new Error(`No se pudo verificar el correo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function resendVerificationCode(email: string): Promise<void> {
  const { error } = await getClient().auth.resendVerificationEmail({ email });
  if (error) throw toAuthFlowError('resend', error);
}

// Borra la sesión del dispositivo aunque el servidor no responda.
export async function signOutSharedAccount(): Promise<void> {
  getClient();
  try {
    await sessionManager?.signOut();
  } catch (error) {
    if (error instanceof SessionError && error.code === 'sign_out_incomplete') {
      throw new ReservationError(RESERVATION_ERROR_MESSAGES.sign_out_incomplete, 'sign_out_incomplete');
    }
    throw error;
  }
}

// Columnas que la migración 202611140005 permite leer al rol authenticated. `select('*')` fallaría:
// los identificadores de Auth (autor de cada evento) no salen de la base de datos.
export const RESERVATION_EVENT_COLUMNS = 'id, reservation_id, event_type, details, created_at';

export async function listSharedReservations(): Promise<SharedReservation[]> {
  await callRpc<number>('connectical_expire_holds', {});
  // RPC redactado: cada lector recibe solo lo suyo (sin comisión para el turista, sin uuid del turista
  // para el proveedor). La lectura directa de la tabla ya no expone la comisión.
  const { data, error } = await (await freshClient()).database.rpc('connectical_list_reservations', {});
  if (error) throw new Error(`No se pudieron leer reservas: ${error.message}`);
  return (data ?? []) as SharedReservation[];
}

export async function listSharedProviders(): Promise<SharedProvider[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_providers')
    .select('id, name, country_code, commission_rate_bps, active');
  if (error) throw new Error(`No se pudieron leer proveedores: ${error.message}`);
  return (data ?? []) as SharedProvider[];
}

export async function listSharedReservationEvents(): Promise<SharedReservationEvent[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_reservation_events')
    .select(RESERVATION_EVENT_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return (data ?? []) as unknown as SharedReservationEvent[];
}

export async function listSharedOffers(): Promise<SharedOffer[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_offers')
    .select(OFFER_COLUMNS)
    .eq('published', true);
  if (error) throw new Error(`No se pudieron leer ofertas: ${error.message}`);
  return (data ?? []) as unknown as SharedOffer[];
}

export async function listProviderOffers(): Promise<SharedOffer[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_offers')
    .select(OFFER_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron leer ofertas del proveedor: ${error.message}`);
  return (data ?? []) as unknown as SharedOffer[];
}

export async function listProviderInventory(): Promise<SharedInventory[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_inventory')
    .select('offer_id, service_date, total_units, held_units, sold_units, version, updated_at')
    .order('service_date', { ascending: true });
  if (error) throw new Error(`No se pudo leer disponibilidad: ${error.message}`);
  return (data ?? []) as SharedInventory[];
}

export async function upsertProviderOffer(input: {
  offerId?: string;
  category: PortalCategory;
  title: string;
  basePriceCents: number;
  priceMode: PortalPriceMode;
  published: boolean;
}): Promise<SharedOffer> {
  return callRpc('connectical_provider_upsert_offer', {
    p_offer_id: input.offerId ?? null,
    p_category: input.category,
    p_title: input.title,
    p_base_price_cents: input.basePriceCents,
    p_price_mode: input.priceMode,
    p_published: input.published,
  });
}

export async function publishProviderInventory(input: {
  offerId: string;
  serviceDate: string;
  totalUnits: number;
}): Promise<SharedInventory> {
  return callRpc('connectical_provider_publish_inventory', {
    p_offer_id: input.offerId,
    p_service_date: input.serviceDate,
    p_total_units: input.totalUnits,
  });
}

// Mismo cupo para `nights` noches desde `fromDate`, en una sola transacción (máximo 90).
export async function publishProviderInventoryRange(input: {
  offerId: string;
  fromDate: string;
  nights: number;
  totalUnits: number;
}): Promise<number> {
  return callRpc('connectical_provider_publish_inventory_range', {
    p_offer_id: input.offerId,
    p_from_date: input.fromDate,
    p_nights: input.nights,
    p_total_units: input.totalUnits,
  });
}

// Propietario activo o administración. Textos acotados en SQL; min/max son por reserva.
export async function setProviderOfferDetails(input: {
  offerId: string;
  description: string;
  location: string;
  meetingPoint: string;
  schedule: string;
  minQuantity: number;
  maxQuantity: number | null;
}): Promise<string> {
  return callRpc('connectical_provider_set_offer_details', {
    p_offer_id: input.offerId,
    p_description: input.description,
    p_location: input.location,
    p_meeting_point: input.meetingPoint,
    p_schedule: input.schedule,
    p_min_quantity: input.minQuantity,
    p_max_quantity: input.maxQuantity,
  });
}

// Solo administración. Pausar bloquea cotizaciones y publicaciones nuevas; no toca reservas existentes.
export async function setSharedProviderActive(providerId: string, active: boolean): Promise<SharedProvider> {
  return callRpc('connectical_admin_set_provider_active', { p_provider_id: providerId, p_active: active });
}

export type CommissionTerm = {
  offer_id: string;
  offer_title: string;
  category: PortalCategory;
  provider_name: string;
  provider_rate_bps: number;
  offer_rate_bps: number | null;
  effective_rate_bps: number;
  reference_min_bps: number | null;
  reference_max_bps: number | null;
  reference_status: 'reference' | 'approved';
  outside_reference: boolean;
};

// Solo administración (migración 202611140007). Las referencias por categoría no están aprobadas.
export async function listCommissionTerms(): Promise<CommissionTerm[]> {
  return callRpc('connectical_admin_list_commission_terms', {});
}

// rateBps nulo quita la excepción del producto y vuelve a la tasa del proveedor.
export async function setOfferCommission(offerId: string, rateBps: number | null): Promise<number | null> {
  const { data, error } = await (await freshClient()).database.rpc('connectical_admin_set_offer_commission', {
    p_offer_id: offerId,
    p_rate_bps: rateBps,
  });
  if (error) throw toReservationError('connectical_admin_set_offer_commission', error.message);
  return data as number | null;
}

export type PaymentReviewOutcome =
  | 'possible_double_charge'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'paid_without_reservation'
  | 'unknown_reservation';

export type PaymentReview = {
  id: number;
  gateway: string;
  event_id: string;
  reservation_id: string | null;
  kind: 'payment_approved' | 'payment_rejected' | 'payment_pending';
  amount_cents: number;
  currency: string;
  outcome: PaymentReviewOutcome;
  received_at: string;
};

// Solo administración (migración 202611140008): eventos de pasarela que no se aplicaron.
export async function listPaymentReviews(): Promise<PaymentReview[]> {
  return callRpc('connectical_admin_list_payment_reviews', {});
}

export type SweepHealth = {
  last_success_at: string | null;
  last_run_at: string | null;
  last_status: 'running' | 'succeeded' | 'partial' | 'skipped' | null;
  runs_last_hour: number;
  partial_runs_last_hour: number;
  overdue_holds: number;
  stale: boolean;
};

// Solo administración: estado del barrido programado de retenciones (migración 202611140006).
export async function getSweepHealth(): Promise<SweepHealth | null> {
  const rows = await callRpc<SweepHealth[]>('connectical_admin_sweep_health', {});
  return rows[0] ?? null;
}

// Próximas fechas publicadas de una oferta; la RLS solo expone inventario de ofertas publicadas.
export async function listOfferAvailability(offerId: string, fromDate: string): Promise<SharedInventory[]> {
  const { data, error } = await (await freshClient()).database
    .from('connectical_inventory')
    .select('offer_id, service_date, total_units, held_units, sold_units, version, updated_at')
    .eq('offer_id', offerId)
    .gte('service_date', fromDate)
    .order('service_date', { ascending: true })
    .limit(60);
  if (error) throw new Error(`No se pudo leer disponibilidad: ${error.message}`);
  return (data ?? []) as SharedInventory[];
}

export const PUBLISHED_AVAILABILITY_LIMIT = 1000;

// Inventario de las ofertas indicadas desde una fecha, en una sola consulta para el catálogo.
// Si devuelve PUBLISHED_AVAILABILITY_LIMIT filas puede estar truncado. Los contadores de
// retenciones vencidas pueden estar desfasados hasta el siguiente barrido.
export async function listPublishedAvailability(fromDate: string, offerIds: string[]): Promise<SharedInventory[]> {
  if (!offerIds.length) return [];
  const { data, error } = await (await freshClient()).database
    .from('connectical_inventory')
    .select('offer_id, service_date, total_units, held_units, sold_units, version, updated_at')
    .in('offer_id', offerIds)
    .gte('service_date', fromDate)
    .order('service_date', { ascending: true })
    .limit(PUBLISHED_AVAILABILITY_LIMIT);
  if (error) throw new Error(`No se pudo leer disponibilidad: ${error.message}`);
  return (data ?? []) as SharedInventory[];
}
