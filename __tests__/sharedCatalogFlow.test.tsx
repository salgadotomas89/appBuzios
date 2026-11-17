import React from 'react';
import { Linking, Text } from 'react-native';
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
  listActivePromotions: jest.fn(async () => []),
}));

jest.mock('../src/lib/platformService', () => ({
  listOfferMedia: jest.fn(async () => []),
  listFeed: jest.fn(async () => []),
  listProviderProfiles: jest.fn(async () => []),
}));

const mocked = service as jest.Mocked<typeof service>;
const mockedPlatform = jest.requireMock('../src/lib/platformService') as { listOfferMedia: jest.Mock; listFeed: jest.Mock; listProviderProfiles: jest.Mock };

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

test('shows the provider photos with their alt text in the offer detail', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-photo', provider_id: 'p-1', category: 'barcos', title: 'Escuna com fotos',
    base_price_cents: 9000, price_mode: 'person', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([]);
  mockedPlatform.listOfferMedia.mockResolvedValueOnce([
    { id: 'm1', offer_id: 'o-photo', url: 'https://cdn.example/proa.jpg', content_type: 'image/jpeg', width: 1200, height: 800, alt_text: 'Proa da escuna', position: 0 },
  ]);
  const root = await renderApp();
  await pressText(root, 'Escuna com fotos');
  const images = root.findAll(node => node.props.accessibilityLabel === 'Proa da escuna' && node.props.source);
  expect(images.length).toBeGreaterThan(0);
  expect(images[0].props.source).toEqual({ uri: 'https://cdn.example/proa.jpg' });
});

test('filters shared offers by a date with free units', async () => {
  mocked.listSharedOffers.mockResolvedValue([
    { id: 'o-free', provider_id: 'p-1', category: 'barcos', title: 'Con cupo', base_price_cents: 9000, price_mode: 'person', currency: 'BRL', published: true },
    { id: 'o-full', provider_id: 'p-1', category: 'barcos', title: 'Sin cupo ese día', base_price_cents: 9000, price_mode: 'person', currency: 'BRL', published: true },
  ]);
  const today = jest.requireActual('../src/utils/portalInput').buziosIsoDate();
  mocked.listPublishedAvailability.mockResolvedValue([
    { offer_id: 'o-free', service_date: today, total_units: 4, held_units: 0, sold_units: 0, version: 1, updated_at: '' },
    { offer_id: 'o-full', service_date: today, total_units: 2, held_units: 1, sold_units: 1, version: 1, updated_at: '' },
  ]);
  const root = await renderApp();
  await pressText(root, 'Explorar ofertas');
  expect(hasText(root, 'Sin cupo ese día')).toBe(true);
  await pressText(root, 'Elegir fecha');
  expect(hasText(root, 'Con cupo')).toBe(true);
  expect(hasText(root, 'Sin cupo ese día')).toBe(false);
  expect(hasText(root, 'La fecha filtra solo ofertas con cupo publicado; los ejemplos no tienen calendario.')).toBe(true);
});

test('shows moderated provider news on the home screen and opens the official permalink', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-1', provider_id: 'p-1', category: 'actividades', title: 'Trilha do sol',
    base_price_cents: 9000, price_mode: 'person', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([]);
  mockedPlatform.listFeed.mockResolvedValueOnce([
    { id: 'post-1', offer_id: 'o-1', kind: 'story', body: 'Vagas hoje ao nascer do sol', link_url: 'https://www.instagram.com/reel/AbCdEf123/', link_platform: 'instagram', published_at: '2099-01-01T00:00:00Z', visible_until: '2099-01-02T00:00:00Z' },
    // Post de una oferta que el catálogo no conoce (p. ej. ya no publicada): no se muestra.
    { id: 'post-2', offer_id: 'o-unknown', kind: 'post', body: 'Oferta desconocida', link_url: null, link_platform: null, published_at: '2099-01-01T00:00:00Z', visible_until: null },
  ]);
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const root = await renderApp();

  expect(hasText(root, 'Novedades en Búzios')).toBe(true);
  expect(hasText(root, 'Historia · Trilha do sol')).toBe(true);
  expect(hasText(root, 'Vagas hoje ao nascer do sol')).toBe(true);
  expect(hasText(root, 'Oferta desconocida')).toBe(false);
  await pressText(root, 'Ver en Instagram');
  expect(openURL).toHaveBeenCalledWith('https://www.instagram.com/reel/AbCdEf123/');
  await pressText(root, 'Ver oferta');
  expect(hasText(root, 'Trilha do sol')).toBe(true);
  openURL.mockRestore();
});

test('prices shared offers with the promotion active today and keeps the list price visible', async () => {
  const { buziosIsoDate } = jest.requireActual('../src/utils/portalInput');
  const today = buziosIsoDate();
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-1', provider_id: 'p-1', category: 'restaurantes', title: 'Jantar no cais',
    base_price_cents: 20000, price_mode: 'person', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([]);
  mocked.listActivePromotions.mockResolvedValueOnce([
    { offer_id: 'o-1', percent_off_bps: 2500, starts_on: today, ends_on: today, label: 'Semana gastronómica' },
  ]);
  const root = await renderApp();
  expect(hasText(root, '25%')).toBe(true);
});

test('shows who offers a shared offer, their neighborhood and languages', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-1', provider_id: 'p-1', category: 'pousadas', title: 'Quarto vista mar',
    base_price_cents: 32000, price_mode: 'night', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([]);
  mockedPlatform.listProviderProfiles.mockResolvedValueOnce([
    { provider_id: 'p-1', name: 'Pousada Mar Azul', public_description: 'Pousada familiar com café da manhã', neighborhood: 'Geribá', languages: ['pt', 'es'] },
  ]);
  const root = await renderApp();
  expect(mockedPlatform.listProviderProfiles).toHaveBeenCalledWith(['p-1']);
  await pressText(root, 'Quarto vista mar');
  expect(hasText(root, 'Ofrecido por Pousada Mar Azul')).toBe(true);
  expect(hasText(root, 'Pousada familiar com café da manhã')).toBe(true);
  expect(hasText(root, 'Geribá')).toBe(true);
  expect(hasText(root, 'Portugués, Español')).toBe(true);
});

test('keeps the shared catalog when an optional extra throws synchronously', async () => {
  mocked.listSharedOffers.mockResolvedValue([{
    id: 'o-1', provider_id: 'p-1', category: 'barcos', title: 'Escuna real',
    base_price_cents: 12550, price_mode: 'person', currency: 'BRL', published: true,
  }]);
  mocked.listPublishedAvailability.mockResolvedValue([]);
  mockedPlatform.listFeed.mockImplementationOnce(() => { throw new Error('boom'); });
  const root = await renderApp();
  expect(hasText(root, 'OFERTA PUBLICADA · SE RESERVA EN EL PORTAL CON PAGO SIMULADO')).toBe(true);
});
