import type { PricedTripItem } from './journey';
import type { Language, OfferCategory } from '../data/homeMock';
import type { TripItem } from './journey';
import {
  DEMO_SERVICE_FEE_RATES,
  getTripTotals,
  type DemoServiceFeeRate,
} from './journey';
import type { PaymentIntent, PaymentSettlementMode } from './paymentEngine';

export type DemoPricingPolicy = {
  serviceFeeRate: DemoServiceFeeRate;
  gatewayRateBps: number;
  gatewayFixedCents: number;
  conversionRateBps: number;
  operatingReserveRateBps: number;
  settlementMode?: PaymentSettlementMode;
};

export type DemoQuote = {
  pricingVersion: string;
  serviceFeeRate: DemoServiceFeeRate;
  settlementMode: PaymentSettlementMode;
  subtotalCents: number;
  serviceFeeCents: number;
  travelerTotalCents: number;
  providerCommissionCents: number;
  grossIncomeCents: number;
  gatewayCostCents: number;
  conversionCostCents: number;
  operatingReserveCents: number;
  contributionMarginCents: number;
  policy: DemoPricingPolicy;
};

export type BookingLineSnapshot = {
  item: TripItem;
  offerId: string;
  title: Record<Language, string>;
  location: Record<Language, string>;
  category: OfferCategory;
  priceMode: 'night' | 'person' | 'ticket' | 'group';
  priceUnit?: Record<Language, string>;
  unitPriceCents: number;
  subtotalCents: number;
};

export type DemoBooking = {
  id: string;
  channel: 'app-demo';
  confirmedAt: string;
  lines: BookingLineSnapshot[];
  quote: DemoQuote;
  payment?: PaymentIntent;
  accounting?: {
    settlementMode: PaymentSettlementMode;
    providerResponsible: string;
    netToProviderCents: number;
    grossIncomeCents: number;
    travelerFeeCents: number;
    providerCommissionCents: number;
    fxInformative: {
      currency: 'USD' | 'EUR' | 'ARS' | 'CLP';
      amount: number;
      rate: number;
      source: string;
      validAt: string;
      validUntil: string;
    };
  };
};

export const DEFAULT_DEMO_PRICING_POLICY: DemoPricingPolicy = {
  serviceFeeRate: 600,
  gatewayRateBps: 399,
  gatewayFixedCents: 39,
  conversionRateBps: 0,
  operatingReserveRateBps: 200,
  settlementMode: 'b2b_conciliation',
};

export const PROVIDER_COMMISSION_REFERENCES = {
  pousadas: 1000,
  barcos: 1800,
  noite: 1500,
  vipMin: 1800,
  vipMax: 2000,
  buggy: null,
} as const;

export function getPricingVersion(policy: DemoPricingPolicy): string {
  return [
    'demo-price-v1',
    `svc${policy.serviceFeeRate}`,
    `gw${policy.gatewayRateBps}`,
    `fix${policy.gatewayFixedCents}`,
    `fx${policy.conversionRateBps}`,
    `op${policy.operatingReserveRateBps}`,
  ].join('-');
}

export function calculateDemoQuote(
  items: PricedTripItem[],
  policy: DemoPricingPolicy,
): DemoQuote {
  const { subtotalCents, serviceFeeCents, totalCents } = getTripTotals(
    items,
    policy.serviceFeeRate,
  );
  const providerCommissionCents = items.reduce((sum, entry) => {
    const rateBps = Math.round((entry.offer.providerCommissionRate ?? 0) * 10_000);
    return sum + Math.round((entry.subtotalCents * rateBps) / 10_000);
  }, 0);
  const grossIncomeCents = serviceFeeCents + providerCommissionCents;
  const gatewayCostCents =
    Math.round((totalCents * policy.gatewayRateBps) / 10_000) +
    (totalCents > 0 ? policy.gatewayFixedCents : 0);
  const conversionCostCents = Math.round(
    (totalCents * policy.conversionRateBps) / 10_000,
  );
  const operatingReserveCents = Math.round(
    (subtotalCents * policy.operatingReserveRateBps) / 10_000,
  );

  return {
    pricingVersion: getPricingVersion(policy),
    serviceFeeRate: policy.serviceFeeRate,
    settlementMode: policy.settlementMode ?? 'b2b_conciliation',
    subtotalCents,
    serviceFeeCents,
    travelerTotalCents: totalCents,
    providerCommissionCents,
    grossIncomeCents,
    gatewayCostCents,
    conversionCostCents,
    operatingReserveCents,
    contributionMarginCents:
      grossIncomeCents - gatewayCostCents - conversionCostCents - operatingReserveCents,
    policy: { ...policy },
  };
}

export function isDemoServiceFeeRate(value: number): value is DemoServiceFeeRate {
  return (DEMO_SERVICE_FEE_RATES as readonly number[]).includes(value);
}