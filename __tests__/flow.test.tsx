import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import App from '../App';

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

test('localizes the operations entry and stepper labels in Portuguese', async () => {
  const renderer = await renderApp();
  const root = renderer.root;

  pressText(root, 'PT');
  expect(hasText(root, 'Reservas compartilhadas · acesso de operações')).toBe(true);
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

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
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
