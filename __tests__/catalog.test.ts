import { buildCatalog, sharedOfferId, sharedOfferToOffer } from '../src/data/catalog';
import { homeMock } from '../src/data/homeMock';
import type { SharedInventory, SharedOffer } from '../src/lib/reservationService';

const shared: SharedOffer = {
  id: 'o-1', provider_id: 'p-1', category: 'barcos', title: 'Escuna real',
  base_price_cents: 12550, price_mode: 'person', currency: 'BRL', published: true,
};

function inventory(offerId: string, total: number, held = 0, sold = 0): SharedInventory {
  return {
    offer_id: offerId, service_date: '2099-01-01', total_units: total, held_units: held,
    sold_units: sold, version: 1, updated_at: '2099-01-01T00:00:00Z',
  };
}

it('derives the demo header values that homeMock used to hard-code', () => {
  const catalog = buildCatalog(homeMock.offers, homeMock.categories, null);
  expect(catalog.offers).toHaveLength(homeMock.offers.length);
  expect(catalog.categories.map(category => [category.id, category.count])).toEqual(
    homeMock.categories.map(category => [category.id, category.count]),
  );
  expect(catalog.activeOffers).toBe(homeMock.activeOffers);
  expect(catalog.maxDiscount).toBe(homeMock.maxDiscount);
  expect(catalog.offers.every(offer => offer.source === 'demo')).toBe(true);
});

it('maps a shared offer without inventing details', () => {
  const offer = sharedOfferToOffer(shared, [inventory('o-1', 3, 1, 1), inventory('other', 9)]);
  expect(offer).toMatchObject({
    id: 'shared:o-1', source: 'shared', category: 'barcos', icon: 'boat', price: 125.5,
    priceMode: 'person', availability: 'available', title: { es: 'Escuna real', pt: 'Escuna real' },
  });
  expect(offer.originalPrice).toBeUndefined();
  expect(offer.includes.es).toEqual([]);
  expect(offer.missingFields?.es).toContain('Política de cancelación');
  expect(sharedOfferId(offer)).toBe('o-1');
});

it('derives shared availability from free units and leaves it unconfirmed without inventory', () => {
  expect(sharedOfferToOffer(shared, [inventory('o-1', 2, 1, 1)]).availability).toBe('unavailable');
  expect(sharedOfferToOffer(shared, []).availability).toBe('unavailable');
  expect(sharedOfferToOffer(shared, null).availability).toBe('limited');
});

it('lists shared offers first and counts them per category', () => {
  const catalog = buildCatalog(homeMock.offers, homeMock.categories, {
    offers: [shared], inventory: [inventory('o-1', 0)],
  });
  expect(catalog.offers[0].id).toBe('shared:o-1');
  const boats = catalog.categories.find(category => category.id === 'barcos');
  expect(boats?.count).toBe(homeMock.categories.find(category => category.id === 'barcos')!.count + 1);
  expect(catalog.activeOffers).toBe(homeMock.activeOffers + 1);
  expect(sharedOfferId(homeMock.offers[0])).toBeNull();
});

it('uses the provider details when present and only lists what is still missing', () => {
  const offer = sharedOfferToOffer({
    ...shared, description: ' Escuna com parada para mergulho. ', location: 'Praia dos Ossos',
    meeting_point: 'Cais', schedule: 'Saída 10:00', min_quantity: 2, max_quantity: 12,
  }, null);
  expect(offer.description).toEqual({ es: 'Escuna com parada para mergulho.', pt: 'Escuna com parada para mergulho.' });
  expect(offer.location.pt).toBe('Praia dos Ossos');
  expect(offer.meetingPoint?.es).toBe('Cais');
  expect(offer.schedule?.es).toBe('Saída 10:00');
  expect(offer.missingFields?.es).toEqual(['Qué incluye', 'Política de cancelación']);
  // Sin detalle cargado se usa un texto genérico y la ubicación general.
  const bare = sharedOfferToOffer(shared, null);
  expect(bare.location.es).toBe('Búzios');
  expect(bare.meetingPoint).toBeUndefined();
  expect(bare.missingFields?.es[0]).toBe('Descripción del proveedor');
});
