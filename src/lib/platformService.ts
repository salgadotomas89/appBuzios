import type { PortalCategory } from '../i18n/portalCopy';
import { type MediaStorage, uploadOfferImage } from '../media/storageAdapter';
import type { ImageCandidate } from '../media/imagePolicy';
import { callRpc, freshClient } from './reservationService';
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

// Sube al almacenamiento y registra los metadatos. La URL pública la construye la base de datos a partir
// de la clave (no se acepta del cliente). Si el registro falla, borra el archivo subido para no dejar
// huérfanos. Con el almacenamiento desactivado (sin bucket confirmado) falla antes de subir.
export async function addOfferPhoto(storage: MediaStorage, offerId: string, candidate: ImageCandidate): Promise<string> {
  const uploaded = await uploadOfferImage(storage, offerId, candidate);
  try {
    return await callRpc<string>('connectical_add_offer_media', {
      p_offer_id: offerId,
      p_storage_key: uploaded.key,
      p_content_type: uploaded.type,
      p_byte_size: uploaded.byteSize,
      p_width: uploaded.width,
      p_height: uploaded.height,
      p_alt_text: uploaded.altText,
    });
  } catch (error) {
    await storage.remove(uploaded.key).catch(() => undefined);
    throw error;
  }
}

export async function removeOfferPhoto(storage: MediaStorage, mediaId: string): Promise<void> {
  const key = await callRpc<string>('connectical_remove_offer_media', { p_media_id: mediaId });
  // El registro ya no existe: la foto quedó retirada aunque el archivo no se pueda borrar ahora; ese
  // archivo huérfano queda para una limpieza posterior del bucket.
  await storage.remove(key).catch(() => undefined);
}
