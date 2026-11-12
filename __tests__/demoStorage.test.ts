const mockPersistedValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockPersistedValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockPersistedValues.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockPersistedValues.delete(key);
    }),
  },
}));

import {
  clearDemoState,
  DEFAULT_DEMO_STORED_STATE,
  loadDemoState,
  saveDemoState,
} from '../src/lib/demoStorage';
import type { DemoBooking } from '../src/utils/pricingPolicy';

describe('demo state persistence', () => {
  test('restores trip, confirmed quote and fee scenario after a fresh load', async () => {
    const booking: DemoBooking = {
      id: 'BF-DEMO-001',
      channel: 'app-demo',
      confirmedAt: '2026-11-09T12:00:00.000Z',
      lines: [],
      quote: {
        pricingVersion: 'demo-price-v1-svc600',
        serviceFeeRate: 600,
        settlementMode: 'b2b_conciliation',
        subtotalCents: 252_000,
        serviceFeeCents: 15_120,
        travelerTotalCents: 267_120,
        providerCommissionCents: 0,
        grossIncomeCents: 15_120,
        gatewayCostCents: 10_697,
        conversionCostCents: 0,
        operatingReserveCents: 5_040,
        contributionMarginCents: -617,
        policy: {
          serviceFeeRate: 600,
          gatewayRateBps: 399,
          gatewayFixedCents: 39,
          conversionRateBps: 0,
          operatingReserveRateBps: 200,
          settlementMode: 'b2b_conciliation',
        },
      },
    };
    const tripItem = {
      id: 'barco-1',
      offerId: 'barco-escuna',
      date: '2026-12-01',
      quantity: 2,
      nights: 1,
    };

    await clearDemoState();
    await saveDemoState({
      ...DEFAULT_DEMO_STORED_STATE,
      serviceFeeRate: 800,
      tripItems: [tripItem],
      bookings: [booking],
    });

    const restored = await loadDemoState();

    expect(restored.tripItems).toEqual([tripItem]);
    expect(restored.serviceFeeRate).toBe(800);
    expect(restored.bookings[0].quote.travelerTotalCents).toBe(267_120);
    expect(restored.bookings[0].quote.serviceFeeRate).toBe(600);
    expect(restored.bookings[0].quote.pricingVersion).toBe('demo-price-v1-svc600');
  });
});