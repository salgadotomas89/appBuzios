import { newIdempotencyKey, refundAllowance, summarizeReservations } from '../src/utils/reservationTotals';

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
      confirmedCount: 0, commissionCents: 0, connecticalFeeCents: 0, collectedCents: 0,
      refundedCents: 0, netCollectedCents: 0, pendingRefundReviewCount: 0,
    });
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
