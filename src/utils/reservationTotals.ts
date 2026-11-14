import type { SharedReservation } from '../lib/reservationService';

// Totales del panel de administración. Las comisiones y cargos solo cuentan para reservas
// confirmadas: una retención, una reserva vencida o una cancelada no generan ingreso.
// El cobro se mide por pago aprobado, aunque luego se cancele, porque ese dinero entró y
// solo sale con un reembolso registrado. Lo retenido o pendiente de pago se informa aparte y
// nunca se suma a ingresos.

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
  heldCount: number;
  // Retenidas o con pago pendiente: compromiso de cupo, no ingreso.
  heldAmountCents: number;
  confirmedCount: number;
  // Total pagado por el turista en reservas confirmadas (subtotal + cargo de servicio).
  confirmedGrossCents: number;
  // Lo que corresponde al proveedor en reservas confirmadas: bruto − cargo de servicio − comisión.
  providerNetCents: number;
  cancelledCount: number;
  refundedCount: number;
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
    heldCount: 0,
    heldAmountCents: 0,
    confirmedCount: 0,
    confirmedGrossCents: 0,
    providerNetCents: 0,
    cancelledCount: 0,
    refundedCount: 0,
    commissionCents: 0,
    connecticalFeeCents: 0,
    collectedCents: 0,
    refundedCents: 0,
    netCollectedCents: 0,
    pendingRefundReviewCount: 0,
  };
  for (const reservation of reservations) {
    const refunded = reservation.refund_cents;
    if (reservation.status === 'held' || reservation.status === 'pending_payment') {
      totals.heldCount += 1;
      totals.heldAmountCents += reservation.amount_cents;
    } else if (reservation.status === 'confirmed') {
      totals.confirmedCount += 1;
      totals.confirmedGrossCents += reservation.amount_cents;
      totals.providerNetCents +=
        reservation.amount_cents - reservation.service_fee_cents - reservation.provider_commission_cents;
      totals.commissionCents += reservation.provider_commission_cents;
      totals.connecticalFeeCents += reservation.connectical_margin_cents;
    } else if (reservation.status === 'cancelled') {
      totals.cancelledCount += 1;
    } else if (reservation.status === 'refunded') {
      totals.refundedCount += 1;
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

export type ReservationInconsistency =
  | 'confirmed_without_payment'
  | 'payment_approved_but_not_settled'
  | 'refund_exceeds_amount'
  | 'refund_without_payment'
  | 'refunded_incomplete'
  | 'fees_exceed_amount';

// Estados que las funciones SQL no deberían producir. Si aparecen, hay un error o una edición
// manual de datos: la pantalla los muestra para que alguien los revise antes de conciliar.
export function findInconsistencies(
  reservations: Array<TotalsInput & Pick<SharedReservation, 'id'>>,
): Array<{ id: string; code: ReservationInconsistency }> {
  const found: Array<{ id: string; code: ReservationInconsistency }> = [];
  for (const reservation of reservations) {
    const add = (code: ReservationInconsistency) => found.push({ id: reservation.id, code });
    const approved = reservation.payment_status === 'approved';
    if (reservation.status === 'confirmed' && !approved) add('confirmed_without_payment');
    if ((reservation.status === 'held' || reservation.status === 'pending_payment') && approved) {
      add('payment_approved_but_not_settled');
    }
    if (reservation.refund_cents > reservation.amount_cents) add('refund_exceeds_amount');
    if (reservation.refund_cents > 0 && !approved) add('refund_without_payment');
    if (reservation.status === 'refunded' && reservation.refund_cents !== reservation.amount_cents) {
      add('refunded_incomplete');
    }
    if (reservation.service_fee_cents + reservation.provider_commission_cents > reservation.amount_cents) {
      add('fees_exceed_amount');
    }
  }
  return found;
}
