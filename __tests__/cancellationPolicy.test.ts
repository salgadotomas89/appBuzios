import { CANCELLATION_POLICY_ENABLED } from '../src/config/featureFlags';
import {
  CancellationPolicyError,
  proposeCancellationRefund,
  type CancellationPolicy,
} from '../src/utils/cancellationPolicy';

// Políticas de EJEMPLO para probar el motor. No son la política de Búzios Flow, que no está aprobada.
const tiered: CancellationPolicy = {
  id: 'example-tiered',
  version: 1,
  tiers: [
    { minHoursBefore: 72, refundBps: 10_000 },
    { minHoursBefore: 24, refundBps: 5_000 },
  ],
  serviceFeeRefund: 'with_subtotal',
  providerCancellationFullRefund: true,
};
const strict: CancellationPolicy = { id: 'example-strict', version: 3, tiers: [], serviceFeeRefund: 'never', providerCancellationFullRefund: true };

const booking = {
  amountCents: 67840, // 640,00 + 38,40 de cargo
  serviceFeeCents: 3840,
  alreadyRefundedCents: 0,
  serviceStartsAt: '2027-01-10T17:00:00Z',
};

function at(hoursBefore: number) {
  return new Date(Date.parse(booking.serviceStartsAt) - hoursBefore * 3_600_000).toISOString();
}

it('stays disabled until a commercial policy is approved', () => {
  expect(CANCELLATION_POLICY_ENABLED).toBe(false);
});

it('applies the matching tier, including its exact boundary', () => {
  expect(proposeCancellationRefund(tiered, { ...booking, cancelledAt: at(100), actor: 'traveler' }))
    .toMatchObject({ refundCents: 67840, retainedCents: 0, basis: 'tier', tier: tiered.tiers[0] });
  expect(proposeCancellationRefund(tiered, { ...booking, cancelledAt: at(72), actor: 'traveler' }).refundCents).toBe(67840);
  // 50 % de 640,00 + cargo, porque devuelve parte del subtotal.
  expect(proposeCancellationRefund(tiered, { ...booking, cancelledAt: at(71.99), actor: 'traveler' }))
    .toMatchObject({ refundCents: 35840, retainedCents: 32000, tier: tiered.tiers[1] });
  expect(proposeCancellationRefund(tiered, { ...booking, cancelledAt: at(2), actor: 'traveler' }))
    .toMatchObject({ refundCents: 0, retainedCents: 67840, basis: 'no_tier' });
  expect(proposeCancellationRefund(tiered, { ...booking, cancelledAt: at(-5), actor: 'traveler' }).refundCents).toBe(0);
});

it('honours each service-fee option', () => {
  const late = { ...booking, cancelledAt: at(2), actor: 'traveler' as const };
  expect(proposeCancellationRefund({ ...tiered, serviceFeeRefund: 'always' }, late).refundCents).toBe(3840);
  expect(proposeCancellationRefund({ ...tiered, serviceFeeRefund: 'never' }, { ...late, cancelledAt: at(100) }).refundCents).toBe(64000);
});

it('refunds everything when the provider cancels, if the policy says so', () => {
  expect(proposeCancellationRefund(strict, { ...booking, cancelledAt: at(1), actor: 'provider' }))
    .toMatchObject({ refundCents: 67840, basis: 'provider_cancellation', policyVersion: 3 });
  expect(proposeCancellationRefund({ ...strict, providerCancellationFullRefund: false }, { ...booking, cancelledAt: at(1), actor: 'provider' }).refundCents).toBe(0);
});

it('never proposes more than what remains after earlier refunds', () => {
  expect(proposeCancellationRefund(tiered, { ...booking, alreadyRefundedCents: 60000, cancelledAt: at(100), actor: 'traveler' }))
    .toMatchObject({ refundCents: 7840, retainedCents: 0 });
  expect(proposeCancellationRefund(tiered, { ...booking, alreadyRefundedCents: 67840, cancelledAt: at(100), actor: 'provider' }))
    .toMatchObject({ refundCents: 0, basis: 'already_refunded' });
});

it('accepts admin exceptions only from admins, with a reason and within the remaining amount', () => {
  const late = { ...booking, cancelledAt: at(1) };
  expect(proposeCancellationRefund(strict, { ...late, actor: 'admin', adminOverride: { refundCents: 20000, reason: 'Tormenta' } }))
    .toMatchObject({ refundCents: 20000, retainedCents: 47840, basis: 'admin_override' });
  for (const input of [
    { ...late, actor: 'traveler' as const, adminOverride: { refundCents: 1, reason: 'x' } },
    { ...late, actor: 'admin' as const, adminOverride: { refundCents: 1, reason: '  ' } },
    { ...late, actor: 'admin' as const, adminOverride: { refundCents: 67841, reason: 'x' } },
    { ...late, actor: 'admin' as const, adminOverride: { refundCents: 0.5, reason: 'x' } },
  ]) {
    expect(() => proposeCancellationRefund(strict, input)).toThrow(CancellationPolicyError);
  }
});

it('rejects malformed policies and amounts', () => {
  const late = { ...booking, cancelledAt: at(1), actor: 'traveler' as const };
  expect(() => proposeCancellationRefund({ ...tiered, tiers: [{ minHoursBefore: 24, refundBps: 5000 }, { minHoursBefore: 72, refundBps: 10000 }] }, late)).toThrow('policy_tiers_order');
  expect(() => proposeCancellationRefund({ ...tiered, tiers: [{ minHoursBefore: 24, refundBps: 10001 }] }, late)).toThrow('policy_tier_rate');
  expect(() => proposeCancellationRefund({ ...tiered, version: 0 }, late)).toThrow('policy_identity');
  expect(() => proposeCancellationRefund(tiered, { ...late, serviceFeeCents: 70000 })).toThrow('invalid_amounts');
  expect(() => proposeCancellationRefund(tiered, { ...late, cancelledAt: 'ayer' })).toThrow('invalid_dates');
});
