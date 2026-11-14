import type { Offer } from '../src/data/homeMock';
import { priceTripItems } from '../src/utils/journey';
import { calculateDemoQuote, DEFAULT_DEMO_PRICING_POLICY } from '../src/utils/pricingPolicy';

// El mismo fixture lo verifica scripts/test-shared-reservations.sh contra connectical_create_quote,
// así que la demo y PostgreSQL no pueden divergir en el redondeo de BRL. Los valores esperados se
// calcularon con aritmética decimal y redondeo half-up, no con ninguna de las dos implementaciones.
type ParityCase = {
  basePriceCents: number;
  quantity: number;
  nights: number;
  serviceFeeRateBps: 400 | 600 | 800;
  commissionRateBps: number;
  subtotalCents: number;
  serviceFeeCents: number;
  travelerTotalCents: number;
  providerCommissionCents: number;
};
const cases: ParityCase[] = require('./fixtures/quote-parity.json');

it.each(cases)(
  'prices $basePriceCents × $quantity × $nights at $serviceFeeRateBps/$commissionRateBps bps like PostgreSQL',
  parity => {
    const offer = {
      id: 'parity',
      priceMode: 'night',
      price: parity.basePriceCents / 100,
      providerCommissionRate: parity.commissionRateBps / 10_000,
    } as Offer;
    const items = priceTripItems(
      [{ id: 'i1', offerId: 'parity', date: '2099-01-01', quantity: parity.quantity, nights: parity.nights }],
      [offer],
    );
    const quote = calculateDemoQuote(items, {
      ...DEFAULT_DEMO_PRICING_POLICY,
      serviceFeeRate: parity.serviceFeeRateBps,
    });
    expect({
      subtotalCents: quote.subtotalCents,
      serviceFeeCents: quote.serviceFeeCents,
      travelerTotalCents: quote.travelerTotalCents,
      providerCommissionCents: quote.providerCommissionCents,
    }).toEqual({
      subtotalCents: parity.subtotalCents,
      serviceFeeCents: parity.serviceFeeCents,
      travelerTotalCents: parity.travelerTotalCents,
      providerCommissionCents: parity.providerCommissionCents,
    });
  },
);
