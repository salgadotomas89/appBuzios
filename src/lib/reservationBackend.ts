import { addDays } from '../utils/portalInput';

// Modelo en memoria de las reglas de supabase/migrations para pruebas sin base de datos.
// La app usa reservationService (PostgreSQL); si cambian las reglas SQL, este modelo debe seguirlas.

export type UserRole = 'traveler' | 'provider' | 'admin';
export type OfferCategory = 'pousadas' | 'barcos' | 'noche' | 'buggy';
export type PriceMode = 'night' | 'person' | 'ticket' | 'group';
export type ReservationStatus =
  | 'draft'
  | 'quoted'
  | 'held'
  | 'pending_payment'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
  | 'refunded';
export type PaymentOutcomeStatus = 'approved' | 'rejected' | 'pending' | 'requires_action';

export type UserRecord = {
  id: string;
  name: string;
  role: UserRole;
  country: string;
  createdAt: string;
};

export type ProviderRecord = {
  id: string;
  ownerUserId?: string;
  name: string;
  country: string;
  commissionRateBps: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OfferRecord = {
  id: string;
  providerId: string;
  category: OfferCategory;
  title: string;
  basePriceCents: number;
  priceMode: PriceMode;
  currency: 'BRL';
  status: 'draft' | 'published';
  createdAt: string;
};

export type InventoryRecord = {
  id: string;
  offerId: string;
  date: string;
  totalUnits: number;
  heldUnits: number;
  soldUnits: number;
  version: number;
  updatedAt: string;
};

export type QuoteRecord = {
  id: string;
  travelerId: string;
  offerId: string;
  date: string;
  quantity: number;
  nights: number;
  serviceFeeRate: number;
  subtotalCents: number;
  serviceFeeCents: number;
  travelerTotalCents: number;
  providerCommissionRateBps: number;
  providerCommissionCents: number;
  quoteVersion: string;
  createdAt: string;
};

export type ReservationRecord = {
  id: string;
  quoteId: string;
  offerId: string;
  providerId: string;
  travelerId: string;
  date: string;
  nights: number;
  quantity: number;
  status: ReservationStatus;
  amountCents: number;
  serviceFeeCents: number;
  providerCommissionCents: number;
  providerCommissionRateBps: number;
  quoteVersion: string;
  createdAt: string;
  updatedAt: string;
  paymentStatus?: PaymentOutcomeStatus;
  gatewayReference?: string;
  refundCents: number;
  audit: Array<{ id: string; at: string; event: string }>;
};

export type ReservationBackend = {
  createUser: (args: { name: string; role: UserRole; country: string }) => UserRecord;
  createProvider: (args: {
    name: string;
    country: string;
    commissionRateBps: number;
    ownerUserId?: string;
  }) => ProviderRecord;
  createOffer: (args: {
    providerId: string;
    category: OfferCategory;
    title: string;
    basePriceCents: number;
    priceMode: PriceMode;
    currency?: 'BRL';
  }) => OfferRecord;
  publishInventory: (args: { offerId: string; date: string; totalUnits: number }) => InventoryRecord;
  createQuote: (args: {
    travelerId: string;
    offerId: string;
    date: string;
    quantity: number;
    nights: number;
    serviceFeeRate: number;
  }) => QuoteRecord;
  reserveOffer: (args: {
    quoteId: string;
    travelerId: string;
    quantity: number;
    date: string;
  }) => ReservationRecord | null;
  simulatePayment: (
    reservationId: string,
    action: { status: PaymentOutcomeStatus; gatewayReference?: string },
  ) => ReservationRecord;
  cancelReservation: (reservationId: string, reason: { reason: string }) => ReservationRecord;
  processRefund: (reservationId: string, refund: { amountCents: number }) => ReservationRecord;
  updateProviderCommission: (providerId: string, rateBps: number, effectiveFrom: string) => ProviderRecord;
  listReservationsForProvider: (providerId: string) => ReservationRecord[];
  listReservationsForAdmin: () => ReservationRecord[];
  canAccessRecord: (userId: string, reservationId: string, requestedRole: UserRole) => boolean;
};

export function createReservationBackend(): ReservationBackend {
  const users = new Map<string, UserRecord>();
  const providers = new Map<string, ProviderRecord>();
  const offers = new Map<string, OfferRecord>();
  const inventory = new Map<string, InventoryRecord>();
  const quotes = new Map<string, QuoteRecord>();
  const reservations = new Map<string, ReservationRecord>();

  function nowIso() {
    return new Date().toISOString();
  }

  function roundCents(value: number) {
    return Math.round(value);
  }

  // Noches cubiertas: [date, date + nights), igual que connectical_adjust_stay_inventory.
  function stayInventory(offerId: string, date: string, nights: number): Array<InventoryRecord | undefined> {
    return Array.from({ length: nights }, (_, index) => inventory.get(`${offerId}:${addDays(date, index)}`));
  }

  function adjustStay(reservation: ReservationRecord, heldDelta: number, soldDelta: number, at: string) {
    for (const stock of stayInventory(reservation.offerId, reservation.date, reservation.nights)) {
      if (!stock) continue;
      stock.heldUnits = Math.max(0, stock.heldUnits + heldDelta);
      stock.soldUnits = Math.max(0, stock.soldUnits + soldDelta);
      stock.version += 1;
      stock.updatedAt = at;
    }
  }

  function canAccessRecord(userId: string, reservationId: string, requestedRole: UserRole) {
    const user = users.get(userId);
    const reservation = reservations.get(reservationId);
    if (!user || !reservation) return false;
    if (user.role === 'admin') return true;
    if (requestedRole === 'traveler' && user.role === 'traveler') {
      return reservation.travelerId === userId;
    }
    if (requestedRole === 'provider' && user.role === 'provider') {
      return providers.get(reservation.providerId)?.ownerUserId === userId;
    }
    return false;
  }

  return {
    createUser({ name, role, country }) {
      const id = `user-${Math.random().toString(36).slice(2, 10)}`;
      const record: UserRecord = {
        id,
        name,
        role,
        country,
        createdAt: nowIso(),
      };
      users.set(id, record);
      return record;
    },

    createProvider({ name, country, commissionRateBps, ownerUserId }) {
      const id = `provider-${Math.random().toString(36).slice(2, 10)}`;
      const record: ProviderRecord = {
        id,
        ownerUserId,
        name,
        country,
        commissionRateBps,
        active: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      providers.set(id, record);
      return record;
    },

    createOffer({ providerId, category, title, basePriceCents, priceMode, currency = 'BRL' }) {
      const record: OfferRecord = {
        id: `offer-${Math.random().toString(36).slice(2, 10)}`,
        providerId,
        category,
        title,
        basePriceCents,
        priceMode,
        currency,
        status: 'published',
        createdAt: nowIso(),
      };
      offers.set(record.id, record);
      return record;
    },

    publishInventory({ offerId, date, totalUnits }) {
      const id = `${offerId}:${date}`;
      const current = inventory.get(id);
      const record: InventoryRecord = {
        id,
        offerId,
        date,
        totalUnits,
        heldUnits: current?.heldUnits ?? 0,
        soldUnits: current?.soldUnits ?? 0,
        version: (current?.version ?? 0) + 1,
        updatedAt: nowIso(),
      };
      inventory.set(id, record);
      return record;
    },

    createQuote({ travelerId, offerId, date, quantity, nights, serviceFeeRate }) {
      const offer = offers.get(offerId);
      if (!offer) {
        throw new Error(`Offer ${offerId} not found`);
      }
      const provider = providers.get(offer.providerId);
      if (!provider) {
        throw new Error(`Provider for offer ${offerId} not found`);
      }
      if (quantity <= 0 || nights <= 0 || nights > 30 || (offer.priceMode !== 'night' && nights !== 1)) {
        throw new Error('invalid_quote_input');
      }
      const subtotalCents = roundCents(offer.basePriceCents * quantity * nights);
      const serviceFeeCents = roundCents((subtotalCents * serviceFeeRate) / 10_000);
      const travelerTotalCents = subtotalCents + serviceFeeCents;
      const providerCommissionCents = roundCents(
        (subtotalCents * provider.commissionRateBps) / 10_000,
      );
      const quote: QuoteRecord = {
        id: `quote-${Math.random().toString(36).slice(2, 10)}`,
        travelerId,
        offerId,
        date,
        quantity,
        nights,
        serviceFeeRate,
        subtotalCents,
        serviceFeeCents,
        travelerTotalCents,
        providerCommissionRateBps: provider.commissionRateBps,
        providerCommissionCents,
        quoteVersion: `demo-price-v1-svc${serviceFeeRate}`,
        createdAt: nowIso(),
      };
      quotes.set(quote.id, quote);
      return quote;
    },

    reserveOffer({ quoteId, travelerId, quantity, date }) {
      const quote = quotes.get(quoteId);
      if (!quote) return null;
      if (quote.travelerId !== travelerId) return null;
      // La reserva hereda cantidad y fechas de la cotización, que solo se puede usar una vez.
      if (quantity !== quote.quantity || date !== quote.date) return null;
      if (Array.from(reservations.values()).some(existing => existing.quoteId === quoteId)) return null;
      const stays = stayInventory(quote.offerId, quote.date, quote.nights);
      if (stays.some(stock => !stock || stock.totalUnits - stock.heldUnits - stock.soldUnits < quantity)) {
        return null;
      }

      const provider = providers.get(offers.get(quote.offerId)?.providerId ?? '');
      const reservationId = `res-${Math.random().toString(36).slice(2, 10)}`;
      const now = nowIso();
      const reservation: ReservationRecord = {
        id: reservationId,
        quoteId: quote.id,
        offerId: quote.offerId,
        providerId: provider?.id ?? '',
        travelerId,
        date: quote.date,
        nights: quote.nights,
        quantity,
        status: 'held',
        amountCents: quote.travelerTotalCents,
        serviceFeeCents: quote.serviceFeeCents,
        providerCommissionCents: quote.providerCommissionCents,
        providerCommissionRateBps: quote.providerCommissionRateBps,
        quoteVersion: quote.quoteVersion,
        createdAt: now,
        updatedAt: now,
        refundCents: 0,
        audit: [{ id: `audit-${Date.now()}`, at: now, event: 'reservation_held' }],
      };
      adjustStay(reservation, quantity, 0, now);
      reservations.set(reservationId, reservation);
      return reservation;
    },

    simulatePayment(reservationId, action) {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        throw new Error(`Reservation ${reservationId} not found`);
      }
      if (reservation.status !== 'held' && reservation.status !== 'pending_payment') {
        return reservation;
      }

      const now = nowIso();
      reservation.paymentStatus = action.status;
      reservation.gatewayReference = action.gatewayReference;
      reservation.updatedAt = now;
      reservation.audit.push({ id: `audit-${Date.now()}`, at: now, event: `payment_${action.status}` });

      if (action.status === 'approved') {
        reservation.status = 'confirmed';
        adjustStay(reservation, -reservation.quantity, reservation.quantity, now);
      } else if (action.status === 'rejected') {
        reservation.status = 'cancelled';
        adjustStay(reservation, -reservation.quantity, 0, now);
      } else {
        reservation.status = 'pending_payment';
      }
      return reservation;
    },

    cancelReservation(reservationId, { reason }) {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        throw new Error(`Reservation ${reservationId} not found`);
      }
      const now = nowIso();
      if (reservation.status === 'held' || reservation.status === 'pending_payment') {
        adjustStay(reservation, -reservation.quantity, 0, now);
      } else if (reservation.status === 'confirmed') {
        adjustStay(reservation, 0, -reservation.quantity, now);
      } else {
        return reservation;
      }
      reservation.status = 'cancelled';
      reservation.updatedAt = now;
      reservation.audit.push({ id: `audit-${Date.now()}`, at: now, event: `cancelled:${reason}` });
      return reservation;
    },

    // Mismas invariantes que connectical_admin_record_refund: pago aprobado, nunca más de lo
    // cobrado y el total solo después de cancelar.
    processRefund(reservationId, { amountCents }) {
      const reservation = reservations.get(reservationId);
      if (!reservation) {
        throw new Error(`Reservation ${reservationId} not found`);
      }
      if (
        reservation.paymentStatus !== 'approved' ||
        (reservation.status !== 'confirmed' && reservation.status !== 'cancelled')
      ) {
        throw new Error('refund_not_allowed');
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('invalid_refund_input');
      const refundTotal = reservation.refundCents + amountCents;
      if (refundTotal > reservation.amountCents) throw new Error('refund_exceeds_paid');
      if (refundTotal === reservation.amountCents && reservation.status === 'confirmed') {
        throw new Error('refund_requires_cancellation');
      }
      const now = nowIso();
      reservation.refundCents = refundTotal;
      if (refundTotal === reservation.amountCents) reservation.status = 'refunded';
      reservation.updatedAt = now;
      reservation.audit.push({ id: `audit-${Date.now()}`, at: now, event: `refund:${amountCents}` });
      return reservation;
    },

    updateProviderCommission(providerId, rateBps, effectiveFrom) {
      const provider = providers.get(providerId);
      if (!provider) {
        throw new Error(`Provider ${providerId} not found`);
      }
      provider.commissionRateBps = rateBps;
      provider.updatedAt = effectiveFrom;
      providers.set(providerId, provider);
      return provider;
    },

    listReservationsForProvider(providerId) {
      return Array.from(reservations.values()).filter(reservation => reservation.providerId === providerId);
    },

    listReservationsForAdmin() {
      return Array.from(reservations.values());
    },

    canAccessRecord,
  };
}
