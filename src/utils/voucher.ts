import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import type { SharedReservation } from '../lib/reservationService';
import { brlFromCents } from './format';
import { addDays } from './portalInput';

// Texto del comprobante para compartir (WhatsApp, correo, notas). Solo lleva lo que el turista ya ve en su reserva:
// ni identificadores internos ni datos del proveedor. Sin código no hay comprobante.
export function voucherShareText(reservation: SharedReservation, offerTitle: string, language: Language): string | null {
  if (!reservation.voucher_code || reservation.status !== 'confirmed') return null;
  const nights = reservation.nights ?? 1;
  const dates = nights > 1 ? `${reservation.service_date} → ${addDays(reservation.service_date, nights)}` : reservation.service_date;
  return portalCopy[language].vouchers.shareMessage
    .replace('{code}', reservation.voucher_code)
    .replace('{offer}', offerTitle)
    .replace('{dates}', dates)
    .replace('{quantity}', String(reservation.quantity))
    .replace('{total}', brlFromCents(reservation.amount_cents));
}
