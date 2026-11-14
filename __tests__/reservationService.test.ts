const mockRpc = jest.fn();

jest.mock('../src/lib/insforge', () => ({
  insforge: { database: { rpc: (...args: unknown[]) => mockRpc(...args) } },
}));

import { portalCopy } from '../src/i18n/portalCopy';
import {
  createSharedQuote,
  createSharedReservationHold,
  recordSharedRefund,
  ReservationError,
  toReservationError,
} from '../src/lib/reservationService';

beforeEach(() => mockRpc.mockReset());

it('passes quote arguments to the SQL function unchanged', async () => {
  mockRpc.mockResolvedValue({ data: { id: 'q1' }, error: null });
  await createSharedQuote({
    offerId: 'o1',
    serviceDate: '2026-12-01',
    quantity: 2,
    nights: 3,
    serviceFeeRateBps: 600,
  });
  expect(mockRpc).toHaveBeenCalledWith('connectical_create_quote', {
    p_offer_id: 'o1',
    p_service_date: '2026-12-01',
    p_quantity: 2,
    p_nights: 3,
    p_service_fee_rate_bps: 600,
  });
});

it('maps database exception codes to traveler-facing messages', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'inventory_unavailable' } });
  const error = await createSharedReservationHold('q1', 'k1').catch(e => e);
  expect(error).toBeInstanceOf(ReservationError);
  expect(error.code).toBe('inventory_unavailable');
  expect(error.message).toBe('No queda cupo suficiente para esas fechas.');
});

it('keeps unknown errors with the operation name and no code', () => {
  const error = toReservationError('connectical_create_quote', 'network timeout');
  expect(error.code).toBeNull();
  expect(error.message).toBe('InsForge connectical_create_quote: network timeout');
});

it('matches whole codes only', () => {
  expect(toReservationError('rpc', 'ERROR: hold_expired (P0001)').code).toBe('hold_expired');
  expect(toReservationError('rpc', 'custom_hold_expired_v2').code).toBeNull();
});

it('rejects an empty RPC response', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  await expect(createSharedReservationHold('q1', 'k1')).rejects.toThrow('respuesta vacía');
});

it('sends refunds to the admin RPC and maps its errors', async () => {
  mockRpc.mockResolvedValueOnce({ data: { id: 'r1', refund_cents: 5000 }, error: null });
  await recordSharedRefund({ reservationId: 'r1', amountCents: 5000, reason: 'Gesto', idempotencyKey: 'k1' });
  expect(mockRpc).toHaveBeenCalledWith('connectical_admin_record_refund', {
    p_reservation_id: 'r1',
    p_amount_cents: 5000,
    p_reason: 'Gesto',
    p_idempotency_key: 'k1',
  });

  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'refund_requires_cancellation' } });
  const error = await recordSharedRefund({ reservationId: 'r1', amountCents: 1, reason: 'x', idempotencyKey: 'k2' }).catch(e => e);
  expect(error.code).toBe('refund_requires_cancellation');
});

// El proyecto no incluye tipos de Node; basta con declarar lo que usa esta prueba.
declare const __dirname: string;
const fs: { readdirSync(path: string): string[]; readFileSync(path: string, encoding: 'utf8'): string } = require('fs');

it('has Spanish and Portuguese text for every error code raised by the migrations', () => {
  const dir = `${__dirname}/../supabase/migrations`;
  const raised = new Set<string>();
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql'))) {
    for (const match of fs.readFileSync(`${dir}/${file}`, 'utf8').matchAll(/raise exception '([a-z_]+)'/g)) {
      raised.add(match[1]);
    }
  }
  expect(raised.size).toBeGreaterThan(20);
  const missing = [...raised].filter(code => !(code in portalCopy.es.errors) || !(code in portalCopy.pt.errors));
  expect(missing).toEqual([]);
});
