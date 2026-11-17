import { voucherShareText } from '../src/utils/voucher';
import type { SharedReservation } from '../src/lib/reservationService';

const base: SharedReservation = {
  id: 'internal-id', quote_id: 'q', offer_id: 'o', provider_id: 'p', service_date: '2099-03-01', nights: 1, quantity: 3,
  status: 'confirmed', hold_expires_at: null, payment_status: 'approved', payment_method: 'pix', amount_cents: 28620,
  service_fee_rate_bps: 600, service_fee_cents: 1620, provider_commission_rate_bps: null, provider_commission_cents: null,
  connectical_margin_cents: 0, refund_cents: 0, quote_version: 'connectical-brl-v1', created_at: '', updated_at: '',
  voucher_code: 'BZ-2345-6789',
};

it('builds the voucher text in each language with the paid total', () => {
  expect(voucherShareText(base, 'Trilha', 'pt')).toBe(
    'Búzios Flow · Comprovante BZ-2345-6789\nTrilha\n2099-03-01 · ×3\nTotal: R$ 286,20\nMostre ao fornecedor ao chegar.',
  );
  expect(voucherShareText(base, 'Trail', 'en')).toContain('Voucher BZ-2345-6789');
});

it('shows the check-out date for multi-night stays', () => {
  expect(voucherShareText({ ...base, nights: 3 }, 'Pousada', 'es')).toContain('2099-03-01 → 2099-03-04');
});

it('has no voucher without a code or once the reservation is no longer confirmed', () => {
  expect(voucherShareText({ ...base, voucher_code: null }, 'x', 'es')).toBeNull();
  expect(voucherShareText({ ...base, status: 'cancelled' }, 'x', 'es')).toBeNull();
});
