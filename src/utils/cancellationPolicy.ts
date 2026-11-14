// Motor de política de cancelación. NO hay una política comercial aprobada: este módulo solo
// evalúa una política expresada como datos y devuelve una propuesta de reembolso. Ningún flujo de
// la app la aplica mientras CANCELLATION_POLICY_ENABLED esté apagado, y aun encendida la base de
// datos sigue siendo la autoridad (connectical_admin_record_refund solo registra lo que un
// administrador decide). La política es JSON plano para poder guardarla más adelante en una
// tabla versionada sin cambiar este código.

export type CancellationActor = 'traveler' | 'provider' | 'admin';

export type CancellationTier = {
  // Se aplica si faltan al menos estas horas para el inicio del servicio.
  minHoursBefore: number;
  // Porcentaje del subtotal (sin cargo de servicio) que se devuelve, en puntos básicos.
  refundBps: number;
};

export type CancellationPolicy = {
  id: string;
  version: number;
  // Tramos de mayor a menor antelación; si ninguno aplica, no hay reembolso del subtotal.
  tiers: CancellationTier[];
  // Cuándo se devuelve el cargo de servicio al turista en cancelaciones del turista:
  // siempre, solo si el tramo devuelve parte del subtotal, o nunca.
  serviceFeeRefund: 'always' | 'with_subtotal' | 'never';
  // Si el proveedor cancela, el turista recupera todo lo pagado.
  providerCancellationFullRefund: boolean;
};

export type CancellationInput = {
  amountCents: number;
  serviceFeeCents: number;
  alreadyRefundedCents: number;
  serviceStartsAt: string;
  cancelledAt: string;
  actor: CancellationActor;
  // Excepción aprobada por la administración: sustituye el cálculo y exige un motivo.
  adminOverride?: { refundCents: number; reason: string };
};

export type CancellationProposal = {
  refundCents: number;
  retainedCents: number;
  basis: 'tier' | 'no_tier' | 'provider_cancellation' | 'admin_override' | 'already_refunded';
  tier: CancellationTier | null;
  policyId: string;
  policyVersion: number;
};

export class CancellationPolicyError extends Error {}

export function validatePolicy(policy: CancellationPolicy): void {
  if (!policy.id || !Number.isInteger(policy.version) || policy.version < 1) {
    throw new CancellationPolicyError('policy_identity');
  }
  let previous = Number.POSITIVE_INFINITY;
  for (const tier of policy.tiers) {
    if (!Number.isFinite(tier.minHoursBefore) || tier.minHoursBefore < 0 || tier.minHoursBefore >= previous) {
      throw new CancellationPolicyError('policy_tiers_order');
    }
    if (!Number.isInteger(tier.refundBps) || tier.refundBps < 0 || tier.refundBps > 10_000) {
      throw new CancellationPolicyError('policy_tier_rate');
    }
    previous = tier.minHoursBefore;
  }
}

export function proposeCancellationRefund(
  policy: CancellationPolicy,
  input: CancellationInput,
): CancellationProposal {
  validatePolicy(policy);
  const { amountCents, serviceFeeCents, alreadyRefundedCents } = input;
  if (
    ![amountCents, serviceFeeCents, alreadyRefundedCents].every(Number.isSafeInteger) ||
    serviceFeeCents < 0 || serviceFeeCents > amountCents ||
    alreadyRefundedCents < 0 || alreadyRefundedCents > amountCents
  ) {
    throw new CancellationPolicyError('invalid_amounts');
  }
  const remaining = amountCents - alreadyRefundedCents;
  const result = (refundCents: number, basis: CancellationProposal['basis'], tier: CancellationTier | null) => {
    const refund = Math.min(Math.max(refundCents, 0), remaining);
    return {
      refundCents: refund,
      retainedCents: amountCents - alreadyRefundedCents - refund,
      basis,
      tier,
      policyId: policy.id,
      policyVersion: policy.version,
    };
  };

  if (input.adminOverride) {
    const { refundCents, reason } = input.adminOverride;
    if (input.actor !== 'admin' || !reason.trim() || !Number.isSafeInteger(refundCents) || refundCents < 0
        || refundCents > remaining) {
      throw new CancellationPolicyError('invalid_override');
    }
    return result(refundCents, 'admin_override', null);
  }
  if (remaining === 0) return result(0, 'already_refunded', null);
  if (input.actor === 'provider' && policy.providerCancellationFullRefund) {
    return result(remaining, 'provider_cancellation', null);
  }

  const startsAt = Date.parse(input.serviceStartsAt);
  const cancelledAt = Date.parse(input.cancelledAt);
  if (Number.isNaN(startsAt) || Number.isNaN(cancelledAt)) throw new CancellationPolicyError('invalid_dates');
  const hoursBefore = (startsAt - cancelledAt) / 3_600_000;
  const tier = policy.tiers.find(candidate => hoursBefore >= candidate.minHoursBefore) ?? null;
  const subtotal = amountCents - serviceFeeCents;
  // Mismo redondeo half-up que las cotizaciones (connectical_create_quote).
  const subtotalRefund = tier ? Math.round((subtotal * tier.refundBps) / 10_000) : 0;
  const fee =
    policy.serviceFeeRefund === 'always' || (policy.serviceFeeRefund === 'with_subtotal' && subtotalRefund > 0)
      ? serviceFeeCents
      : 0;
  return result(subtotalRefund + fee, tier ? 'tier' : 'no_tier', tier);
}
