import type { IconName } from '../components/Icon';
import type { OfferMedia } from '../lib/platformService';
import type { SharedInventory, SharedOffer, SharedPromotion } from '../lib/reservationService';
import { PORTAL_CATEGORIES } from '../i18n/portalCopy';
import { discountPercent } from '../utils/format';
import type { CategoryStat, Language, Localized, Offer, OfferCategory, OfferPromotion } from './homeMock';

// Une el catálogo de ejemplo con las ofertas publicadas en InsForge. Una oferta compartida
// solo trae lo que el proveedor cargó (título, categoría, precio, modalidad y, si los completó,
// descripción, ubicación, punto de encuentro y horario): lo que falta se marca como faltante en
// vez de inventarse. El proveedor escribe en un solo idioma, que se muestra igual en ES y PT.

export const SHARED_OFFER_PREFIX = 'shared:';

export const CATEGORY_ICONS: Record<OfferCategory, IconName> = {
  pousadas: 'bed',
  barcos: 'boat',
  noche: 'music',
  buggy: 'buggy',
  experiencias: 'star',
  restaurantes: 'food',
  actividades: 'compass',
};

const PRICE_UNITS: Record<Offer['priceMode'], Localized> = {
  night: { es: 'por noche', pt: 'por noite', en: 'per night' },
  person: { es: 'por persona', pt: 'por pessoa', en: 'per person' },
  ticket: { es: 'por entrada', pt: 'por ingresso', en: 'per ticket' },
  group: { es: 'por grupo', pt: 'por grupo', en: 'per group' },
};

const CATEGORY_ORDER: OfferCategory[] = PORTAL_CATEGORIES;

// Promoción que cubre una fecha de servicio. El servidor impide solapes por oferta, así que hay como mucho una.
export function promotionOn(promotions: OfferPromotion[] | undefined, date: string): OfferPromotion | null {
  return promotions?.find(item => date >= item.startsOn && date <= item.endsOn) ?? null;
}

// Precio por unidad con la promoción de esa fecha, redondeado al centavo como create_quote. La cotización
// del servidor sigue siendo la que manda (redondea sobre el total).
export function withPromotionOn(offer: Offer, date: string): Offer {
  if (offer.listPrice === undefined || !offer.promotions?.length) return offer;
  const promotion = promotionOn(offer.promotions, date);
  if (!promotion) return { ...offer, price: offer.listPrice, originalPrice: undefined };
  const listCents = Math.round(offer.listPrice * 100);
  const discounted = listCents - Math.round((listCents * promotion.percentOffBps) / 10000);
  return { ...offer, price: discounted / 100, originalPrice: offer.listPrice };
}

export function sharedOfferToOffer(
  shared: SharedOffer,
  inventory: SharedInventory[] | null,
  media: OfferMedia[] = [],
  promotions: SharedPromotion[] = [],
  referenceDate?: string,
): Offer {
  const ownInventory = inventory?.filter(item => item.offer_id === shared.id) ?? null;
  const freeUnits = ownInventory?.reduce(
    (sum, item) => sum + Math.max(0, item.total_units - item.held_units - item.sold_units),
    0,
  );
  const same = (text: string): Localized => ({ es: text, pt: text, en: text });
  const description = shared.description?.trim() ?? '';
  const location = shared.location?.trim() ?? '';
  const meetingPoint = shared.meeting_point?.trim() ?? '';
  const schedule = shared.schedule?.trim() ?? '';
  const freeUnitsByDate = ownInventory
    ? Object.fromEntries(ownInventory.map(item => [item.service_date, Math.max(0, item.total_units - item.held_units - item.sold_units)]))
    : undefined;
  const missing: Localized<string[]> = {
    es: [...(description ? [] : ['Descripción del proveedor']), 'Qué incluye', 'Política de cancelación'],
    pt: [...(description ? [] : ['Descrição do fornecedor']), 'O que inclui', 'Política de cancelamento'],
    en: [...(description ? [] : ['Provider description']), "What's included", 'Cancellation policy'],
  };
  const offer: Offer = {
    id: `${SHARED_OFFER_PREFIX}${shared.id}`,
    source: 'shared',
    category: shared.category,
    icon: CATEGORY_ICONS[shared.category],
    tone: 'soft',
    // El proveedor carga un solo título; se muestra igual en ambos idiomas.
    title: same(shared.title),
    location: location ? same(location) : same('Búzios'),
    meetingPoint: meetingPoint ? same(meetingPoint) : undefined,
    schedule: schedule ? same(schedule) : undefined,
    price: shared.base_price_cents / 100,
    priceUnit: PRICE_UNITS[shared.price_mode],
    priceMode: shared.price_mode,
    // Sin inventario leído no se afirma disponibilidad: el portal la confirma por fecha.
    availability: freeUnits === undefined ? 'limited' : freeUnits > 0 ? 'available' : 'unavailable',
    description: description
      ? same(description)
      : {
          es: 'Oferta publicada por un proveedor. La disponibilidad y el precio se confirman al cotizar.',
          pt: 'Oferta publicada por um fornecedor. A disponibilidade e o preço são confirmados na cotação.',
          en: 'Offer published by a provider. Availability and price are confirmed when you get a quote.',
        },
    includes: { es: [], pt: [], en: [] },
    cancellation: {
      es: 'Política de cancelación pendiente de definir por Connectical.',
      pt: 'Política de cancelamento pendente de definição pela Connectical.',
      en: 'Cancellation policy not yet defined by Connectical.',
    },
    missingFields: missing,
    freeUnitsByDate,
    quantityLimits: { min: shared.min_quantity ?? 1, max: shared.max_quantity ?? null },
    photos: media
      .filter(item => item.offer_id === shared.id)
      .sort((left, right) => left.position - right.position)
      .map(item => ({ url: item.url, alt: item.alt_text, width: item.width, height: item.height })),
    listPrice: shared.base_price_cents / 100,
    promotions: promotions
      .filter(item => item.offer_id === shared.id)
      .map(item => ({ percentOffBps: item.percent_off_bps, startsOn: item.starts_on, endsOn: item.ends_on, label: item.label })),
  };
  return referenceDate ? withPromotionOn(offer, referenceDate) : offer;
}

export function sharedOfferId(offer: Offer): string | null {
  return offer.source === 'shared' && offer.id.startsWith(SHARED_OFFER_PREFIX)
    ? offer.id.slice(SHARED_OFFER_PREFIX.length)
    : null;
}

export type Catalog = {
  offers: Offer[];
  categories: CategoryStat[];
  activeOffers: number;
  maxDiscount: number;
};

export function buildCatalog(
  demoOffers: Offer[],
  categoryLabels: CategoryStat[],
  shared: {
    offers: SharedOffer[];
    inventory: SharedInventory[] | null;
    media?: OfferMedia[];
    promotions?: SharedPromotion[];
  } | null,
  referenceDate?: string,
): Catalog {
  const sharedOffers =
    shared?.offers.map(offer => sharedOfferToOffer(offer, shared.inventory, shared.media, shared.promotions, referenceDate)) ?? [];
  const offers = [...sharedOffers, ...demoOffers.map(offer => ({ ...offer, source: 'demo' as const }))];
  const labels = new Map(categoryLabels.map(category => [category.id, category]));
  const categories = CATEGORY_ORDER.map(id => ({
    ...(labels.get(id) ?? { id, label: { es: id, pt: id, en: id } }),
    count: offers.filter(offer => offer.category === id).length,
  }));
  return {
    offers,
    categories,
    // Igual que el valor que homeMock tenía fijo: todas las experiencias listadas.
    activeOffers: offers.length,
    maxDiscount: offers.reduce(
      (max, offer) => (offer.price === undefined ? max : Math.max(max, discountPercent(offer.price, offer.originalPrice))),
      0,
    ),
  };
}

export type CatalogFilter = { date: string | null; people: number | null; favoritesOnly: boolean; favorites: ReadonlySet<string> };

// Filtros del explorador. Fecha: una oferta compartida necesita cupo libre publicado ese día (si su
// inventario no se pudo leer, no se descarta: el portal lo confirma). Las de ejemplo no tienen
// calendario y no se filtran por fecha. Personas: se respetan los límites por reserva cuando existen;
// en alojamientos la cantidad son habitaciones y en ofertas por grupo son grupos, así que el número de
// personas no las descarta.
export function filterOffers(offers: Offer[], filter: CatalogFilter): Offer[] {
  return offers.filter(offer => {
    if (filter.favoritesOnly && !filter.favorites.has(offer.id)) return false;
    if (filter.date && offer.source === 'shared' && offer.freeUnitsByDate) {
      if ((offer.freeUnitsByDate[filter.date] ?? 0) < 1) return false;
    }
    if (filter.people && (offer.priceMode === 'person' || offer.priceMode === 'ticket') && offer.quantityLimits) {
      const { min, max } = offer.quantityLimits;
      if (filter.people < min || (max !== null && filter.people > max)) return false;
    }
    return true;
  });
}

// Búsqueda del explorador: sin distinguir mayúsculas ni acentos ("buzios" encuentra "Búzios"), y cada palabra
// debe aparecer en el título, la ubicación, la descripción o el nombre de la categoría.
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

export function matchesSearch(offer: Offer, query: string, language: Language, categoryLabel = ''): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalizeSearch(
    [offer.title[language], offer.location[language], offer.description[language], categoryLabel].join(' '),
  );
  return words.every(word => haystack.includes(word));
}
