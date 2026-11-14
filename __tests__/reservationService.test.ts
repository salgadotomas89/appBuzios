const mockRpc = jest.fn();

jest.mock('../src/lib/insforge', () => ({
  insforge: { database: { rpc: (...args: unknown[]) => mockRpc(...args) } },
}));

import {
  createSharedQuote,
  createSharedReservationHold,
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
