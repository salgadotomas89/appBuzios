export type CurrencyCode = 'BRL' | 'USD' | 'EUR' | 'ARS' | 'CLP';
export type PaymentCountryCode = 'BR' | 'CL' | 'AR' | 'US' | 'EU' | 'OTHER';
export type PaymentMethod = 'visa' | 'mastercard' | 'amex' | 'pix' | 'apple_pay' | 'google_pay';
export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'requires_action'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled';
export type PaymentSettlementMode = 'split_authorized' | 'b2b_conciliation';

export type PaymentEvent = {
  id: string;
  at: string;
  status: PaymentStatus;
  note: string;
};

export type PaymentIntent = {
  id: string;
  bookingId: string;
  paymentMethod: PaymentMethod;
  provider: 'mercado_pago' | 'simulated_gateway';
  currency: 'BRL';
  amountCents: number;
  travelerCountry: PaymentCountryCode;
  travelerHasCpf: boolean;
  providerCommissionCents: number;
  travelerFeeCents: number;
  netToProviderCents: number;
  quoteVersion: string;
  frozenQuoteVersion: string;
  settlementMode: PaymentSettlementMode;
  state: PaymentStatus;
  requiresAdditionalAuth: boolean;
  gatewayReference?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  refundedCents: number;
  notes: string[];
  history: PaymentEvent[];
};

export type PaymentAction = {
  status: PaymentStatus;
  gatewayReference?: string;
  extra?: Record<string, unknown>;
};

export type InformativeFxQuote = {
  currency: CurrencyCode;
  amount: number;
  rate: number;
  source: string;
  validAt: string;
  validUntil: string;
  baseCurrency: 'BRL';
  baseAmountCents: number;
};

export const NO_SPLIT_AVAILABLE =
  'NO_SPLIT_AVAILABLE: split not approved; use direct provider settlement and B2B reconciliation.';

const FX_RATES: Record<Exclude<CurrencyCode, 'BRL'>, number> = {
  USD: 0.18,
  EUR: 0.17,
  ARS: 18.6,
  CLP: 170.5,
};

export const PAYMENT_FX_REFERENCE = {
  source: 'Mercado Pago / FX reference snapshot (informative only)',
  validAt: '2026-11-11T12:00:00Z',
  validUntil: '2026-11-12T12:00:00Z',
  rates: {
    BRL: 1,
    USD: FX_RATES.USD,
    EUR: FX_RATES.EUR,
    ARS: FX_RATES.ARS,
    CLP: FX_RATES.CLP,
  },
};

export function createPaymentIntent(args: {
  bookingId: string;
  amountCents: number;
  travelerCountry: PaymentCountryCode;
  travelerHasCpf: boolean;
  selectedProvider?: 'mercado_pago' | 'simulated_gateway';
  method?: PaymentMethod;
  providerCommissionCents?: number;
  travelerFeeCents?: number;
  quoteVersion?: string;
  settlementMode?: PaymentSettlementMode;
  requiresAdditionalAuth?: boolean;
}): PaymentIntent {
  const createdAt = new Date().toISOString();
  const providerCommissionCents = args.providerCommissionCents ?? 0;
  const travelerFeeCents = args.travelerFeeCents ?? 0;
  const netToProviderCents = Math.max(0, args.amountCents - providerCommissionCents);
  const settlementMode = args.settlementMode ?? 'b2b_conciliation';

  return {
    id: `pay-${Math.random().toString(36).slice(2, 10)}`,
    bookingId: args.bookingId,
    paymentMethod: args.method ?? 'visa',
    provider: args.selectedProvider ?? 'mercado_pago',
    currency: 'BRL',
    amountCents: args.amountCents,
    travelerCountry: args.travelerCountry,
    travelerHasCpf: args.travelerHasCpf,
    providerCommissionCents,
    travelerFeeCents,
    netToProviderCents,
    quoteVersion: args.quoteVersion ?? 'demo-price-v1-svc600',
    frozenQuoteVersion: args.quoteVersion ?? 'demo-price-v1-svc600',
    settlementMode,
    state: 'pending',
    requiresAdditionalAuth: args.requiresAdditionalAuth ?? false,
    idempotencyKey: `${args.bookingId}-${args.amountCents}-${Date.now()}`,
    createdAt,
    updatedAt: createdAt,
    refundedCents: 0,
    notes: [],
    history: [{
      id: `evt-${Date.now()}`,
      at: createdAt,
      status: 'pending',
      note: 'simulated payment created; no real charge issued',
    }],
  };
}

export function finalizePaymentIntent(
  intent: PaymentIntent,
  action: PaymentAction,
): PaymentIntent {
  const status = action.status;
  const updatedAt = new Date().toISOString();
  const notes = [...intent.notes];

  if (status === 'requires_action') {
    notes.push('3DS/SCA required');
  }

  if (status === 'approved' && action.extra?.splitAuthorized === false) {
    notes.push(NO_SPLIT_AVAILABLE);
  }

  if (status === 'rejected') {
    notes.push('payment rejected by gateway');
  }

  const summaryText =
    typeof action.extra?.summary === 'string'
      ? action.extra.summary
      : `payment status changed to ${status}`;

  const nextIntent: PaymentIntent = {
    ...intent,
    state: status,
    updatedAt,
    gatewayReference: action.gatewayReference,
    requiresAdditionalAuth:
      status === 'requires_action' || intent.requiresAdditionalAuth || action.extra?.requiresAdditionalAuth === true,
    notes,
    history: [
      ...intent.history,
      {
        id: `evt-${Date.now()}`,
        at: updatedAt,
        status,
        note: summaryText,
      },
    ],
  };

  if (status === 'approved' && action.extra?.splitAuthorized === false) {
    nextIntent.settlementMode = 'b2b_conciliation';
  }

  return nextIntent;
}

export function getInformativeFxQuote(
  brlAmountCents: number,
  targetCurrency: CurrencyCode,
  snapshot = PAYMENT_FX_REFERENCE,
): InformativeFxQuote {
  const baseAmount = brlAmountCents / 100;
  const rate = targetCurrency === 'BRL' ? 1 : snapshot.rates[targetCurrency] ?? 1;
  const convertedAmount = Number((baseAmount * rate).toFixed(2));

  return {
    currency: targetCurrency,
    amount: convertedAmount,
    rate,
    source: snapshot.source,
    validAt: snapshot.validAt,
    validUntil: snapshot.validUntil,
    baseCurrency: 'BRL',
    baseAmountCents: brlAmountCents,
  };
}

export function applyRefund(
  intent: PaymentIntent,
  refund: { amountCents: number; reason: string },
): PaymentIntent {
  const safeAmount = Math.max(0, refund.amountCents);
  const remaining = Math.max(0, intent.amountCents - intent.refundedCents);
  const actualRefund = Math.min(safeAmount, remaining);

  if (safeAmount > 0 && safeAmount <= intent.refundedCents) {
    return {
      ...intent,
      notes: [...intent.notes, 'duplicate refund ignored'],
      history: [
        ...intent.history,
        {
          id: `evt-${Date.now()}`,
          at: new Date().toISOString(),
          status: intent.state,
          note: 'duplicate refund ignored',
        },
      ],
    };
  }

  if (actualRefund === 0) {
    return {
      ...intent,
      notes: [...intent.notes, 'refund ignored: nothing left to refund'],
      history: [
        ...intent.history,
        {
          id: `evt-${Date.now()}`,
          at: new Date().toISOString(),
          status: intent.state,
          note: `refund ignored: ${refund.reason}`,
        },
      ],
    };
  }

  const nextRefundCents = intent.refundedCents + actualRefund;
  const nextState: PaymentStatus =
    nextRefundCents >= intent.amountCents ? 'refunded' : 'partially_refunded';

  return {
    ...intent,
    refundedCents: nextRefundCents,
    state: nextState,
    notes: [...intent.notes, `refund applied: ${refund.reason}`],
    history: [
      ...intent.history,
      {
        id: `evt-${Date.now()}`,
        at: new Date().toISOString(),
        status: nextState,
        note: `refund applied: ${refund.reason}`,
      },
    ],
  };
}
