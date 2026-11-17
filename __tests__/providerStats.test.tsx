import React, { useState } from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { ProviderStats } from '../src/components/ProviderStats';
import { totalProviderStats, type ProviderOfferStats } from '../src/lib/platformService';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

function row(overrides: Partial<ProviderOfferStats>): ProviderOfferStats {
  return {
    offer_id: 'o1', title: 'Trilha', category: 'actividades', published: true, quotes: 0, reservations: 0, confirmed: 0,
    cancelled: 0, expired: 0, units_sold: 0, gross_cents: 0, service_fee_cents: 0, commission_cents: 0, net_cents: 0,
    refunded_cents: 0, discount_cents: 0, checked_in: 0, upcoming_7d: 0, ...overrides,
  };
}

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));

it('adds offers up and computes the quote-to-confirmed conversion', () => {
  const totals = totalProviderStats([
    row({ quotes: 3, confirmed: 1, gross_cents: 19080, net_cents: 16200 }),
    row({ offer_id: 'o2', quotes: 1, confirmed: 1, gross_cents: 1000, net_cents: 800, upcoming_7d: 2 }),
  ]);
  expect(totals).toMatchObject({ quotes: 4, confirmed: 2, gross_cents: 20080, net_cents: 17000, upcoming_7d: 2, conversionBps: 5000 });
  expect(totalProviderStats([]).conversionBps).toBe(0);
});

it('loads the last 30 days on demand and shows totals and per-offer rows', async () => {
  const load = jest.fn(async () => [
    row({ quotes: 3, reservations: 3, confirmed: 1, cancelled: 1, units_sold: 2, gross_cents: 19080, commission_cents: 1800, net_cents: 16200, checked_in: 1, upcoming_7d: 1 }),
  ]);
  function Harness() {
    const [busy, setBusy] = useState(false);
    const run = (action: () => Promise<string | void>) => {
      setBusy(true);
      action().finally(() => setBusy(false));
    };
    return <ProviderStats language="es" today="2026-12-31" load={load} run={run} busy={busy} />;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness />);
  });
  expect(load).not.toHaveBeenCalled();
  const button = renderer.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
  await act(async () => button.props.onPress());
  expect(load).toHaveBeenCalledWith('2026-12-02', '2026-12-31');
  const all = texts(renderer.root);
  expect(all).toContain('Cotizaciones: 3 · Confirmadas: 1 · Canceladas: 1 · Conversión: 33,33 %');
  expect(all).toContain('Pagado por turistas: R$ 190,80 · Tu neto: R$ 162,00');
  expect(all).toContain('Trilha · Actividades y paseos');
  expect(all).toContain('Confirmadas: 1/3 · Unidades vendidas: 2 · Tu neto: R$ 162,00');
  expect(all).toContain('Llegadas en 7 días: 1');
});
