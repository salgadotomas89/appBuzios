import type { Offer } from '../data/homeMock';

// "También te puede interesar": reglas simples y explicables, sin datos personales fuera del dispositivo.
// Puntúa misma categoría (+3), categoría de algún favorito (+2), oferta real publicada (+1), con descuento hoy (+1)
// y con cupo confirmado (+1). Nunca recomienda la oferta abierta ni ofertas sin cupo o incompletas.
export function recommendOffers(current: Offer, offers: Offer[], favoriteIds: readonly string[], limit = 3): Offer[] {
  const favoriteCategories = new Set(offers.filter(offer => favoriteIds.includes(offer.id)).map(offer => offer.category));
  return offers
    .filter(offer => offer.id !== current.id && (offer.availability === 'available' || offer.availability === 'limited'))
    .map(offer => ({
      offer,
      score:
        (offer.category === current.category ? 3 : 0) +
        (favoriteCategories.has(offer.category) ? 2 : 0) +
        (offer.source === 'shared' ? 1 : 0) +
        (offer.originalPrice !== undefined && offer.price !== undefined && offer.price < offer.originalPrice ? 1 : 0) +
        (offer.availability === 'available' ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.offer.id.localeCompare(right.offer.id))
    .slice(0, limit)
    .map(item => item.offer);
}
