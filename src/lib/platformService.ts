import type { PortalCategory } from '../i18n/portalCopy';
import type { OfferMediaGateway } from '../media/offerMediaGateway';
import type { ImageCandidate } from '../media/imagePolicy';
import { callRpc, freshClient, toReservationError } from './reservationService';
import { insforge } from './insforge';

// Alta de proveedores, administración e incidencias (migraciones 202611150001 y 202611150002).
// Todas las comprobaciones de permisos ocurren en PostgreSQL; esta capa solo llama a los RPC.

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export type MyProviderApplication = {
  id: string;
  business_name: string;
  category: PortalCategory;
  status: ApplicationStatus;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
};

export type ProviderApplication = MyProviderApplication & {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  location: string;
  description: string;
};

export async function submitProviderApplication(input: {
  businessName: string;
  category: PortalCategory;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  location: string;
  description: string;
}): Promise<string> {
  return callRpc('connectical_submit_provider_application', {
    p_business_name: input.businessName,
    p_category: input.category,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_contact_email: input.contactEmail,
    p_location: input.location,
    p_description: input.description,
  });
}

export async function getMyProviderApplication(): Promise<MyProviderApplication | null> {
  const rows = await callRpc<MyProviderApplication[]>('connectical_my_provider_application', {});
  return rows[0] ?? null;
}

export async function listProviderApplications(status: ApplicationStatus | null = 'pending'): Promise<ProviderApplication[]> {
  return callRpc('connectical_admin_list_provider_applications', { p_status: status });
}

// Aprobar exige una comisión explícita: no hay tasas aprobadas que aplicar por defecto.
export async function reviewProviderApplication(input: {
  applicationId: string;
  decision: 'approved' | 'rejected';
  note: string;
  commissionRateBps: number | null;
}): Promise<ProviderApplication> {
  return callRpc('connectical_admin_review_provider_application', {
    p_application_id: input.applicationId,
    p_decision: input.decision,
    p_note: input.note,
    p_commission_rate_bps: input.commissionRateBps,
  });
}

export type ModerationStatus = 'approved' | 'pending' | 'suspended';
export type ModerationOffer = {
  offer_id: string;
  title: string;
  category: PortalCategory;
  provider_name: string;
  published: boolean;
  moderation_status: ModerationStatus;
  moderation_note: string;
  updated_at: string;
};

export async function listOffersForModeration(): Promise<ModerationOffer[]> {
  return callRpc('connectical_admin_list_offers_for_moderation', {});
}

export async function setOfferModeration(offerId: string, status: ModerationStatus, note: string): Promise<ModerationStatus> {
  return callRpc('connectical_admin_set_offer_moderation', { p_offer_id: offerId, p_status: status, p_note: note });
}

export type IncidentCategory = 'payment' | 'service' | 'safety' | 'access' | 'other';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved';
export type MyIncident = {
  id: string;
  reservation_id: string | null;
  category: IncidentCategory;
  description: string;
  status: IncidentStatus;
  admin_note: string;
  created_at: string;
  updated_at: string;
};
export type AdminIncident = MyIncident & { reporter_name: string };

export async function reportIncident(input: {
  reservationId: string | null;
  category: IncidentCategory;
  description: string;
}): Promise<string> {
  return callRpc('connectical_report_incident', {
    p_reservation_id: input.reservationId,
    p_category: input.category,
    p_description: input.description,
  });
}

export async function listMyIncidents(): Promise<MyIncident[]> {
  return callRpc('connectical_my_incidents', {});
}

export async function listIncidents(status: IncidentStatus | null = null): Promise<AdminIncident[]> {
  return callRpc('connectical_admin_list_incidents', { p_status: status });
}

export async function updateIncident(incidentId: string, status: IncidentStatus, note: string): Promise<IncidentStatus> {
  return callRpc('connectical_admin_update_incident', { p_incident_id: incidentId, p_status: status, p_note: note });
}

export type PlatformUser = {
  user_id: string;
  display_name: string;
  country_code: string;
  role: 'traveler' | 'provider' | 'admin';
  email: string | null;
  created_at: string;
};

export async function listPlatformUsers(): Promise<PlatformUser[]> {
  return callRpc('connectical_admin_list_users', { p_role: null });
}

export type PlatformKpis = {
  quotes: number;
  reservations: number;
  confirmed: number;
  cancelled: number;
  expired: number;
  refunded: number;
  confirmed_gross_cents: number;
  service_fee_cents: number;
  commission_cents: number;
  refunded_cents: number;
  quote_to_confirmed_bps: number;
};

export async function getPlatformKpis(from: string, to: string): Promise<PlatformKpis | null> {
  const rows = await callRpc<PlatformKpis[]>('connectical_admin_kpis', { p_from: from, p_to: to });
  return rows[0] ?? null;
}

export type AuditEntry = {
  id: number;
  actor_user_id: string | null;
  action: string;
  target_table: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
};

export async function listAuditLog(limit = 50): Promise<AuditEntry[]> {
  return callRpc('connectical_admin_list_audit_log', { p_limit: limit });
}

export type Campaign = {
  id: string;
  title: string;
  body: string;
  category: PortalCategory | null;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'active' | 'archived';
};

export async function listCampaigns(): Promise<Campaign[]> {
  return callRpc('connectical_admin_list_campaigns', {});
}

// Campañas de contenido: no cambian precios ni comisiones.
export async function saveCampaign(input: Omit<Campaign, 'id'> & { id: string | null }): Promise<string> {
  return callRpc('connectical_admin_save_campaign', {
    p_campaign_id: input.id,
    p_title: input.title,
    p_body: input.body,
    p_category: input.category,
    p_starts_on: input.starts_on,
    p_ends_on: input.ends_on,
    p_status: input.status,
  });
}

export async function listActiveCampaigns(): Promise<Array<Omit<Campaign, 'status'>>> {
  return callRpc('connectical_active_campaigns', {});
}

export type OfferMedia = {
  id: string;
  offer_id: string;
  url: string;
  content_type: string;
  width: number;
  height: number;
  alt_text: string;
  position: number;
};

// Fotos de varias ofertas en una consulta; la RLS solo devuelve las de ofertas visibles para quien lee.
export async function listOfferMedia(offerIds: string[]): Promise<OfferMedia[]> {
  if (!offerIds.length || !insforge) return [];
  const { data, error } = await (await freshClient()).database
    .from('connectical_offer_media')
    .select('id, offer_id, url, content_type, width, height, alt_text, position')
    .in('offer_id', offerIds)
    .order('position', { ascending: true });
  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`);
  return (data ?? []) as OfferMedia[];
}

// Moderación de fotos (202611160005): toda foto nueva espera revisión de la administración antes de ser pública.
export type MediaModerationStatus = 'pending' | 'approved' | 'rejected';
export type OwnOfferMedia = OfferMedia & { moderation_status: MediaModerationStatus; moderation_note: string };

// Fotos de una oferta propia con su estado y el motivo del rechazo. La RLS solo devuelve las de pendientes y
// rechazadas a su dueño y a la administración.
export async function listOwnOfferMedia(offerId: string): Promise<OwnOfferMedia[]> {
  if (!insforge) return [];
  const { data, error } = await (await freshClient()).database
    .from('connectical_offer_media')
    .select('id, offer_id, url, content_type, width, height, alt_text, position, moderation_status, moderation_note')
    .eq('offer_id', offerId)
    .order('position', { ascending: true });
  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`);
  return (data ?? []) as OwnOfferMedia[];
}

export type MediaReview = {
  media_id: string;
  offer_id: string;
  offer_title: string;
  provider_name: string;
  url: string;
  content_type: string;
  width: number;
  height: number;
  alt_text: string;
  moderation_status: MediaModerationStatus;
  moderation_note: string;
  moderated_by: string | null;
  moderated_at: string | null;
  created_at: string;
};

export async function listMediaReviews(status: MediaModerationStatus | null = 'pending'): Promise<MediaReview[]> {
  return callRpc('connectical_admin_list_media_reviews', { p_status: status });
}

export async function setMediaModeration(mediaId: string, status: 'approved' | 'rejected', note: string): Promise<MediaModerationStatus> {
  return callRpc('connectical_admin_set_media_moderation', { p_media_id: mediaId, p_status: status, p_note: note });
}

// Las fotos pasan siempre por la función offer-media: valida el archivo, lo sube con la clave de API y lo registra
// como el usuario. La base solo registra archivos escritos así (202611160003), de modo que subir directamente al
// bucket y llamar a connectical_add_offer_media no publica nada. Devuelve el id de la foto.
export async function addOfferPhoto(gateway: OfferMediaGateway, offerId: string, candidate: ImageCandidate): Promise<string> {
  return (await gateway.upload(offerId, candidate)).id;
}

export async function removeOfferPhoto(gateway: OfferMediaGateway, mediaId: string): Promise<void> {
  await gateway.remove(mediaId);
}

// Comisión por categoría de un proveedor (migración 202611160006). Solo administración.
export type ProviderCategoryRate = { provider_id: string; category: PortalCategory; rate_bps: number; updated_at: string };

export async function listProviderCategoryRates(providerId: string): Promise<ProviderCategoryRate[]> {
  return (await callRpc<ProviderCategoryRate[] | null>('connectical_admin_list_provider_category_rates', { p_provider_id: providerId })) ?? [];
}

// rateBps nulo elimina la tasa de esa categoría y vuelve a la general del proveedor.
export async function setProviderCategoryRate(providerId: string, category: PortalCategory, rateBps: number | null): Promise<void> {
  const { error } = await (await freshClient()).database.rpc('connectical_admin_set_provider_category_rate', {
    p_provider_id: providerId,
    p_category: category,
    p_rate_bps: rateBps,
  });
  if (error) throw toReservationError('connectical_admin_set_provider_category_rate', error.message);
}

// Estadísticas del proveedor por oferta (migración 202611170002). Importes en centavos BRL.
export type ProviderOfferStats = {
  offer_id: string;
  title: string;
  category: PortalCategory;
  published: boolean;
  quotes: number;
  reservations: number;
  confirmed: number;
  cancelled: number;
  expired: number;
  units_sold: number;
  gross_cents: number;
  service_fee_cents: number;
  commission_cents: number;
  net_cents: number;
  refunded_cents: number;
  discount_cents: number;
  checked_in: number;
  upcoming_7d: number;
};

export async function getProviderStats(from: string, to: string): Promise<ProviderOfferStats[]> {
  const rows = await callRpc<ProviderOfferStats[] | null>('connectical_provider_stats', { p_from: from, p_to: to });
  // bigint llega como texto o número según el driver: se normaliza a número.
  return (rows ?? []).map(row => ({
    ...row,
    gross_cents: Number(row.gross_cents),
    service_fee_cents: Number(row.service_fee_cents),
    commission_cents: Number(row.commission_cents),
    net_cents: Number(row.net_cents),
    refunded_cents: Number(row.refunded_cents),
    discount_cents: Number(row.discount_cents),
  }));
}

export type ProviderStatsTotals = Omit<ProviderOfferStats, 'offer_id' | 'title' | 'category' | 'published'> & {
  conversionBps: number;
};

// Suma por oferta y conversión cotización → confirmada en puntos básicos (0 sin cotizaciones).
export function totalProviderStats(rows: ProviderOfferStats[]): ProviderStatsTotals {
  const keys = ['quotes', 'reservations', 'confirmed', 'cancelled', 'expired', 'units_sold', 'gross_cents',
    'service_fee_cents', 'commission_cents', 'net_cents', 'refunded_cents', 'discount_cents', 'checked_in',
    'upcoming_7d'] as const;
  const totals = Object.fromEntries(keys.map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<
    (typeof keys)[number],
    number
  >;
  return { ...totals, conversionBps: totals.quotes ? Math.floor((totals.confirmed * 10000) / totals.quotes) : 0 };
}
