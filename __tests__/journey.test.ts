import { homeMock } from '../src/data/homeMock';
import {
  DEMO_SERVICE_FEE_RATES,
  getTotalsForSubtotalCents,
  getTripTotals,
  priceTripItems,
} from '../src/utils/journey';
import {
  calculateDemoQuote,
  DEFAULT_DEMO_PRICING_POLICY,
} from '../src/utils/pricingPolicy';

describe('trip pricing', () => {
  test('prices lodging by rooms and nights, then applies the demo fee', () => {
    const items = priceTripItems(
      [
        {
          id: 'stay',
          offerId: 'pousada-geriba',
          date: '2026-12-01',
          quantity: 1,
          nights: 3,
        },
      ],
      homeMock.offers,
    );

    expect(items[0].subtotalCents).toBe(96_000);
    expect(getTripTotals(items)).toEqual({
      subtotalCents: 96_000,
      serviceFeeRate: 600,
      serviceFeeCents: 5_760,
      totalCents: 101_760,
    });
  });

  test('prices per-person experiences by quantity and sorts by date and time', () => {
    const items = priceTripItems(
      [
        {
          id: 'night',
          offerId: 'disco-2x1',
          date: '2026-12-02',
          quantity: 2,
          nights: 1,
        },
        {
          id: 'boat',
          offerId: 'barco-escuna',
          date: '2026-12-01',
          quantity: 3,
          nights: 1,
        },
      ],
      homeMock.offers,
    );

    expect(items.map(entry => entry.offer.id)).toEqual(['barco-escuna', 'disco-2x1']);
    expect(items.map(entry => entry.subtotalCents)).toEqual([26_700, 12_000]);
    expect(getTripTotals(items)).toEqual({
      subtotalCents: 38_700,
      serviceFeeRate: 600,
      serviceFeeCents: 2_322,
      totalCents: 41_022,
    });
  });

  test('compares 4%, 6% and 8% exactly for R$2,520', () => {
    const totals = DEMO_SERVICE_FEE_RATES.map(rate =>
      getTotalsForSubtotalCents(252_000, rate),
    );

    expect(totals.map(entry => entry.totalCents)).toEqual([
      262_080,
      267_120,
      272_160,
    ]);
    expect(totals.map(entry => entry.serviceFeeCents)).toEqual([
      10_080,
      15_120,
      20_160,
    ]);
  });

  test('keeps supplier commission separate from traveler fees and estimates contribution margin', () => {
    const items = priceTripItems(
      [{ id: 'stay', offerId: 'pousada-geriba', date: '2026-12-01', quantity: 1, nights: 1 }],
      homeMock.offers,
    );
    const quote = calculateDemoQuote(items, DEFAULT_DEMO_PRICING_POLICY);

    expect(quote.providerCommissionCents).toBe(3_200);
    expect(quote.grossIncomeCents).toBe(5_120);
    expect(quote.gatewayCostCents).toBe(1_392);
    expect(quote.conversionCostCents).toBe(0);
    expect(quote.operatingReserveCents).toBe(640);
    expect(quote.contributionMarginCents).toBe(3_088);
    expect(quote.pricingVersion).toContain('svc600');
  });

  test('compares contribution margins for a R$2,520 lodging package under demo cost assumptions', () => {
    const lodging = homeMock.offers.find(offer => offer.id === 'pousada-geriba')!;
    const packageOffer = { ...lodging, price: 2_520 };
    const packageItems = priceTripItems(
      [{ id: 'package', offerId: packageOffer.id, date: '2026-12-01', quantity: 1, nights: 1 }],
      [packageOffer],
    );
    const quotes = DEMO_SERVICE_FEE_RATES.map(serviceFeeRate =>
      calculateDemoQuote(packageItems, { ...DEFAULT_DEMO_PRICING_POLICY, serviceFeeRate }),
    );

    expect(quotes.map(quote => quote.travelerTotalCents)).toEqual([
      262_080,
      267_120,
      272_160,
    ]);
    expect(quotes.map(quote => quote.providerCommissionCents)).toEqual([
      25_200,
      25_200,
      25_200,
    ]);
    expect(quotes.map(quote => quote.contributionMarginCents)).toEqual([
      19_744,
      24_583,
      29_422,
    ]);
  });
});