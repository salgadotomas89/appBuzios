import type { SharedReservation } from '../lib/reservationService';

// Totales del panel de administración. Las comisiones y cargos solo cuentan para reservas
// confirmadas: una retención, una reserva vencida o una cancelada no generan ingreso.
// El cobro se mide por pago aprobado, aunque luego se cancele, porque ese dinero entró y
// solo sale con un reembolso registrado.

type TotalsInput = Pick<
  SharedReservation,
  | 'status'
  | 'payment_status'
  | 'amount_cents'
  | 'refund_cents'
  | 'service_fee_cents'
  | 'provider_commission_cents'
  | 'connectical_margin_cents'
>;

export type ReservationTotals = {
  confirmedCount: number;
  commissionCents: number;
  connecticalFeeCents: number;
  collectedCents: number;
  refundedCents: number;
  netCollectedCents: number;
  // Canceladas con pago aprobado y reembolso incompleto: requieren decisión humana.
  pendingRefundReviewCount: number;
};

export function summarizeReservations(reservations: TotalsInput[]): ReservationTotals {
  const totals: ReservationTotals = {
    confirmedCount: 0,
    commissionCents: 0,
    connecticalFeeCents: 0,
    collectedCents: 0,
    refundedCents: 0,
    netCollectedCents: 0,
    pendingRefundReviewCount: 0,
  };
  for (const reservation of reservations) {
    const refunded = reservation.refund_cents;
    if (reservation.status === 'confirmed') {
      totals.confirmedCount += 1;
      totals.commissionCents += reservation.provider_commission_cents;
      totals.connecticalFeeCents += reservation.connectical_margin_cents;
    }
    if (reservation.payment_status === 'approved') {
      totals.collectedCents += reservation.amount_cents;
      if (reservation.status === 'cancelled' && refunded < reservation.amount_cents) {
        totals.pendingRefundReviewCount += 1;
      }
    }
    totals.refundedCents += refunded;
  }
  totals.netCollectedCents = totals.collectedCents - totals.refundedCents;
  return totals;
}

export type RefundAllowance = {
  // Máximo que se puede registrar ahora; 0 si la reserva no admite reembolso.
  maxCents: number;
  // Una reserva confirmada solo admite reembolsos parciales hasta que se cancele.
  fullRequiresCancellation: boolean;
};

// Refleja las reglas de connectical_admin_record_refund para no ofrecer acciones que el
// servidor rechazaría. El servidor sigue siendo la autoridad.
export function refundAllowance(
  reservation: Pick<SharedReservation, 'status' | 'payment_status' | 'amount_cents' | 'refund_cents'>,
): RefundAllowance {
  const remaining = reservation.amount_cents - reservation.refund_cents;
  if (reservation.payment_status !== 'approved' || remaining <= 0) {
    return { maxCents: 0, fullRequiresCancellation: false };
  }
  if (reservation.status === 'cancelled') return { maxCents: remaining, fullRequiresCancellation: false };
  if (reservation.status === 'confirmed') {
    return { maxCents: remaining - 1, fullRequiresCancellation: true };
  }
  return { maxCents: 0, fullRequiresCancellation: false };
}

// Clave de idempotencia para RPC que la exigen como uuid. No es un secreto: solo evita
// duplicar una solicitud al reintentarla, así que basta con aleatoriedad no criptográfica
// cuando el entorno no expone crypto.getRandomValues.
export function newIdempotencyKey(random: () => number = Math.random): string {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues && random === Math.random) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(random() * 256);
  }
  bytes[6] = 0x40 + (bytes[6] % 16);
  bytes[8] = 0x80 + (bytes[8] % 64);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
