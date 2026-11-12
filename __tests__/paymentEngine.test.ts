import {
  createPaymentIntent,
  finalizePaymentIntent,
  getInformativeFxQuote,
  applyRefund,
  NO_SPLIT_AVAILABLE,
} from '../src/utils/paymentEngine';

describe('payment engine', () => {
  test('creates a BRL payment intent with a frozen quote version and clear separation of fees', () => {
    const intent = createPaymentIntent({
      bookingId: 'BK-100',
      amountCents: 267_120,
      travelerCountry: 'BR',
      travelerHasCpf: true,
      selectedProvider: 'mercado_pago',
      method: 'visa',
      providerCommissionCents: 25_200,
      travelerFeeCents: 15_120,
      quoteVersion: 'demo-price-v1-svc600',
      settlementMode: 'split_authorized',
    });

    expect(intent.currency).toBe('BRL');
    expect(intent.amountCents).toBe(267_120);
    expect(intent.amountCents).toBeGreaterThan(intent.providerCommissionCents);
    expect(intent.state).toBe('pending');
    expect(intent.quoteVersion).toBe('demo-price-v1-svc600');
    expect(intent.providerCommissionCents).toBe(25_200);
  });

  test('approves an international card payment and respects the frozen total', () => {
    const intent = createPaymentIntent({
      bookingId: 'BK-101',
      amountCents: 267_120,
      travelerCountry: 'CL',
      travelerHasCpf: false,
      selectedProvider: 'mercado_pago',
      method: 'visa',
      providerCommissionCents: 25_200,
      travelerFeeCents: 15_120,
      quoteVersion: 'demo-price-v1-svc600',
      settlementMode: 'split_authorized',
      requiresAdditionalAuth: false,
    });

    const approved = finalizePaymentIntent(intent, {
      status: 'approved',
      gatewayReference: 'mp-001',
      extra: { isInternational: true },
    });

    expect(approved.state).toBe('approved');
    expect(approved.frozenQuoteVersion).toBe('demo-price-v1-svc600');
    expect(approved.amountCents).toBe(267_120);
    expect(approved.gatewayReference).toBe('mp-001');
  });

  test('requires additional authentication for a card that triggers SCA', () => {
    const intent = createPaymentIntent({
      bookingId: 'BK-102',
      amountCents: 99_900,
      travelerCountry: 'US',
      travelerHasCpf: false,
      selectedProvider: 'mercado_pago',
      method: 'amex',
      providerCommissionCents: 9_990,
      travelerFeeCents: 5_000,
      quoteVersion: 'demo-price-v1-svc600',
      settlementMode: 'split_authorized',
      requiresAdditionalAuth: true,
    });

    const required = finalizePaymentIntent(intent, {
      status: 'requires_action',
      gatewayReference: 'mp-sca-1',
      extra: { authMethod: '3DS' },
    });

    expect(required.state).toBe('requires_action');
    expect(required.requiresAdditionalAuth).toBe(true);
  });

  test('provides informative FX conversions and records the source and date', () => {
    const quote = getInformativeFxQuote(267_120, 'USD');

    expect(quote.currency).toBe('USD');
    expect(quote.rate).toBeGreaterThan(0);
    expect(quote.source).toContain('Mercado Pago');
    expect(quote.validAt).toBeTruthy();
    expect(quote.amount).toBeGreaterThan(0);
  });

  test('blocks split settlement when the legal handling has not been authorized', () => {
    const intent = createPaymentIntent({
      bookingId: 'BK-103',
      amountCents: 120_000,
      travelerCountry: 'CL',
      travelerHasCpf: true,
      selectedProvider: 'mercado_pago',
      method: 'pix',
      providerCommissionCents: 12_000,
      travelerFeeCents: 5_000,
      quoteVersion: 'demo-price-v1-svc600',
      settlementMode: 'b2b_conciliation',
    });

    const splitBlocked = finalizePaymentIntent(intent, {
      status: 'approved',
      gatewayReference: 'mp-123',
      extra: { splitAuthorized: false },
    });

    expect(splitBlocked.settlementMode).toBe('b2b_conciliation');
    expect(splitBlocked.netToProviderCents).toBe(120_000 - 12_000);
    expect(splitBlocked.notes).toContain(NO_SPLIT_AVAILABLE);
  });

  test('supports partial refund and duplicate notification idempotency', () => {
    const intent = createPaymentIntent({
      bookingId: 'BK-104',
      amountCents: 250_000,
      travelerCountry: 'AR',
      travelerHasCpf: false,
      selectedProvider: 'mercado_pago',
      method: 'pix',
      providerCommissionCents: 20_000,
      travelerFeeCents: 12_000,
      quoteVersion: 'demo-price-v1-svc600',
      settlementMode: 'b2b_conciliation',
    });

    const approved = finalizePaymentIntent(intent, {
      status: 'approved',
      gatewayReference: 'mp-pix-1',
    });

    const refunded = applyRefund(approved, { amountCents: 80_000, reason: 'partial_refund' });
    expect(refunded.state).toBe('partially_refunded');
    expect(refunded.refundedCents).toBe(80_000);

    const duplicate = applyRefund(approved, { amountCents: 80_000, reason: 'duplicate_refund' });
    expect(duplicate.refundedCents).toBe(80_000);
  });
});
