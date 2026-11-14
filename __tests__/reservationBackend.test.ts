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
    // La estancia es de 2 noches: el modelo exige cupo publicado para ambas.
    backend.publishInventory({ offerId: offer.id, date: '2026-12-03', totalUnits: 3 });
    backend.publishInventory({ offerId: offer.id, date: '2026-12-04', totalUnits: 3 });
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

    // Solo se reembolsa lo cobrado: el pago se aprueba antes de cancelar.
    backend.simulatePayment(reservation!.id, { status: 'approved', gatewayReference: 'mp-refund' });
    const cancelled = backend.cancelReservation(reservation!.id, { reason: 'traveler_request' });
    expect(cancelled.status).toBe('cancelled');

    const refunded = backend.processRefund(reservation!.id, { amountCents: cancelled.amountCents });
    expect(refunded.status).toBe('refunded');

    expect(backend.listReservationsForProvider(provider.id).length).toBe(1);
    expect(backend.listReservationsForAdmin().length).toBe(1);
    expect(backend.canAccessRecord(admin.id, cancelled.id, 'admin')).toBe(true);
    expect(backend.canAccessRecord(traveler.id, cancelled.id, 'traveler')).toBe(true);
  });

  function setup(priceMode: 'night' | 'ticket' = 'night') {
    const backend = createReservationBackend();
    const providerUser = backend.createUser({ name: 'Owner', role: 'provider', country: 'BR' });
    const provider = backend.createProvider({
      name: 'Pousada Regla', country: 'BR', commissionRateBps: 1000, ownerUserId: providerUser.id,
    });
    const offer = backend.createOffer({
      providerId: provider.id, category: 'pousadas', title: 'Regla', basePriceCents: 10000, priceMode,
    });
    const travelerA = backend.createUser({ name: 'A', role: 'traveler', country: 'CL' });
    const travelerB = backend.createUser({ name: 'B', role: 'traveler', country: 'BR' });
    return { backend, providerUser, provider, offer, travelerA, travelerB };
  }

  test('holds every night of a stay and rejects overlapping stays', () => {
    const { backend, offer, travelerA, travelerB } = setup();
    for (const date of ['2026-12-10', '2026-12-11', '2026-12-12']) {
      backend.publishInventory({ offerId: offer.id, date, totalUnits: 1 });
    }
    const stay = backend.createQuote({
      travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 2, serviceFeeRate: 600,
    });
    expect(backend.reserveOffer({ quoteId: stay.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })?.nights).toBe(2);

    const overlap = backend.createQuote({
      travelerId: travelerB.id, offerId: offer.id, date: '2026-12-11', quantity: 1, nights: 2, serviceFeeRate: 600,
    });
    expect(backend.reserveOffer({ quoteId: overlap.id, travelerId: travelerB.id, quantity: 1, date: '2026-12-11' })).toBeNull();

    const unpublished = backend.createQuote({
      travelerId: travelerB.id, offerId: offer.id, date: '2026-12-12', quantity: 1, nights: 2, serviceFeeRate: 600,
    });
    expect(backend.reserveOffer({ quoteId: unpublished.id, travelerId: travelerB.id, quantity: 1, date: '2026-12-12' })).toBeNull();
  });

  test('binds the reservation to its quote and allows a quote only once', () => {
    const { backend, offer, travelerA } = setup();
    backend.publishInventory({ offerId: offer.id, date: '2026-12-10', totalUnits: 5 });
    const quote = backend.createQuote({
      travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 1, serviceFeeRate: 600,
    });
    expect(backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 3, date: '2026-12-10' })).toBeNull();
    expect(backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-11' })).toBeNull();
    expect(backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })).not.toBeNull();
    expect(backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })).toBeNull();
  });

  test('rejects multi-night quotes for non-night offers', () => {
    const { backend, offer, travelerA } = setup('ticket');
    expect(() => backend.createQuote({
      travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 2, serviceFeeRate: 600,
    })).toThrow('invalid_quote_input');
  });

  test('releases the right counter on rejection and cancellation, and only once', () => {
    const { backend, offer, travelerA } = setup();
    const inventory = backend.publishInventory({ offerId: offer.id, date: '2026-12-10', totalUnits: 2 });
    const book = () => {
      const quote = backend.createQuote({
        travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 1, serviceFeeRate: 600,
      });
      return backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })!;
    };
    const counters = () => {
      const current = backend.publishInventory({ offerId: offer.id, date: '2026-12-10', totalUnits: inventory.totalUnits });
      return `${current.heldUnits}/${current.soldUnits}`;
    };

    const rejected = book();
    backend.simulatePayment(rejected.id, { status: 'rejected' });
    expect(counters()).toBe('0/0');

    const confirmed = book();
    backend.simulatePayment(confirmed.id, { status: 'approved' });
    expect(counters()).toBe('0/1');
    backend.cancelReservation(confirmed.id, { reason: 'traveler_request' });
    backend.cancelReservation(confirmed.id, { reason: 'traveler_request' });
    expect(counters()).toBe('0/0');
  });

  test('refunds never exceed what was charged and need an approved payment', () => {
    const { backend, offer, travelerA } = setup();
    backend.publishInventory({ offerId: offer.id, date: '2026-12-10', totalUnits: 2 });
    const quote = backend.createQuote({
      travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 1, serviceFeeRate: 600,
    });
    const reservation = backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })!;
    expect(() => backend.processRefund(reservation.id, { amountCents: 100 })).toThrow('refund_not_allowed');

    backend.simulatePayment(reservation.id, { status: 'approved' });
    expect(backend.processRefund(reservation.id, { amountCents: 600 }).refundCents).toBe(600);
    expect(() => backend.processRefund(reservation.id, { amountCents: reservation.amountCents - 600 }))
      .toThrow('refund_requires_cancellation');
    backend.cancelReservation(reservation.id, { reason: 'traveler_request' });
    expect(() => backend.processRefund(reservation.id, { amountCents: reservation.amountCents })).toThrow('refund_exceeds_paid');
    expect(backend.processRefund(reservation.id, { amountCents: reservation.amountCents - 600 }).status).toBe('refunded');
  });

  test('lets a provider read only reservations of the provider they own', () => {
    const { backend, providerUser, offer, travelerA, travelerB } = setup();
    backend.publishInventory({ offerId: offer.id, date: '2026-12-10', totalUnits: 1 });
    const quote = backend.createQuote({
      travelerId: travelerA.id, offerId: offer.id, date: '2026-12-10', quantity: 1, nights: 1, serviceFeeRate: 600,
    });
    const reservation = backend.reserveOffer({ quoteId: quote.id, travelerId: travelerA.id, quantity: 1, date: '2026-12-10' })!;
    const stranger = backend.createUser({ name: 'Other provider', role: 'provider', country: 'BR' });
    expect(backend.canAccessRecord(providerUser.id, reservation.id, 'provider')).toBe(true);
    expect(backend.canAccessRecord(stranger.id, reservation.id, 'provider')).toBe(false);
    expect(backend.canAccessRecord(travelerB.id, reservation.id, 'traveler')).toBe(false);
  });
});
