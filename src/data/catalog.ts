import type { IconName } from '../components/Icon';
import type { SharedInventory, SharedOffer } from '../lib/reservationService';
import { discountPercent } from '../utils/format';
import type { CategoryStat, Offer, OfferCategory } from './homeMock';

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
};

const PRICE_UNITS: Record<Offer['priceMode'], { es: string; pt: string }> = {
  night: { es: 'por noche', pt: 'por noite' },
  person: { es: 'por persona', pt: 'por pessoa' },
  ticket: { es: 'por entrada', pt: 'por ingresso' },
  group: { es: 'por grupo', pt: 'por grupo' },
};

const CATEGORY_ORDER: OfferCategory[] = ['pousadas', 'barcos', 'noche', 'buggy', 'experiencias'];

export function sharedOfferToOffer(shared: SharedOffer, inventory: SharedInventory[] | null): Offer {
  const ownInventory = inventory?.filter(item => item.offer_id === shared.id) ?? null;
  const freeUnits = ownInventory?.reduce(
    (sum, item) => sum + Math.max(0, item.total_units - item.held_units - item.sold_units),
    0,
  );
  const same = (text: string) => ({ es: text, pt: text });
  const description = shared.description?.trim() ?? '';
  const location = shared.location?.trim() ?? '';
  const meetingPoint = shared.meeting_point?.trim() ?? '';
  const schedule = shared.schedule?.trim() ?? '';
  const missing = {
    es: [...(description ? [] : ['Descripción del proveedor']), 'Qué incluye', 'Política de cancelación'],
    pt: [...(description ? [] : ['Descrição do fornecedor']), 'O que inclui', 'Política de cancelamento'],
  };
  return {
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
        },
    includes: { es: [], pt: [] },
    cancellation: {
      es: 'Política de cancelación pendiente de definir por Connectical.',
      pt: 'Política de cancelamento pendente de definição pela Connectical.',
    },
    missingFields: missing,
  };
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
  shared: { offers: SharedOffer[]; inventory: SharedInventory[] | null } | null,
): Catalog {
  const sharedOffers = shared?.offers.map(offer => sharedOfferToOffer(offer, shared.inventory)) ?? [];
  const offers = [...sharedOffers, ...demoOffers.map(offer => ({ ...offer, source: 'demo' as const }))];
  const labels = new Map(categoryLabels.map(category => [category.id, category]));
  const categories = CATEGORY_ORDER.map(id => ({
    ...(labels.get(id) ?? { id, label: { es: id, pt: id } }),
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
