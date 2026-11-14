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
    'upsertProviderOffer', 'publishProviderInventory',
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
    id: 'r1', quote_id: 'q1', offer_id: pousada.id, provider_id: 'p1', traveler_user_id: 'u1',
    service_date: '2099-01-10', nights: 2, quantity: 1, status: 'confirmed', amount_cents: 67840,
    service_fee_rate_bps: 600, service_fee_cents: 3840, provider_commission_rate_bps: 1000,
    provider_commission_cents: 6400, connectical_margin_cents: 3840, quote_version: 'connectical-brl-v1',
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
  mocked.createSharedReservationHold.mockResolvedValue(reservation({ status: 'held' }));
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
  await press(root, 'Reservar y aprobar pago simulado');
  expect(mocked.createSharedReservationHold).toHaveBeenCalledWith('q1', 'q1');
  expect(mocked.simulateSharedPayment).toHaveBeenCalledWith('r1', 'approved', 'pix');
  expect(hasText(root, 'Reserva confirmada: Confirmada · r1')).toBe(true);
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
  // Subtotal 640,00 − comisión 64,00; el cargo del turista no es del proveedor.
  expect(hasText(root, 'proveedor recibe neto sujeto a conciliación: R$ 576,00')).toBe(true);
  expect(hasText(root, 'Pousada Porto · 2099-01-10 → 2099-01-12 · ×1')).toBe(true);

  await press(root, 'Cancelada');
  expect(hasText(root, 'Reservas · 1')).toBe(true);
  expect(hasText(root, 'r-confirmed')).toBe(false);
  expect(hasText(root, 'Comisión proveedor (snapshot): R$ 64,00')).toBe(true);
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
  expect(hasText(root, 'Reservar y aprobar pago simulado')).toBe(false);
});
