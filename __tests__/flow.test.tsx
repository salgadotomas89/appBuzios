import React from 'react';
import { Linking, Text } from 'react-native';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import App from '../App';
import { addDays, buziosIsoDate } from '../src/utils/portalInput';

const mockStorage = new Map<string, string>();

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
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

jest.mock('../src/lib/insforge', () => ({
  insforge: {},
  checkInsforgeConnection: jest.fn(() => Promise.resolve(true)),
}));

function pressText(root: ReactTestInstance, label: string) {
  const textNode = root
    .findAllByType(Text)
    .find(node => flattenText(node.props.children).includes(label));
  if (!textNode) throw new Error(`Text not found: ${label}`);

  let parent = textNode.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  if (!parent) throw new Error(`Press handler not found for text: ${label}`);

  ReactTestRenderer.act(() => parent?.props.onPress?.());
}

function pressAccessible(root: ReactTestInstance, label: string, index = 0) {
  const button = root
    .findAll(node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
    )
    .filter(node => node.props.accessibilityLabel === label)[index];
  if (!button) throw new Error(`Button not found: ${label}`);
  ReactTestRenderer.act(() => button.props.onPress?.());
}

function hasText(root: ReactTestInstance, label: string) {
  return root.findAllByType(Text).some(node => flattenText(node.props.children).includes(label));
}

function flattenText(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join('');
  return '';
}

async function renderApp(clearStorage = true) {
  if (clearStorage) mockStorage.clear();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

test('books a boat demo, edits quantity and reopens its confirmation from My Trip', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'Barcos');
  expect(hasText(root, '1 ofertas de ejemplo')).toBe(true);
  pressText(root, 'Escuna por 12 playas');
  pressText(root, 'Agregar a Mi viaje');

  pressAccessible(root, 'Aumentar cantidad');
  expect(hasText(root, 'R$ 178,00')).toBe(true);
  expect(hasText(root, 'R$ 10,68')).toBe(true);
  expect(hasText(root, 'R$ 188,68')).toBe(true);

  pressText(root, 'Confirmar reserva demo');
  expect(hasText(root, 'BF-DEMO-001')).toBe(true);
  expect(hasText(root, 'sin pago ni disponibilidad real')).toBe(true);

  pressText(root, 'Volver a Mi viaje');
  expect(hasText(root, 'Reservas de demostración')).toBe(true);
  expect(hasText(root, 'BF-DEMO-001')).toBe(true);
});

test('prices lodging by nights and removes it from the trip', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'Pousadas');
  pressText(root, 'Pousada Maravista');
  pressText(root, 'Agregar a Mi viaje');
  pressAccessible(root, 'Sumar una noche');

  expect(hasText(root, 'R$ 640,00')).toBe(true);
  expect(hasText(root, 'R$ 38,40')).toBe(true);
  expect(hasText(root, 'R$ 678,40')).toBe(true);

  pressText(root, 'Quitar');
  expect(hasText(root, 'Tu viaje empieza aquí')).toBe(true);
});

test('switches language and keeps unavailable listings out of the trip', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'PT');
  expect(hasText(root, 'Sua viagem a Búzios')).toBe(true);
  pressText(root, 'Buggy');
  pressText(root, 'Buggy ao pôr do sol');

  expect(hasText(root, 'Sem disponibilidade')).toBe(true);
  expect(hasText(root, 'Faltam informações para reservar')).toBe(true);
  expect(hasText(root, 'Adicionar à Minha viagem')).toBe(false);
});

test('localizes the account tab and stepper labels in Portuguese', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'PT');
  // La cuenta, las reservas reales y los paneles están en la pestaña «Minha conta» de la barra inferior.
  expect(hasText(root, 'Minha conta')).toBe(true);
  expect(hasText(root, 'Reservas compartilhadas · acesso de operações')).toBe(false);
  pressText(root, 'Pousadas');
  pressText(root, 'Pousada Maravista');
  const labels = root
    .findAll(node => typeof node.props.onPress === 'function' && typeof node.props.accessibilityLabel === 'string')
    .map(node => node.props.accessibilityLabel);
  expect(labels).toEqual(expect.arrayContaining([
    'Dia anterior', 'Próximo dia', 'Aumentar quantidade', 'Adicionar uma noite',
  ]));
  expect(labels).not.toContain('Aumentar cantidad');
});

test('filters the catalog across all four categories', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'Explorar ofertas');
  expect(hasText(root, '6 ofertas de ejemplo')).toBe(true);

  pressText(root, 'Pousadas');
  expect(hasText(root, '2 ofertas de ejemplo')).toBe(true);
  pressText(root, 'Barcos');
  expect(hasText(root, '1 ofertas de ejemplo')).toBe(true);
  pressText(root, 'Noche');
  expect(hasText(root, '1 ofertas de ejemplo')).toBe(true);
  pressText(root, 'Buggy');
  expect(hasText(root, '2 ofertas de ejemplo')).toBe(true);
});

test('updates the itinerary date selected in offer detail', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'Pousadas');
  pressText(root, 'Pousada Maravista');
  pressAccessible(root, 'Día siguiente');
  pressText(root, 'Agregar a Mi viaje');

  // La app parte del día de Búzios, no del día local del dispositivo (difieren de 21:00 a medianoche).
  const nextDate = new Date(`${addDays(buziosIsoDate(), 1)}T12:00:00`);
  const expectedDate = `${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][nextDate.getDay()]}, ${nextDate.getDate()} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][nextDate.getMonth()]}`;
  expect(hasText(root, expectedDate)).toBe(true);
});

test('keeps the confirmed quote unchanged when the future fee scenario changes', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'Barcos');
  pressText(root, 'Escuna por 12 playas');
  pressText(root, 'Agregar a Mi viaje');
  pressText(root, 'Confirmar reserva demo');
  pressText(root, 'Volver a Mi viaje');

  pressText(root, 'Explorar ofertas');
  pressText(root, 'Pousada Maravista');
  pressText(root, 'Agregar a Mi viaje');
  pressText(root, 'Ensayo interno de precios');
  pressText(root, '8%');
  expect(hasText(root, 'R$ 345,60')).toBe(true);

  pressText(root, 'BF-DEMO-001');
  expect(hasText(root, 'svc600')).toBe(true);
  expect(hasText(root, 'R$ 94,34')).toBe(true);
});

test('restores an itinerary and a confirmed booking after remounting the app', async () => {
  const firstRender = await renderApp();
  pressText(firstRender.root, 'Pousadas');
  pressText(firstRender.root, 'Pousada Maravista');
  pressText(firstRender.root, 'Agregar a Mi viaje');
  ReactTestRenderer.act(() => firstRender.unmount());

  const reopened = await renderApp(false);
  pressText(reopened.root, 'Mi viaje');
  expect(hasText(reopened.root, 'Pousada Maravista')).toBe(true);
  pressText(reopened.root, 'Confirmar reserva demo');
  ReactTestRenderer.act(() => reopened.unmount());

  const reopenedAgain = await renderApp(false);
  pressText(reopenedAgain.root, 'Mi viaje');
  expect(hasText(reopenedAgain.root, 'BF-DEMO-001')).toBe(true);
  expect(hasText(reopenedAgain.root, 'R$ 339,20')).toBe(true);
});
test('does not let a stored past date be confirmed until it is moved to today or later', async () => {
  mockStorage.clear();
  mockStorage.set('@buzios-flow/demo-state-v1', JSON.stringify({
    schemaVersion: 1,
    tripItems: [{ id: 'old', offerId: 'pousada-geriba', date: '2020-01-01', quantity: 1, nights: 1 }],
    bookings: [],
    serviceFeeRate: 600,
  }));
  const renderer = await renderApp(false);
  const root = renderer.root;
  pressText(root, 'Mi viaje');

  expect(hasText(root, 'Esta fecha ya pasó en Búzios. Elige otra para confirmar.')).toBe(true);
  pressText(root, 'Confirmar reserva demo');
  expect(hasText(root, 'BF-DEMO-001')).toBe(false);

  // Cualquier botón lleva la fecha vencida a hoy; desde hoy no se puede retroceder.
  pressAccessible(root, 'Día anterior');
  expect(hasText(root, 'Esta fecha ya pasó en Búzios.')).toBe(false);
  const previous = root.findAll(node => node.props.accessibilityLabel === 'Día anterior' && typeof node.props.onPress === 'function')[0];
  expect(previous.props.accessibilityState).toEqual({ disabled: true });

  pressText(root, 'Confirmar reserva demo');
  expect(hasText(root, 'BF-DEMO-001')).toBe(true);
});

test('saves favorites on the device and filters the catalog by them', async () => {
  const renderer = await renderApp();
  const root = renderer.root;
  pressText(root, 'Barcos');
  pressText(root, 'Escuna por 12 playas');
  pressAccessible(root, 'Guardar en favoritos');
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(JSON.parse(mockStorage.get('@buzios-flow/favorites-v1') ?? '[]')).toEqual(['barco-escuna']);
  ReactTestRenderer.act(() => renderer.unmount());

  const reopened = await renderApp(false);
  pressText(reopened.root, 'Explorar ofertas');
  pressText(reopened.root, 'Favoritos');
  expect(hasText(reopened.root, '1 ofertas de ejemplo')).toBe(true);
  expect(hasText(reopened.root, 'Escuna por 12 playas')).toBe(true);
  pressText(reopened.root, 'Escuna por 12 playas');
  expect(reopened.root.findAll(node => node.props.accessibilityLabel === 'Quitar de favoritos').length).toBeGreaterThan(0);
});

test('switches to English with a pending-review notice and keeps prices in BRL', async () => {
  const renderer = await renderApp();
  const root = renderer.root;
  pressAccessible(root, 'English');
  expect(hasText(root, 'Your trip to Búzios')).toBe(true);
  expect(hasText(root, 'English translation pending professional review.')).toBe(true);
  pressText(root, 'Boats');
  expect(hasText(root, '1 sample offers')).toBe(true);
  pressText(root, 'Schooner tour of 12 beaches');
  expect(hasText(root, 'SAMPLE · NOT A REAL BOOKING')).toBe(true);
  expect(hasText(root, 'Free cancellation up to 24 h before. Subject to sea conditions.')).toBe(true);
  expect(hasText(root, 'R$ 89,00')).toBe(true);
  pressText(root, 'Add to My trip');
  expect(hasText(root, 'Confirm demo booking')).toBe(true);
});

test('shows bookings stored before English existed using the Spanish snapshot', async () => {
  mockStorage.clear();
  mockStorage.set('@buzios-flow/demo-state-v1', JSON.stringify({
    schemaVersion: 1,
    tripItems: [],
    bookings: [{
      id: 'BF-DEMO-007', channel: 'app-demo', confirmedAt: '2026-11-01T12:00:00Z',
      lines: [{
        item: { id: 'l1', offerId: 'barco-escuna', date: '2099-01-10', quantity: 1, nights: 1 },
        offerId: 'barco-escuna', title: { es: 'Escuna antigua', pt: 'Escuna antiga' },
        location: { es: 'Porto', pt: 'Porto' }, category: 'barcos', priceMode: 'person',
        priceUnit: { es: 'por persona', pt: 'por pessoa' }, unitPriceCents: 8900, subtotalCents: 8900,
      }],
      quote: { pricingVersion: 'demo', serviceFeeRate: 600, settlementMode: 'b2b_conciliation', subtotalCents: 8900, serviceFeeCents: 534, travelerTotalCents: 9434, providerCommissionCents: 1602, grossIncomeCents: 2136, gatewayCostCents: 0, conversionCostCents: 0, operatingReserveCents: 0, contributionMarginCents: 2136, policy: {} },
    }],
    serviceFeeRate: 600,
  }));
  const renderer = await renderApp(false);
  const root = renderer.root;
  pressAccessible(root, 'English');
  pressText(root, 'My trip');
  pressText(root, 'BF-DEMO-007');
  expect(hasText(root, 'Escuna antigua')).toBe(true);
  expect(hasText(root, 'por persona')).toBe(true);
});

test('opens directions in the maps app and suggests other bookable offers from the detail', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const root = (await renderApp()).root;
  pressText(root, 'Barcos');
  pressText(root, 'Escuna por 12 playas');
  const directions = root.findAllByType(Text).map(node => flattenText(node.props.children)).find(text => text.startsWith('Cómo llegar · '));
  expect(directions).toBeDefined();
  pressText(root, directions as string);
  expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/maps\.apple\.com\/\?q=.*B%C3%BAzios/));
  expect(hasText(root, 'También te puede interesar')).toBe(true);
  // Un buggy sin cupo no se recomienda.
  expect(hasText(root, 'Buggy al atardecer')).toBe(false);
  pressAccessible(root, 'Ruta en buggy por Búzios');
  expect(hasText(root, 'Ruta en buggy por Búzios')).toBe(true);
  openURL.mockRestore();
});
