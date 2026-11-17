import type { SharedReservation } from '../lib/reservationService';
import { addDays } from './portalInput';

// Agenda del turista: reservas confirmadas o a la espera de pago agrupadas por día de servicio, desde hoy. Una
// estancia de varias noches aparece cada noche (con "noche n de N"); las canceladas, vencidas o reembolsadas no.
export type AgendaItem = { reservation: SharedReservation; night: number; nights: number };
export type AgendaDay = { date: string; items: AgendaItem[] };

const ACTIVE: SharedReservation['status'][] = ['confirmed', 'held', 'pending_payment'];

export function buildAgenda(reservations: SharedReservation[], today: string, horizonDays = 60): AgendaDay[] {
  const last = addDays(today, horizonDays);
  const days = new Map<string, AgendaItem[]>();
  for (const reservation of reservations) {
    if (!ACTIVE.includes(reservation.status)) continue;
    const nights = Math.max(1, reservation.nights ?? 1);
    for (let night = 1; night <= nights; night += 1) {
      const date = addDays(reservation.service_date, night - 1);
      if (date < today || date > last) continue;
      days.set(date, [...(days.get(date) ?? []), { reservation, night, nights }]);
    }
  }
  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({
      date,
      // Primero lo confirmado; dentro, por orden de creación para que la lista no salte entre recargas.
      items: items.sort(
        (left, right) =>
          Number(right.reservation.status === 'confirmed') - Number(left.reservation.status === 'confirmed') ||
          left.reservation.created_at.localeCompare(right.reservation.created_at),
      ),
    }));
}
