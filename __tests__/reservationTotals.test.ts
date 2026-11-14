import {
  findInconsistencies,
  newIdempotencyKey,
  refundAllowance,
  summarizeReservations,
} from '../src/utils/reservationTotals';

const base = {
  amount_cents: 10600,
  refund_cents: 0,
  service_fee_cents: 600,
  provider_commission_cents: 1000,
  connectical_margin_cents: 600,
};

describe('summarizeReservations', () => {
  it('counts commission and fees only for confirmed reservations', () => {
    const totals = summarizeReservations([
      { ...base, status: 'confirmed', payment_status: 'approved' },
      { ...base, status: 'held', payment_status: null },
      { ...base, status: 'expired', payment_status: null },
      { ...base, status: 'cancelled', payment_status: 'rejected' },
    ]);
    expect(totals).toMatchObject({ confirmedCount: 1, commissionCents: 1000, connecticalFeeCents: 600 });
    expect(totals.collectedCents).toBe(10600);
  });

  it('nets refunds from collected money and flags cancelled payments not fully refunded', () => {
    const totals = summarizeReservations([
      { ...base, status: 'cancelled', payment_status: 'approved' },
      { ...base, status: 'cancelled', payment_status: 'approved', refund_cents: 4000 },
      { ...base, status: 'refunded', payment_status: 'approved', refund_cents: 10600 },
      { ...base, status: 'confirmed', payment_status: 'approved', refund_cents: 1500 },
    ]);
    expect(totals.collectedCents).toBe(42400);
    expect(totals.refundedCents).toBe(16100);
    expect(totals.netCollectedCents).toBe(26300);
    expect(totals.pendingRefundReviewCount).toBe(2);
    expect(totals.commissionCents).toBe(1000);
  });

  it('returns zeros for an empty list', () => {
    expect(summarizeReservations([])).toEqual({
      heldCount: 0, heldAmountCents: 0, confirmedCount: 0, confirmedGrossCents: 0, providerNetCents: 0,
      cancelledCount: 0, refundedCount: 0, commissionCents: 0, connecticalFeeCents: 0, collectedCents: 0,
      refundedCents: 0, netCollectedCents: 0, pendingRefundReviewCount: 0,
    });
  });

  it('reconciles gross, fee, commission and provider net and keeps holds out of income', () => {
    const portfolio = [
      { ...base, status: 'confirmed' as const, payment_status: 'approved' as const },
      { ...base, amount_cents: 21200, service_fee_cents: 1200, provider_commission_cents: 3600, connectical_margin_cents: 1200,
        status: 'confirmed' as const, payment_status: 'approved' as const },
      { ...base, status: 'held' as const, payment_status: null },
      { ...base, status: 'pending_payment' as const, payment_status: 'pending' as const },
      { ...base, status: 'expired' as const, payment_status: null },
    ];
    const totals = summarizeReservations(portfolio);
    expect(totals).toMatchObject({
      heldCount: 2, heldAmountCents: 21200, confirmedCount: 2, confirmedGrossCents: 31800,
      connecticalFeeCents: 1800, commissionCents: 4600, providerNetCents: 25400, collectedCents: 31800,
    });
    // Conciliación: el bruto confirmado se reparte exactamente entre cargo, comisión y neto.
    expect(totals.connecticalFeeCents + totals.commissionCents + totals.providerNetCents).toBe(totals.confirmedGrossCents);
  });
});

describe('refundAllowance', () => {
  it('mirrors the server rules for each reservation state', () => {
    expect(refundAllowance({ ...base, status: 'confirmed', payment_status: 'approved' }))
      .toEqual({ maxCents: 10599, fullRequiresCancellation: true });
    expect(refundAllowance({ ...base, status: 'cancelled', payment_status: 'approved', refund_cents: 600 }))
      .toEqual({ maxCents: 10000, fullRequiresCancellation: false });
    expect(refundAllowance({ ...base, status: 'refunded', payment_status: 'approved', refund_cents: 10600 }).maxCents).toBe(0);
    expect(refundAllowance({ ...base, status: 'cancelled', payment_status: 'rejected' }).maxCents).toBe(0);
    expect(refundAllowance({ ...base, status: 'pending_payment', payment_status: 'pending' }).maxCents).toBe(0);
    expect(refundAllowance({ ...base, status: 'held', payment_status: null }).maxCents).toBe(0);
  });
});

describe('newIdempotencyKey', () => {
  it('produces RFC 4122 version 4 uuids', () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newIdempotencyKey()).toMatch(pattern);
    expect(newIdempotencyKey(() => 0)).toBe('00000000-0000-4000-8000-000000000000');
    expect(newIdempotencyKey(() => 0.999)).toMatch(pattern);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('findInconsistencies', () => {
  it('passes states the SQL functions produce', () => {
    expect(findInconsistencies([
      { ...base, id: 'a', status: 'confirmed', payment_status: 'approved' },
      { ...base, id: 'b', status: 'held', payment_status: null },
      { ...base, id: 'c', status: 'cancelled', payment_status: 'rejected' },
      { ...base, id: 'd', status: 'refunded', payment_status: 'approved', refund_cents: 10600 },
      { ...base, id: 'e', status: 'cancelled', payment_status: 'approved', refund_cents: 3000 },
    ])).toEqual([]);
  });

  it('flags each impossible state', () => {
    expect(findInconsistencies([
      { ...base, id: 'a', status: 'confirmed', payment_status: 'pending' },
      { ...base, id: 'b', status: 'held', payment_status: 'approved' },
      { ...base, id: 'c', status: 'cancelled', payment_status: 'approved', refund_cents: 10601 },
      { ...base, id: 'd', status: 'cancelled', payment_status: 'rejected', refund_cents: 100 },
      { ...base, id: 'e', status: 'refunded', payment_status: 'approved', refund_cents: 5000 },
      { ...base, id: 'f', status: 'confirmed', payment_status: 'approved', service_fee_cents: 6000, provider_commission_cents: 5000 },
    ])).toEqual([
      { id: 'a', code: 'confirmed_without_payment' },
      { id: 'b', code: 'payment_approved_but_not_settled' },
      { id: 'c', code: 'refund_exceeds_amount' },
      { id: 'd', code: 'refund_without_payment' },
      { id: 'e', code: 'refunded_incomplete' },
      { id: 'f', code: 'fees_exceed_amount' },
    ]);
  });
});
