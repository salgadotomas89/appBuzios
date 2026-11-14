import {
  portalCopy,
  type PortalCategory,
  type PortalPriceMode,
  type ReservationErrorCode,
  type ReservationStatus,
} from '../i18n/portalCopy';
import { insforge } from './insforge';

export type SharedRole = 'traveler' | 'provider' | 'admin';
export type SharedReservation = {
  id: string;
  quote_id: string;
  offer_id: string;
  provider_id: string;
  traveler_user_id: string;
  service_date: string;
  // Ausente hasta aplicar la migración 202611140001; equivale a 1.
  nights?: number;
  quantity: number;
  status: ReservationStatus;
  hold_expires_at: string | null;
  payment_status: 'approved' | 'rejected' | 'pending' | 'requires_action' | null;
  payment_method: 'card' | 'pix' | null;
  amount_cents: number;
  service_fee_rate_bps: 400 | 600 | 800;
  service_fee_cents: number;
  provider_commission_rate_bps: number;
  provider_commission_cents: number;
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
  provider_commission_rate_bps: number;
  provider_commission_cents: number;
  quote_version: string;
  expires_at: string;
};

export type SharedReservationEvent = {
  id: number;
  reservation_id: string;
  actor_user_id: string | null;
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
};

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

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getClient().database.rpc(name, args);
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

export async function getSharedRole(): Promise<SharedRole | null> {
  const client = getClient();
  const { data: userData, error: userError } = await client.auth.getCurrentUser();
  if (userError) throw new Error(`InsForge sesión: ${userError.message}`);
  const userId = userData?.user?.id;
  if (!userId) return null;

  const { data, error } = await client.database
    .from('connectical_profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`InsForge perfil: ${error.message}`);
  const role = (data as { role?: string } | null)?.role;
  return role === 'traveler' || role === 'provider' || role === 'admin' ? role : null;
}

export async function signInSharedAccount(email: string, password: string): Promise<void> {
  const { error } = await getClient().auth.signInWithPassword({ email, password });
  if (error) throw new Error(`No se pudo iniciar sesión: ${error.message}`);
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
  if (error) throw new Error(`No se pudo crear la cuenta: ${error.message}`);
  if (!data) throw new Error('InsForge no devolvio una respuesta de registro.');
}

export async function signOutSharedAccount(): Promise<void> {
  const { error } = await getClient().auth.signOut();
  if (error) throw new Error(`No se pudo cerrar sesión: ${error.message}`);
}

export async function listSharedReservations(): Promise<SharedReservation[]> {
  await callRpc<number>('connectical_expire_holds', {});
  const { data, error } = await getClient().database
    .from('connectical_reservations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron leer reservas: ${error.message}`);
  return (data ?? []) as SharedReservation[];
}

export async function listSharedProviders(): Promise<SharedProvider[]> {
  const { data, error } = await getClient().database
    .from('connectical_providers')
    .select('id, name, country_code, commission_rate_bps, active');
  if (error) throw new Error(`No se pudieron leer proveedores: ${error.message}`);
  return (data ?? []) as SharedProvider[];
}

export async function listSharedReservationEvents(): Promise<SharedReservationEvent[]> {
  const { data, error } = await getClient().database
    .from('connectical_reservation_events')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return (data ?? []) as SharedReservationEvent[];
}

export async function listSharedOffers(): Promise<SharedOffer[]> {
  const { data, error } = await getClient().database
    .from('connectical_offers')
    .select('id, provider_id, category, title, base_price_cents, price_mode, currency, published')
    .eq('published', true);
  if (error) throw new Error(`No se pudieron leer ofertas: ${error.message}`);
  return (data ?? []) as SharedOffer[];
}

export async function listProviderOffers(): Promise<SharedOffer[]> {
  const { data, error } = await getClient().database
    .from('connectical_offers')
    .select('id, provider_id, category, title, base_price_cents, price_mode, currency, published')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron leer ofertas del proveedor: ${error.message}`);
  return (data ?? []) as SharedOffer[];
}

export async function listProviderInventory(): Promise<SharedInventory[]> {
  const { data, error } = await getClient().database
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

// Próximas fechas publicadas de una oferta; la RLS solo expone inventario de ofertas publicadas.
export async function listOfferAvailability(offerId: string, fromDate: string): Promise<SharedInventory[]> {
  const { data, error } = await getClient().database
    .from('connectical_inventory')
    .select('offer_id, service_date, total_units, held_units, sold_units, version, updated_at')
    .eq('offer_id', offerId)
    .gte('service_date', fromDate)
    .order('service_date', { ascending: true })
    .limit(60);
  if (error) throw new Error(`No se pudo leer disponibilidad: ${error.message}`);
  return (data ?? []) as SharedInventory[];
}
