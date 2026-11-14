import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { ReservationPortal } from '../src/screens/ReservationPortal';
import * as service from '../src/lib/reservationService';
import type { SharedOffer, SharedReservation } from '../src/lib/reservationService';

jest.mock('../src/lib/insforge', () => ({ insforge: null }));
jest.mock('../src/lib/reservationService', () => {
  const actual = jest.requireActual('../src/lib/reservationService');
  const names = [
    'cancelSharedReservation', 'createSharedQuote', 'createSharedReservationHold', 'getSharedRole',
    'listProviderInventory', 'listProviderOffers', 'listSharedOffers', 'listSharedProviders',
    'listSharedReservations', 'listSharedReservationEvents', 'signInSharedAccount',
    'signUpTravelerAccount', 'signOutSharedAccount', 'simulateSharedPayment',
    'upsertProviderOffer', 'publishProviderInventory', 'listOfferAvailability', 'recordSharedRefund',
    'publishProviderInventoryRange', 'setSharedProviderActive',
  ];
  return { ...actual, ...Object.fromEntries(names.map(name => [name, jest.fn()])) };
});

const mocked = service as jest.Mocked<typeof service>;

const pousada: SharedOffer = {
  id: 'offer-pousada', provider_id: 'p1', category: 'pousadas', title: 'Pousada Porto',
  base_price_cents: 32000, price_mode: 'night', currency: 'BRL', published: true,
};
const boat: SharedOffer = {
  id: 'offer-boat', provider_id: 'p1', category: 'barcos', title: 'Barco Azul',
  base_price_cents: 15000, price_mode: 'person', currency: 'BRL', published: true,
};

function reservation(overrides: Partial<SharedReservation>): SharedReservation {
  return {
    id: 'r1', quote_id: 'q1', offer_id: pousada.id, provider_id: 'p1',
    service_date: '2099-01-10', nights: 2, quantity: 1, status: 'confirmed', hold_expires_at: null,
    payment_status: 'approved', payment_method: 'card', amount_cents: 67840,
    service_fee_rate_bps: 600, service_fee_cents: 3840, provider_commission_rate_bps: 1000,
    provider_commission_cents: 6400, connectical_margin_cents: 3840, refund_cents: 0, quote_version: 'connectical-brl-v1',
    created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z',
    ...overrides,
  };
}

function flattenText(children: unknown): string {
  if (Array.isArray(children)) return children.map(flattenText).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}

function texts(root: ReactTestInstance) {
  return root.findAllByType(Text).map(node => flattenText(node.props.children));
}

function hasText(root: ReactTestInstance, label: string) {
  return texts(root).some(text => text.includes(label));
}

async function press(root: ReactTestInstance, label: string) {
  const node = root.findAllByType(Text).find(item => flattenText(item.props.children) === label);
  if (!node) throw new Error(`Text not found: ${label}\n${texts(root).join('\n')}`);
  let parent = node.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  if (!parent) throw new Error(`No press handler for ${label}`);
  await ReactTestRenderer.act(async () => parent?.props.onPress());
}

async function type(root: ReactTestInstance, label: string, value: string) {
  const input = root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];
  if (!input) throw new Error(`Input not found: ${label}`);
  await ReactTestRenderer.act(async () => input.props.onChangeText(value));
}

async function render(language: 'es' | 'pt' = 'es') {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ReservationPortal onClose={jest.fn()} language={language} />);
  });
  return renderer!.root;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.listSharedOffers.mockResolvedValue([pousada, boat]);
  mocked.listSharedReservations.mockResolvedValue([]);
  mocked.listSharedProviders.mockResolvedValue([]);
  mocked.listSharedReservationEvents.mockResolvedValue([]);
  mocked.listProviderOffers.mockResolvedValue([]);
  mocked.listProviderInventory.mockResolvedValue([]);
  mocked.listOfferAvailability.mockResolvedValue([]);
});

it('shows the sign-in form when there is no session', async () => {
  mocked.getSharedRole.mockResolvedValue(null);
  const root = await render();
  expect(hasText(root, 'Acceso de cuenta')).toBe(true);
  expect(mocked.listSharedOffers).not.toHaveBeenCalled();
});

it('validates traveler input before calling the backend', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  const root = await render();
  await press(root, 'Pousada Porto');
  await type(root, 'Entrada (AAAA-MM-DD)', '2020-01-01');
  await press(root, 'Crear cotización');
  expect(hasText(root, 'La fecha no puede ser anterior a hoy.')).toBe(true);

  await type(root, 'Entrada (AAAA-MM-DD)', '2099-01-10');
  await type(root, 'Noches', '45');
  await press(root, 'Crear cotización');
  expect(hasText(root, 'Noches: debe estar entre 1 y 30.')).toBe(true);
  expect(mocked.createSharedQuote).not.toHaveBeenCalled();
});

it('quotes a multi-night stay and books it with the quote id as idempotency key', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  mocked.createSharedQuote.mockResolvedValue({
    id: 'q1', offer_id: pousada.id, service_date: '2099-01-10', quantity: 1, nights: 2,
    service_fee_rate_bps: 800, subtotal_cents: 64000, service_fee_cents: 5120, traveler_total_cents: 69120,
    provider_commission_rate_bps: 1000, provider_commission_cents: 6400,
    quote_version: 'connectical-brl-v1', expires_at: '2099-01-01T00:15:00Z',
  });
  mocked.createSharedReservationHold.mockResolvedValue(reservation({ status: 'held', payment_status: null }));
  mocked.simulateSharedPayment.mockResolvedValue(reservation({ status: 'confirmed' }));
  const root = await render();

  await press(root, 'Pousada Porto');
  await type(root, 'Entrada (AAAA-MM-DD)', '2099-01-10');
  await type(root, 'Noches', '2');
  expect(hasText(root, 'Salida: 2099-01-12')).toBe(true);
  await press(root, '8%');
  await press(root, 'Crear cotización');
  expect(mocked.createSharedQuote).toHaveBeenCalledWith({
    offerId: pousada.id, serviceDate: '2099-01-10', quantity: 1, nights: 2, serviceFeeRateBps: 800,
  });
  expect(hasText(root, 'R$ 691,20')).toBe(true);

  await press(root, 'Pix · simulado');
  await press(root, 'Reservar con pago simulado');
  expect(mocked.createSharedReservationHold).toHaveBeenCalledWith('q1', 'q1');
  expect(mocked.simulateSharedPayment).toHaveBeenCalledWith('r1', 'approved', 'pix');
  expect(hasText(root, 'Reserva: Confirmada · r1')).toBe(true);
});

it('hides nights for per-person offers and always sends one night', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  mocked.createSharedQuote.mockRejectedValue(new service.ReservationError('x', 'inventory_unavailable'));
  const root = await render('pt');

  await press(root, 'Barco Azul');
  expect(root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Noites')).toHaveLength(0);
  await type(root, 'Data (AAAA-MM-DD)', '2099-02-01');
  await type(root, 'Pessoas', '4');
  await press(root, 'Criar cotação');
  expect(mocked.createSharedQuote).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4, nights: 1 }));
  expect(hasText(root, 'Não há vagas suficientes para essas datas.')).toBe(true);
});

it('lets providers publish offers in any category with a BRL price', async () => {
  mocked.getSharedRole.mockResolvedValue('provider');
  mocked.upsertProviderOffer.mockResolvedValue({ ...boat, id: 'new-offer' });
  mocked.publishProviderInventory.mockResolvedValue({
    offer_id: 'new-offer', service_date: '2099-03-01', total_units: 12, held_units: 0, sold_units: 0,
    version: 1, updated_at: '2099-01-01T00:00:00Z',
  });
  const root = await render();

  await type(root, 'Nombre de la oferta', '  Fiesta en barco  ');
  await press(root, 'Barcos');
  await press(root, 'por persona');
  await type(root, 'Precio BRL (ej. 320,00)', '1.234,56');
  await type(root, 'Fecha (AAAA-MM-DD)', '2099-03-01');
  await type(root, 'Cupo disponible para esa fecha', '12');
  await press(root, 'Publicar oferta y cupo');

  expect(mocked.upsertProviderOffer).toHaveBeenCalledWith({
    offerId: undefined, category: 'barcos', title: 'Fiesta en barco',
    basePriceCents: 123456, priceMode: 'person', published: true,
  });
  expect(mocked.publishProviderInventory).toHaveBeenCalledWith({
    offerId: 'new-offer', serviceDate: '2099-03-01', totalUnits: 12,
  });
  expect(hasText(root, 'Oferta y disponibilidad guardadas en la base compartida.')).toBe(true);
});

it('rejects a malformed provider price without calling the backend', async () => {
  mocked.getSharedRole.mockResolvedValue('provider');
  const root = await render();
  await type(root, 'Precio BRL (ej. 320,00)', '12,345');
  await press(root, 'Publicar oferta y cupo');
  expect(hasText(root, 'Precio BRL inválido. Usa el formato 1.234,56.')).toBe(true);
  expect(mocked.upsertProviderOffer).not.toHaveBeenCalled();
});

it('filters admin reservations by status and shows provider net without the traveler fee', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ id: 'r-confirmed' }),
    reservation({ id: 'r-cancelled', status: 'cancelled' }),
  ]);
  const root = await render();

  expect(hasText(root, 'Reservas · 2')).toBe(true);
  expect(hasText(root, 'Comisión proveedor de reservas confirmadas: R$ 64,00')).toBe(true);
  // Subtotal 640,00 − comisión 64,00; el cargo del turista no es del proveedor.
  expect(hasText(root, 'proveedor recibe neto sujeto a conciliación: R$ 576,00')).toBe(true);
  expect(hasText(root, 'Pousada Porto · 2099-01-10 → 2099-01-12 · ×1')).toBe(true);

  await press(root, 'Cancelada');
  expect(hasText(root, 'Reservas · 1')).toBe(true);
  expect(hasText(root, 'r-confirmed')).toBe(false);
  // Una reserva cancelada no genera comisión ni cargo de servicio.
  expect(hasText(root, 'Comisión proveedor de reservas confirmadas: R$ 0,00')).toBe(true);
  expect(hasText(root, 'Cargo de servicio de reservas confirmadas: R$ 0,00')).toBe(true);
});

it('shows collected, refunded and pending-review totals to admins', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ id: 'r-paid', payment_status: 'approved' }),
    reservation({ id: 'r-partial', status: 'cancelled', payment_status: 'approved', refund_cents: 10000 }),
    reservation({ id: 'r-refunded', status: 'refunded', payment_status: 'approved', refund_cents: 67840 }),
    reservation({ id: 'r-expired', status: 'expired', payment_status: null }),
  ]);
  const root = await render();
  expect(hasText(root, 'Cobrado (simulado): R$ 2.035,20 · Reembolsado (simulado): R$ 778,40')).toBe(true);
  expect(hasText(root, 'Cobrado neto de reembolsos: R$ 1.256,80')).toBe(true);
  expect(hasText(root, 'Canceladas con cobro sin reembolso completo: 1.')).toBe(true);
  expect(hasText(root, 'R$ 100,00 reembolsado')).toBe(true);
});

it('records an admin refund with a stable idempotency key across retries', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ id: 'r-paid', payment_status: 'approved' }),
    reservation({ id: 'r-unpaid', status: 'held', payment_status: null }),
  ]);
  mocked.recordSharedRefund
    .mockRejectedValueOnce(new Error('Network request failed'))
    .mockResolvedValueOnce(reservation({ id: 'r-paid', payment_status: 'approved', refund_cents: 5000 }));
  const root = await render();

  // Solo la reserva pagada ofrece reembolso.
  expect(root.findAll(node => node.props.accessibilityLabel === 'Reembolsar r-paid').length).toBeGreaterThan(0);
  expect(root.findAll(node => node.props.accessibilityLabel === 'Reembolsar r-unpaid')).toHaveLength(0);

  await press(root, 'Reembolsar');
  // Confirmada: el máximo deja un centavo, el total exige cancelar antes.
  expect(hasText(root, 'Máximo reembolsable: R$ 678,39')).toBe(true);
  expect(hasText(root, 'Para devolver el total, cancela primero la reserva.')).toBe(true);

  await press(root, 'Registrar reembolso');
  expect(hasText(root, 'Indica el motivo del reembolso.')).toBe(true);
  expect(mocked.recordSharedRefund).not.toHaveBeenCalled();

  await type(root, 'Importe a devolver (BRL)', '50,00');
  await type(root, 'Motivo', '  Gesto comercial  ');
  await press(root, 'Registrar reembolso');
  expect(hasText(root, 'Network request failed')).toBe(true);
  await press(root, 'Registrar reembolso');

  expect(mocked.recordSharedRefund).toHaveBeenCalledTimes(2);
  const [first, second] = mocked.recordSharedRefund.mock.calls.map(call => call[0]);
  expect(first).toEqual({ reservationId: 'r-paid', amountCents: 5000, reason: 'Gesto comercial', idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(hasText(root, 'Reembolso registrado.')).toBe(true);
  expect(hasText(root, 'Registrar reembolso simulado')).toBe(false);
});

it('uses a new idempotency key when the refund amount changes', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ id: 'r-cancelled', status: 'cancelled', payment_status: 'approved' }),
  ]);
  mocked.recordSharedRefund
    .mockRejectedValueOnce(service.toReservationError('connectical_admin_record_refund', 'refund_exceeds_paid'))
    .mockResolvedValueOnce(reservation({ status: 'refunded', payment_status: 'approved', refund_cents: 67840 }));
  const root = await render('pt');

  await press(root, 'Reembolsar');
  // Cancelada: se puede devolver el total.
  expect(hasText(root, 'Máximo reembolsável: R$ 678,40')).toBe(true);
  await type(root, 'Motivo', 'Cancelamento');
  await type(root, 'Valor a devolver (BRL)', '700,00');
  await press(root, 'Registrar reembolso');
  expect(hasText(root, 'O reembolso excede o que resta a devolver.')).toBe(true);
  await type(root, 'Valor a devolver (BRL)', '678,40');
  await press(root, 'Registrar reembolso');

  const [first, second] = mocked.recordSharedRefund.mock.calls.map(call => call[0]);
  expect(second.amountCents).toBe(67840);
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});

it('cancels a reservation with the role-specific reason', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  mocked.listSharedReservations.mockResolvedValue([reservation({})]);
  mocked.cancelSharedReservation.mockResolvedValue(reservation({ status: 'cancelled' }));
  const root = await render();
  await press(root, 'Cancelar');
  expect(mocked.cancelSharedReservation).toHaveBeenCalledWith('r1', 'traveler_request');
  expect(hasText(root, 'Reserva cancelada.')).toBe(true);
});

it('discards a quote that resolves after the traveler changed the inputs', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  let resolveQuote: (quote: service.SharedQuote) => void = () => {};
  mocked.createSharedQuote.mockReturnValue(new Promise(resolve => { resolveQuote = resolve; }));
  const root = await render();

  await press(root, 'Pousada Porto');
  await type(root, 'Entrada (AAAA-MM-DD)', '2099-01-10');
  await press(root, 'Crear cotización');
  await type(root, 'Noches', '3');
  await ReactTestRenderer.act(async () => resolveQuote({
    id: 'q-old', offer_id: pousada.id, service_date: '2099-01-10', quantity: 1, nights: 1,
    service_fee_rate_bps: 600, subtotal_cents: 32000, service_fee_cents: 1920, traveler_total_cents: 33920,
    provider_commission_rate_bps: 1000, provider_commission_cents: 3200,
    quote_version: 'connectical-brl-v1', expires_at: '2099-01-01T00:15:00Z',
  }));
  expect(hasText(root, 'R$ 339,20')).toBe(false);
  expect(hasText(root, 'Reservar con pago simulado')).toBe(false);
});

it('lets a traveler retry a pending simulated payment and labels admin events', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ status: 'pending_payment', payment_status: 'pending', hold_expires_at: '2099-01-01T12:05:00Z' }),
  ]);
  mocked.simulateSharedPayment.mockResolvedValue(reservation({ status: 'confirmed' }));
  const root = await render();
  expect(hasText(root, 'retención vence')).toBe(true);
  await press(root, 'Pagar (simulado)');
  expect(mocked.simulateSharedPayment).toHaveBeenCalledWith('r1', 'approved', 'card');
  expect(hasText(root, 'Reserva: Confirmada · r1')).toBe(true);
});

it('sends the chosen simulated outcome and hides payment actions from admins', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([reservation({ status: 'held', payment_status: null, hold_expires_at: '2099-01-01T12:05:00Z' })]);
  mocked.listSharedReservationEvents.mockResolvedValue([
    { id: 1, reservation_id: 'r1', event_type: 'payment_rejected', details: {}, created_at: '2099-01-01T12:00:00Z' },
    { id: 2, reservation_id: 'r1', event_type: 'custom_event', details: {}, created_at: '2099-01-01T12:01:00Z' },
  ]);
  const root = await render('pt');
  expect(hasText(root, 'Pagamento recusado (simulado)')).toBe(true);
  expect(hasText(root, 'custom_event')).toBe(true);
  expect(hasText(root, 'Pagar (simulado)')).toBe(false);
});

it('shows dates with free units and fills the date when one is chosen', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  const slot = { offer_id: pousada.id, version: 1, updated_at: '2099-01-01T00:00:00Z' };
  mocked.listOfferAvailability.mockResolvedValue([
    { ...slot, service_date: '2099-05-01', total_units: 2, held_units: 1, sold_units: 1 },
    { ...slot, service_date: '2099-05-02', total_units: 3, held_units: 0, sold_units: 1 },
  ]);
  const root = await render();
  await press(root, 'Pousada Porto');
  expect(mocked.listOfferAvailability).toHaveBeenCalledWith(pousada.id, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  expect(hasText(root, '2099-05-01 ·')).toBe(false);
  await press(root, '2099-05-02 · 2');
  const input = root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Entrada (AAAA-MM-DD)')[0];
  expect(input.props.value).toBe('2099-05-02');
});

it('says when an offer has no published availability', async () => {
  mocked.getSharedRole.mockResolvedValue('traveler');
  const root = await render();
  await press(root, 'Barco Azul');
  expect(hasText(root, 'El proveedor todavía no publicó cupo para esta oferta.')).toBe(true);
});

it('reuses the refund key after a failed reload even if the form is reopened or retyped', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  const paid = reservation({ id: 'r-cancelled', status: 'cancelled', payment_status: 'approved' });
  mocked.listSharedReservations
    .mockResolvedValueOnce([paid])
    .mockRejectedValueOnce(new Error('reload timeout'))
    .mockResolvedValue([{ ...paid, refund_cents: 5000 }]);
  mocked.recordSharedRefund.mockResolvedValue({ ...paid, refund_cents: 5000 });
  const root = await render();

  await press(root, 'Reembolsar');
  await type(root, 'Importe a devolver (BRL)', '50,00');
  await type(root, 'Motivo', 'Gesto');
  await press(root, 'Registrar reembolso');
  // El servidor registró el reembolso pero la recarga falló: la pantalla solo ve el error.
  expect(hasText(root, 'reload timeout')).toBe(true);

  await press(root, 'Reembolsar');
  await type(root, 'Importe a devolver (BRL)', '');
  await type(root, 'Importe a devolver (BRL)', '50,00');
  await type(root, 'Motivo', 'Gesto');
  await press(root, 'Registrar reembolso');

  const [first, second] = mocked.recordSharedRefund.mock.calls.map(call => call[0]);
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(hasText(root, 'Reembolso registrado.')).toBe(true);
});

it('publishes a range of nights in one call and keeps single dates on the single-date RPC', async () => {
  mocked.getSharedRole.mockResolvedValue('provider');
  mocked.upsertProviderOffer.mockResolvedValue({ ...pousada, id: 'offer-new' });
  mocked.publishProviderInventory.mockResolvedValue({} as never);
  mocked.publishProviderInventoryRange.mockResolvedValue(7);
  const root = await render();

  await type(root, 'Fecha (AAAA-MM-DD)', '2099-03-01');
  await type(root, 'Cupo disponible para esa fecha', '3');
  await type(root, 'Noches a publicar desde esa fecha', '7');
  await press(root, 'Publicar oferta y cupo');
  expect(mocked.publishProviderInventoryRange).toHaveBeenCalledWith({
    offerId: 'offer-new', fromDate: '2099-03-01', nights: 7, totalUnits: 3,
  });
  expect(mocked.publishProviderInventory).not.toHaveBeenCalled();

  await type(root, 'Noches a publicar desde esa fecha', '91');
  await press(root, 'Guardar cambios y cupo');
  expect(hasText(root, 'Noches a publicar desde esa fecha: debe estar entre 1 y 90.')).toBe(true);
  expect(mocked.publishProviderInventoryRange).toHaveBeenCalledTimes(1);

  await type(root, 'Noches a publicar desde esa fecha', '1');
  await press(root, 'Guardar cambios y cupo');
  expect(mocked.publishProviderInventory).toHaveBeenCalledWith({ offerId: 'offer-new', serviceDate: '2099-03-01', totalUnits: 3 });
});

it('lets admins pause and resume providers', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedProviders
    .mockResolvedValueOnce([{ id: 'p1', name: 'Pousada Sol', country_code: 'BR', commission_rate_bps: 1000, active: true }])
    .mockResolvedValue([{ id: 'p1', name: 'Pousada Sol', country_code: 'BR', commission_rate_bps: 1000, active: false }]);
  mocked.setSharedProviderActive.mockResolvedValue({ id: 'p1', name: 'Pousada Sol', country_code: 'BR', commission_rate_bps: 1000, active: false });
  const root = await render('pt');

  expect(hasText(root, 'Pausar impede novas cotações e publicações. As reservas existentes não mudam.')).toBe(true);
  await press(root, 'Pausar');
  expect(mocked.setSharedProviderActive).toHaveBeenCalledWith('p1', false);
  expect(hasText(root, 'Fornecedor atualizado.')).toBe(true);
  expect(hasText(root, '10% · pausado')).toBe(true);
  expect(root.findAll(node => node.props.accessibilityLabel === 'Reativar Pousada Sol').length).toBeGreaterThan(0);
});

it('separates holds, confirmed gross and provider net and flags inconsistent states for admins', async () => {
  mocked.getSharedRole.mockResolvedValue('admin');
  mocked.listSharedReservations.mockResolvedValue([
    reservation({ id: 'r-paid', payment_status: 'approved' }),
    reservation({ id: 'r-held', status: 'held', payment_status: null, hold_expires_at: '2099-01-01T00:10:00Z' }),
    reservation({ id: 'r-odd', status: 'confirmed', payment_status: 'pending' }),
  ]);
  const root = await render();
  expect(hasText(root, 'Retenidas 1 · confirmadas 2 · canceladas 0 · reembolsadas 0')).toBe(true);
  expect(hasText(root, 'Retenido o pago pendiente (no es ingreso): R$ 678,40')).toBe(true);
  expect(hasText(root, 'Bruto de reservas confirmadas: R$ 1.356,80')).toBe(true);
  // 2 × (678,40 − 38,40 − 64,00)
  expect(hasText(root, 'Neto proveedor de reservas confirmadas: R$ 1.152,00')).toBe(true);
  expect(hasText(root, 'Estados inconsistentes para revisar: 1')).toBe(true);
  expect(hasText(root, 'confirmada sin pago aprobado · r-odd')).toBe(true);
});
