import {
  buildCatalog,
  CATEGORY_ICONS,
  matchesSearch,
  normalizeSearch,
  promotionOn,
  sharedOfferToOffer,
  withPromotionOn,
} from '../src/data/catalog';
import { homeMock } from '../src/data/homeMock';
import { PORTAL_CATEGORIES, portalCopy } from '../src/i18n/portalCopy';
import type { SharedOffer, SharedPromotion } from '../src/lib/reservationService';

declare const __dirname: string;
const fs: { readFileSync(path: string, encoding: 'utf8'): string } = require('fs');

const dinner: SharedOffer = {
  id: 'offer-1',
  provider_id: 'provider-1',
  category: 'restaurantes',
  title: 'Cena en la Rua das Pedras',
  base_price_cents: 20000,
  price_mode: 'person',
  currency: 'BRL',
  published: true,
  description: 'Menú de mariscos frente al mar',
  location: 'Búzios centro',
};

const promo: SharedPromotion = {
  offer_id: 'offer-1',
  percent_off_bps: 2500,
  starts_on: '2026-12-10',
  ends_on: '2026-12-15',
  label: 'Semana gastronómica',
};

describe('categories', () => {
  it('lists the same categories, in the same order, as the migration seeds them', () => {
    const sql = fs.readFileSync(`${__dirname}/../supabase/migrations/202611160006_catalog_commerce.sql`, 'utf8');
    const seed = sql.match(/insert into public\.connectical_categories \(id, sort_order\) values([\s\S]*?)on conflict/);
    const seeded = [...(seed?.[1] ?? '').matchAll(/\('(\w+)', (\d+)\)/g)]
      .sort((left, right) => Number(left[2]) - Number(right[2]))
      .map(match => match[1]);
    expect(seeded).toEqual(PORTAL_CATEGORIES);
  });

  it('has an icon, a home label and portal labels in every language for each category', () => {
    for (const category of PORTAL_CATEGORIES) {
      expect(CATEGORY_ICONS[category]).toBeTruthy();
      expect(homeMock.categories.some(item => item.id === category)).toBe(true);
      for (const language of ['es', 'pt', 'en'] as const) {
        expect(portalCopy[language].categories[category]).toBeTruthy();
      }
    }
  });

  it('counts restaurants and activities in the catalog without inventing demo offers', () => {
    const catalog = buildCatalog(homeMock.offers, homeMock.categories, { offers: [dinner], inventory: null });
    expect(catalog.categories.map(item => item.id)).toEqual(PORTAL_CATEGORIES);
    expect(catalog.categories.find(item => item.id === 'restaurantes')?.count).toBe(1);
    expect(catalog.categories.find(item => item.id === 'actividades')?.count).toBe(0);
    expect(catalog.offers.find(item => item.id === 'shared:offer-1')?.icon).toBe('food');
  });
});

describe('promotions', () => {
  it('finds the promotion covering a service date, inclusive of both ends', () => {
    const promotions = [{ percentOffBps: 2500, startsOn: '2026-12-10', endsOn: '2026-12-15', label: '' }];
    expect(promotionOn(promotions, '2026-12-09')).toBeNull();
    expect(promotionOn(promotions, '2026-12-10')).not.toBeNull();
    expect(promotionOn(promotions, '2026-12-15')).not.toBeNull();
    expect(promotionOn(promotions, '2026-12-16')).toBeNull();
  });

  it('shows the discounted price and the list price only on covered dates', () => {
    const offer = sharedOfferToOffer(dinner, null, [], [promo]);
    expect(offer.listPrice).toBe(200);
    expect(withPromotionOn(offer, '2026-12-12')).toMatchObject({ price: 150, originalPrice: 200 });
    expect(withPromotionOn(offer, '2026-12-20')).toMatchObject({ price: 200, originalPrice: undefined });
  });

  it('rounds the unit discount to the cent like create_quote', () => {
    const odd = sharedOfferToOffer({ ...dinner, base_price_cents: 9999 }, null, [], [{ ...promo, percent_off_bps: 3333 }]);
    // 9999 * 0.3333 = 3332.67 -> 3333 de descuento -> 6666 centavos.
    expect(withPromotionOn(odd, '2026-12-12').price).toBe(66.66);
  });

  it('ignores promotions of other offers and leaves offers without promotions untouched', () => {
    const other = sharedOfferToOffer(dinner, null, [], [{ ...promo, offer_id: 'offer-2' }]);
    expect(other.promotions).toEqual([]);
    expect(withPromotionOn(other, '2026-12-12')).toBe(other);
    const demo = homeMock.offers[0];
    expect(withPromotionOn(demo, '2026-12-12')).toBe(demo);
  });

  it('feeds the catalog headline discount from the promotion active on the reference date', () => {
    const catalog = buildCatalog([], homeMock.categories, { offers: [dinner], inventory: null, promotions: [promo] }, '2026-12-11');
    expect(catalog.maxDiscount).toBe(25);
    const later = buildCatalog([], homeMock.categories, { offers: [dinner], inventory: null, promotions: [promo] }, '2026-12-30');
    expect(later.maxDiscount).toBe(0);
  });
});

describe('search', () => {
  const offer = sharedOfferToOffer(dinner, null);

  it('ignores case and accents', () => {
    expect(normalizeSearch('  BÚZIOS Açaí ')).toBe('buzios acai');
    expect(matchesSearch(offer, 'buzios', 'es')).toBe(true);
    expect(matchesSearch(offer, 'CENA', 'es')).toBe(true);
  });

  it('requires every word and also searches the description and category label', () => {
    expect(matchesSearch(offer, 'mariscos centro', 'es')).toBe(true);
    expect(matchesSearch(offer, 'mariscos barco', 'es')).toBe(false);
    expect(matchesSearch(offer, 'restaurante', 'es', 'Restaurantes')).toBe(true);
  });

  it('matches everything with an empty query', () => {
    expect(matchesSearch(offer, '   ', 'es')).toBe(true);
  });
});
