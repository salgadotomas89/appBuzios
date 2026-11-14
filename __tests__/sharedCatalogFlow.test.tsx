import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import App from '../App';
import * as service from '../src/lib/reservationService';

// Recorrido con SHARED_CATALOG_ENABLED encendido; flow.test.tsx cubre el flag apagado.
jest.mock('../src/config/featureFlags', () => ({ SHARED_CATALOG_ENABLED: true }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = require('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactNative.createElement(ReactNative.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));
jest.mock('../src/lib/insforge', () => ({ insforge: {}, isInsforgeConfigured: () => true }));
jest.mock('../src/lib/reservationService', () => ({
  ...jest.requireActual('../src/lib/reservationService'),
  listSharedOffers: jest.fn(),
  listPublishedAvailability: jest.fn(),
  getSharedRole: jest.fn(async () => null),
}));

const mocked = service as jest.Mocked<typeof service>;

function flattenText(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join('');
  return '';
}

function hasText(root: ReactTestInstance, label: string) {
  return root.findAllByType(Text).some(node => flattenText(node.props.children).includes(label));
}

async function pressText(root: ReactTestInstance, label: string) {
  const textNode = root.findAllByType(Text).find(node => flattenText(node.props.children) === label);
  if (!textNode) throw new Error(`Text not found: ${label}`);
  let parent = textNode.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  await ReactTestRenderer.act(async () => parent?.props.onPress?.());
}

async function renderApp() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  return renderer.root;
}

beforeEach(() => jest.clearAllMocks());

test('lists published offers and sends them to the portal instead of the demo trip', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-1', provider_id: 'p-1', category: 'barcos', title: 'Escuna real',
    base_price_cents: 12550, price_mode: 'person', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([{
    offer_id: 'o-1', service_date: '2099-01-01', total_units: 4, held_units: 1, sold_units: 0,
    version: 1, updated_at: '2099-01-01T00:00:00Z',
  }]);
  const root = await renderApp();

  expect(mocked.listPublishedAvailability).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ['o-1']);
  expect(hasText(root, '7 experiencias para descubrir')).toBe(true);
  expect(hasText(root, 'OFERTA PUBLICADA · SE RESERVA EN EL PORTAL CON PAGO SIMULADO')).toBe(true);

  await pressText(root, 'Escuna real');
  expect(hasText(root, 'Cupo publicado por el proveedor')).toBe(true);
  expect(hasText(root, 'Política de cancelación pendiente de definir por Connectical.')).toBe(true);
  expect(hasText(root, 'Agregar a Mi viaje')).toBe(false);

  await pressText(root, 'Reservar en el portal');
  expect(hasText(root, 'Reservas compartidas')).toBe(true);
  expect(hasText(root, 'Acceso de cuenta')).toBe(true);
});

test('falls back to the demo catalog and says so when published offers cannot be read', async () => {
  mocked.listSharedOffers.mockRejectedValue(new Error('network down'));
  const root = await renderApp();

  expect(hasText(root, 'No se pudieron leer las ofertas publicadas; se muestra solo el catálogo de ejemplo.')).toBe(true);
  expect(hasText(root, '6 experiencias para descubrir')).toBe(true);
  expect(mocked.listPublishedAvailability).not.toHaveBeenCalled();
});

test('does not mark offers as sold out when the inventory read may be truncated', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-late', provider_id: 'p-1', category: 'pousadas', title: 'Pousada tardia',
    base_price_cents: 30000, price_mode: 'night', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue(Array.from({ length: 1000 }, (_, index) => ({
    offer_id: 'other', service_date: `2099-01-${String((index % 28) + 1).padStart(2, '0')}`,
    total_units: 0, held_units: 0, sold_units: 0, version: 1, updated_at: '2099-01-01T00:00:00Z',
  })));
  const root = await renderApp();
  await pressText(root, 'Pousada tardia');
  expect(hasText(root, 'Cupo por confirmar en el portal')).toBe(true);
  expect(hasText(root, 'Sin cupo publicado')).toBe(false);
  expect(hasText(root, 'Reservar en el portal')).toBe(true);
});
