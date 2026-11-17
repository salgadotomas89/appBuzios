import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { PromotionManager, readPromotionForm } from '../src/components/PromotionManager';
import { portalCopy } from '../src/i18n/portalCopy';
import { ReservationError, type ProviderPromotion } from '../src/lib/reservationService';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

const OFFER = '11111111-1111-4111-8111-111111111111';
const TODAY = '2026-12-01';
const es = portalCopy.es;

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));
const button = (root: ReactTestInstance, label: string) =>
  root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(text => flatten(text.props.children) === label))[0];
const input = (root: ReactTestInstance, label: string) =>
  root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];

function promotion(overrides: Partial<ProviderPromotion> = {}): ProviderPromotion {
  return {
    id: 'promo-1', offer_id: OFFER, percent_off_bps: 2500, starts_on: '2026-12-10', ends_on: '2026-12-15',
    label: 'Semana gastronómica', active: true, created_at: '', updated_at: '', ...overrides,
  };
}

async function render(options: { list?: ProviderPromotion[]; save?: jest.Mock; offerId?: string | null } = {}) {
  let list = options.list ?? [];
  const load = jest.fn(async () => list);
  const save = options.save ?? jest.fn(async (request: { promotionId: string | null; active: boolean }) => {
    const saved = promotion({ id: request.promotionId ?? 'promo-new', active: request.active });
    list = [saved, ...list.filter(item => item.id !== saved.id)];
    return saved;
  });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <PromotionManager
        offerId={options.offerId === undefined ? OFFER : options.offerId}
        language="es"
        today={TODAY}
        load={load}
        save={save}
        describeError={error => (error instanceof ReservationError && error.code ? es.errors[error.code] : 'error')}
      />,
    );
  });
  return { root: renderer.root, load, save };
}

describe('readPromotionForm', () => {
  it('turns a valid form into basis points and ISO dates', () => {
    expect(readPromotionForm('es', { percent: '25', startsOn: '2026-12-10', endsOn: '2026-12-15' }, TODAY)).toEqual({
      ok: true, value: { percentOffBps: 2500, startsOn: '2026-12-10', endsOn: '2026-12-15' },
    });
    expect(readPromotionForm('es', { percent: '12,5', startsOn: TODAY, endsOn: TODAY }, TODAY)).toMatchObject({
      ok: true, value: { percentOffBps: 1250 },
    });
  });

  it('rejects discounts outside 1-90 %, past or reversed dates', () => {
    for (const percent of ['', '0,5', '95']) {
      expect(readPromotionForm('es', { percent, startsOn: TODAY, endsOn: TODAY }, TODAY)).toEqual({ ok: false, error: es.errors.invalid_promotion });
    }
    expect(readPromotionForm('es', { percent: 'diez', startsOn: TODAY, endsOn: TODAY }, TODAY).ok).toBe(false);
    expect(readPromotionForm('es', { percent: '10', startsOn: '2026-11-30', endsOn: TODAY }, TODAY).ok).toBe(false);
    expect(readPromotionForm('es', { percent: '10', startsOn: '2026-12-10', endsOn: '2026-12-09' }, TODAY)).toEqual({
      ok: false, error: es.promotions.endsBeforeStart,
    });
  });
});

describe('PromotionManager', () => {
  it('asks to save the offer first when there is none', async () => {
    const { root, load } = await render({ offerId: null });
    expect(texts(root)).toContain(es.promotions.needsOffer);
    expect(load).not.toHaveBeenCalled();
  });

  it('lists promotions with their state and creates a new one', async () => {
    const { root, save } = await render({ list: [promotion({ id: 'old', active: false })] });
    expect(texts(root)).toContain('−25 % · 2026-12-10 → 2026-12-15');
    expect(texts(root)).toContain(`Semana gastronómica · ${es.promotions.inactive}`);
    await act(async () => {
      input(root, es.promotions.percent).props.onChangeText('25');
      input(root, es.promotions.startsOn).props.onChangeText('2026-12-10');
      input(root, es.promotions.endsOn).props.onChangeText('2026-12-15');
      input(root, es.promotions.label).props.onChangeText('  Semana gastronómica ');
    });
    await act(async () => button(root, es.promotions.save).props.onPress());
    expect(save).toHaveBeenCalledWith({
      promotionId: null, offerId: OFFER, percentOffBps: 2500, startsOn: '2026-12-10', endsOn: '2026-12-15',
      label: 'Semana gastronómica', active: true,
    });
    expect(texts(root)).toContain(es.promotions.saved);
    expect(texts(root)).toContain(`Semana gastronómica · ${es.promotions.active}`);
  });

  it('does not call the server with an invalid form', async () => {
    const { root, save } = await render();
    await act(async () => input(root, es.promotions.percent).props.onChangeText('95'));
    await act(async () => button(root, es.promotions.save).props.onPress());
    expect(save).not.toHaveBeenCalled();
    expect(texts(root)).toContain(es.errors.invalid_promotion);
  });

  it('deactivates keeping the same dates and shows the server overlap error in the chosen language', async () => {
    const { root, save } = await render({ list: [promotion()] });
    await act(async () => button(root, es.promotions.deactivate).props.onPress());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ promotionId: 'promo-1', startsOn: '2026-12-10', active: false }));
    expect(texts(root)).toContain(es.promotions.deactivated);

    const failing = jest.fn(async () => { throw new ReservationError(es.errors.promotion_overlap, 'promotion_overlap'); });
    const second = await render({ save: failing });
    await act(async () => {
      input(second.root, es.promotions.percent).props.onChangeText('10');
    });
    await act(async () => button(second.root, es.promotions.save).props.onPress());
    expect(texts(second.root)).toContain(es.errors.promotion_overlap);
  });

  it('reports a failed load instead of claiming there are no promotions', async () => {
    const load = jest.fn(async () => { throw new Error('offline'); });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <PromotionManager offerId={OFFER} language="es" today={TODAY} load={load} save={jest.fn()} describeError={() => ''} />,
      );
    });
    expect(texts(renderer.root)).toContain(es.promotions.loadFailed);
    expect(texts(renderer.root)).not.toContain(es.promotions.none);
  });
});
