import { LIVE_PAYMENT_GATEWAYS, REAL_PAYMENTS_ENABLED } from '../config/featureFlags';

// Registro de pasarelas. Un cobro real exige tres controles independientes a la vez:
//   1. REAL_PAYMENTS_ENABLED encendido;
//   2. la pasarela incluida en LIVE_PAYMENT_GATEWAYS;
//   3. un adaptador en vivo implementado y revisado para esa pasarela.
// Hoy no existe ningún adaptador en vivo, así que toda selección termina en el simulador.
// Las candidatas no se describen como compatibles: sus requisitos están pendientes de verificar
// con la documentación y el contrato de la propia pasarela.

export type GatewayId = 'simulated_gateway' | 'mercado_pago';

export type GatewayProfile = {
  id: GatewayId;
  label: string;
  status: 'simulated' | 'candidate_unverified';
  chargeCurrency: 'BRL';
  methods: Array<'card' | 'pix'>;
  // Lo que hay que confirmar antes de implementar el adaptador en vivo.
  pendingVerification: string[];
};

export const GATEWAYS: Record<GatewayId, GatewayProfile> = {
  simulated_gateway: {
    id: 'simulated_gateway',
    label: 'Simulador de laboratorio',
    status: 'simulated',
    chargeCurrency: 'BRL',
    methods: ['card', 'pix'],
    pendingVerification: [],
  },
  mercado_pago: {
    id: 'mercado_pago',
    label: 'Mercado Pago (candidata, sin contrato)',
    status: 'candidate_unverified',
    chargeCurrency: 'BRL',
    methods: [],
    pendingVerification: [
      'País y tipo de cuenta del comerciante (CNPJ en Brasil)',
      'Aceptación de tarjetas emitidas fuera de Brasil y en qué condiciones',
      'Pix para pagadores sin cuenta bancaria brasileña',
      'Tarifas por método, plazos de liquidación y contracargos',
      'Firma y reintentos de webhooks',
      'Split o liquidación al proveedor',
    ],
  },
};

// Adaptadores en vivo implementados. Vacío: añadir uno exige revisión de código, contrato y pruebas.
const LIVE_ADAPTERS: ReadonlySet<GatewayId> = new Set();

export class GatewaySelectionError extends Error {}

export type GatewayFlags = { realPaymentsEnabled: boolean; liveGateways: readonly GatewayId[] };

export function selectGateway(
  requested: GatewayId,
  mode: 'simulated' | 'live',
  flags: GatewayFlags = { realPaymentsEnabled: REAL_PAYMENTS_ENABLED, liveGateways: LIVE_PAYMENT_GATEWAYS },
): { gateway: GatewayProfile; live: boolean } {
  if (mode === 'simulated') return { gateway: GATEWAYS.simulated_gateway, live: false };
  if (!flags.realPaymentsEnabled) throw new GatewaySelectionError('real_payments_disabled');
  if (!flags.liveGateways.includes(requested)) throw new GatewaySelectionError('gateway_not_enabled');
  if (!LIVE_ADAPTERS.has(requested)) throw new GatewaySelectionError('live_gateway_not_implemented');
  return { gateway: GATEWAYS[requested], live: true };
}
