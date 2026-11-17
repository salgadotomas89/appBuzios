import { homeMock, type Offer } from '../src/data/homeMock';
import { directionsQuery, mapsUrl } from '../src/utils/maps';
import { recommendOffers } from '../src/utils/recommendations';

describe('directions', () => {
  it('keeps the search inside Búzios', () => {
    expect(directionsQuery('Porto da Barra')).toBe('Porto da Barra, Armação dos Búzios, RJ, Brasil');
    expect(directionsQuery(' Centro de Búzios ')).toBe('Centro de Búzios, RJ, Brasil');
  });

  it('uses Apple Maps on iOS and Google Maps elsewhere, URL-encoded', () => {
    expect(mapsUrl('Rua das Pedras', 'ios')).toBe('https://maps.apple.com/?q=Rua%20das%20Pedras%2C%20Arma%C3%A7%C3%A3o%20dos%20B%C3%BAzios%2C%20RJ%2C%20Brasil');
    expect(mapsUrl('Rua das Pedras', 'android')).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rua%20das%20Pedras/);
    expect(mapsUrl('A & B', 'android')).toContain('A%20%26%20B');
  });
});

describe('recommendations', () => {
  const base = homeMock.offers[0];
  const make = (id: string, overrides: Partial<Offer>): Offer => ({ ...base, id, ...overrides });

  it('never recommends the open offer or offers that cannot be booked', () => {
    const current = make('a', { category: 'barcos' });
    const list = [current, make('b', { availability: 'unavailable' }), make('c', { availability: 'incomplete' }), make('d', {})];
    expect(recommendOffers(current, list, []).map(offer => offer.id)).toEqual(['d']);
  });

  it('prefers the same category, then categories of favorites, real offers, discounts and confirmed availability', () => {
    const current = make('cur', { category: 'barcos' });
    const list = [
      current,
      make('night', { category: 'noche', availability: 'limited', source: 'demo', originalPrice: undefined }),
      make('fav-cat', { category: 'pousadas', availability: 'limited', source: 'demo', originalPrice: undefined }),
      make('favorite', { category: 'pousadas', availability: 'unavailable' }),
      make('boat', { category: 'barcos', availability: 'limited', source: 'demo', originalPrice: undefined }),
      make('deal', { category: 'buggy', availability: 'available', source: 'shared', price: 80, originalPrice: 100 }),
    ];
    expect(recommendOffers(current, list, ['favorite']).map(offer => offer.id)).toEqual(['boat', 'deal', 'fav-cat']);
  });

  it('respects the limit and is deterministic on ties', () => {
    const current = make('cur', { category: 'barcos' });
    const list = ['z', 'y', 'x', 'w'].map(id => make(id, { category: 'noche', availability: 'limited', source: 'demo', originalPrice: undefined }));
    expect(recommendOffers(current, list, [], 2).map(offer => offer.id)).toEqual(['w', 'x']);
  });
});
