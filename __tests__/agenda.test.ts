import { buildAgenda } from '../src/utils/agenda';
import type { SharedReservation } from '../src/lib/reservationService';

function reservation(overrides: Partial<SharedReservation>): SharedReservation {
  return {
    id: 'r', quote_id: 'q', offer_id: 'o', provider_id: 'p', service_date: '2099-01-10', nights: 1, quantity: 1,
    status: 'confirmed', hold_expires_at: null, payment_status: 'approved', payment_method: 'pix', amount_cents: 1000,
    service_fee_rate_bps: 600, service_fee_cents: 60, provider_commission_rate_bps: null, provider_commission_cents: null,
    connectical_margin_cents: 0, refund_cents: 0, quote_version: 'v1', created_at: '2099-01-01T00:00:00Z', updated_at: '', ...overrides,
  };
}

it('spreads a stay over each night and groups by day in order', () => {
  const days = buildAgenda([
    reservation({ id: 'stay', service_date: '2099-01-10', nights: 3 }),
    reservation({ id: 'boat', service_date: '2099-01-11', created_at: '2099-01-02T00:00:00Z' }),
  ], '2099-01-09');
  expect(days.map(day => [day.date, day.items.map(item => `${item.reservation.id}:${item.night}/${item.nights}`)])).toEqual([
    ['2099-01-10', ['stay:1/3']],
    ['2099-01-11', ['stay:2/3', 'boat:1/1']],
    ['2099-01-12', ['stay:3/3']],
  ]);
});

it('drops past nights, inactive reservations and dates beyond the horizon', () => {
  const days = buildAgenda([
    reservation({ id: 'ongoing', service_date: '2099-01-08', nights: 3 }),
    reservation({ id: 'cancelled', status: 'cancelled' }),
    reservation({ id: 'expired', status: 'expired' }),
    reservation({ id: 'far', service_date: '2099-06-01' }),
  ], '2099-01-09', 30);
  expect(days.map(day => [day.date, day.items.map(item => item.reservation.id)])).toEqual([
    ['2099-01-09', ['ongoing']],
    ['2099-01-10', ['ongoing']],
  ]);
});

it('lists confirmed bookings before those awaiting payment on the same day', () => {
  const [day] = buildAgenda([
    reservation({ id: 'held', status: 'held', created_at: '2099-01-01T00:00:00Z' }),
    reservation({ id: 'paid', created_at: '2099-01-05T00:00:00Z' }),
  ], '2099-01-09');
  expect(day.items.map(item => item.reservation.id)).toEqual(['paid', 'held']);
});
