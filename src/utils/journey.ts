import type { Offer } from '../data/homeMock';

export type TripItem = {
  id: string;
  offerId: string;
  date: string;
  quantity: number;
  nights: number;
};

export type PricedTripItem = {
  item: TripItem;
  offer: Offer;
  subtotalCents: number;
};

export const DEMO_SERVICE_FEE_RATES = [400, 600, 800] as const;
export type DemoServiceFeeRate = (typeof DEMO_SERVICE_FEE_RATES)[number];
export const DEFAULT_DEMO_SERVICE_FEE_RATE: DemoServiceFeeRate = 600;

export function getItemSubtotalCents(offer: Offer, item: TripItem): number {
  if (offer.price === undefined) {
    return 0;
  }

  const multiplier = offer.priceMode === 'night' ? item.nights : 1;
  return Math.round(offer.price * 100) * item.quantity * multiplier;
}

export function priceTripItems(
  items: TripItem[],
  offers: Offer[],
): PricedTripItem[] {
  const offerById = new Map(offers.map(offer => [offer.id, offer]));

  return items
    .flatMap(item => {
      const offer = offerById.get(item.offerId);
      if (!offer) {
        return [];
      }
      return [{ item, offer, subtotalCents: getItemSubtotalCents(offer, item) }];
    })
    .sort((left, right) => {
      const dateOrder = left.item.date.localeCompare(right.item.date);
      return dateOrder || (left.offer.startTime ?? '').localeCompare(right.offer.startTime ?? '');
    });
}

export function getTripTotals(
  items: PricedTripItem[],
  serviceFeeRate: DemoServiceFeeRate = DEFAULT_DEMO_SERVICE_FEE_RATE,
) {
  const subtotalCents = items.reduce((total, entry) => total + entry.subtotalCents, 0);
  return getTotalsForSubtotalCents(subtotalCents, serviceFeeRate);
}

export function getTotalsForSubtotalCents(
  subtotalCents: number,
  serviceFeeRate: DemoServiceFeeRate,
) {
  const serviceFeeCents = Math.round((subtotalCents * serviceFeeRate) / 10_000);
  return {
    subtotalCents,
    serviceFeeRate,
    serviceFeeCents,
    totalCents: subtotalCents + serviceFeeCents,
  };
}