import { createReservationBackend } from '../src/lib/reservationBackend';

describe('reservation backend', () => {
  test('creates providers, offers and blocks the last available seat with transactional inventory control', () => {
    const backend = createReservationBackend();
    const provider = backend.createProvider({
      name: 'Pousada Maravista',
      country: 'BR',
      commissionRateBps: 1000,
    });
    const offer = backend.createOffer({
      providerId: provider.id,
      category: 'pousadas',
      title: 'Pousada Maravista',
      basePriceCents: 32000,
      priceMode: 'night',
      currency: 'BRL',
    });
    backend.publishInventory({
      offerId: offer.id,
      date: '2026-12-01',
      totalUnits: 2,
    });

    const travelerA = backend.createUser({
      name: 'Ana',
      role: 'traveler',
      country: 'CL',
    });
    const travelerB = backend.createUser({
      name: 'Luis',
      role: 'traveler',
      country: 'BR',
    });

    const quote = backend.createQuote({
      travelerId: travelerA.id,
      offerId: offer.id,
      date: '2026-12-01',
      quantity: 2,
      nights: 1,
      serviceFeeRate: 600,
    });

    const firstHold = backend.reserveOffer({
      quoteId: quote.id,
      travelerId: travelerA.id,
      quantity: 2,
      date: '2026-12-01',
    });

    expect(firstHold?.status).toBe('held');

    const secondAttempt = backend.reserveOffer({
      quoteId: quote.id,
      travelerId: travelerB.id,
      quantity: 1,
      date: '2026-12-01',
    });

    expect(secondAttempt).toBeNull();
  });

  test('simulates a confirmed payment and prevents duplicate processing', () => {
    const backend = createReservationBackend();
    const provider = backend.createProvider({
      name: 'Provider Demo',
      country: 'BR',
      commissionRateBps: 1000,
    });
    const offer = backend.createOffer({
      providerId: provider.id,
      category: 'barcos',
      title: 'Escuna Demo',
      basePriceCents: 8900,
      priceMode: 'person',
      currency: 'BRL',
    });
    backend.publishInventory({ offerId: offer.id, date: '2026-12-02', totalUnits: 5 });
    const traveler = backend.createUser({ name: 'Paula', role: 'traveler', country: 'AR' });
    const quote = backend.createQuote({
      travelerId: traveler.id,
      offerId: offer.id,
      date: '2026-12-02',
      quantity: 2,
      nights: 1,
      serviceFeeRate: 600,
    });
    const reservation = backend.reserveOffer({
      quoteId: quote.id,
      travelerId: traveler.id,
      quantity: 2,
      date: '2026-12-02',
    });

    expect(reservation).not.toBeNull();

    const confirmed = backend.simulatePayment(reservation!.id, {
      status: 'approved',
      gatewayReference: 'mp-001',
    });

    expect(confirmed.status).toBe('confirmed');
    expect(backend.simulatePayment(reservation!.id, { status: 'approved', gatewayReference: 'mp-dup' }).status).toBe('confirmed');
  });

  test('keeps historical pricing snapshots immutable after a commission change', () => {
    const backend = createReservationBackend();
    const provider = backend.createProvider({
      name: 'Pousada Snapshot',
      country: 'BR',
      commissionRateBps: 1000,
    });
    const offer = backend.createOffer({
      providerId: provider.id,
      category: 'pousadas',
      title: 'Snapshot Stay',
      basePriceCents: 32000,
      priceMode: 'night',
      currency: 'BRL',
    });
    backend.publishInventory({ offerId: offer.id, date: '2026-12-03', totalUnits: 3 });
    const traveler = backend.createUser({ name: 'Sofia', role: 'traveler', country: 'US' });
    const quote = backend.createQuote({
      travelerId: traveler.id,
      offerId: offer.id,
      date: '2026-12-03',
      quantity: 1,
      nights: 2,
      serviceFeeRate: 600,
    });

    const reservation = backend.reserveOffer({
      quoteId: quote.id,
      travelerId: traveler.id,
      quantity: 1,
      date: '2026-12-03',
    });

    backend.updateProviderCommission(provider.id, 1500, '2026-11-12');

    expect(reservation!.quoteVersion).toBe('demo-price-v1-svc600');
    expect(reservation!.providerCommissionRateBps).toBe(1000);
  });

  test('supports cancellation and refund flow, and maintains per-role access', () => {
    const backend = createReservationBackend();
    const admin = backend.createUser({ name: 'Admin', role: 'admin', country: 'CL' });
    const provider = backend.createProvider({
      name: 'Provider Refund',
      country: 'BR',
      commissionRateBps: 1000,
    });
    const offer = backend.createOffer({
      providerId: provider.id,
      category: 'noche',
      title: 'Privilege Refund',
      basePriceCents: 6000,
      priceMode: 'ticket',
      currency: 'BRL',
    });
    backend.publishInventory({ offerId: offer.id, date: '2026-12-04', totalUnits: 1 });
    const traveler = backend.createUser({ name: 'Tom', role: 'traveler', country: 'EU' });
    const quote = backend.createQuote({
      travelerId: traveler.id,
      offerId: offer.id,
      date: '2026-12-04',
      quantity: 1,
      nights: 1,
      serviceFeeRate: 600,
    });

    const reservation = backend.reserveOffer({
      quoteId: quote.id,
      travelerId: traveler.id,
      quantity: 1,
      date: '2026-12-04',
    });

    const cancelled = backend.cancelReservation(reservation!.id, { reason: 'traveler_request' });
    expect(cancelled.status).toBe('cancelled');

    const refunded = backend.processRefund(reservation!.id, { amountCents: cancelled.amountCents });
    expect(refunded.status).toBe('refunded');

    expect(backend.listReservationsForProvider(provider.id).length).toBe(1);
    expect(backend.listReservationsForAdmin().length).toBe(1);
    expect(backend.canAccessRecord(admin.id, cancelled.id, 'admin')).toBe(true);
    expect(backend.canAccessRecord(traveler.id, cancelled.id, 'traveler')).toBe(true);
  });
});
