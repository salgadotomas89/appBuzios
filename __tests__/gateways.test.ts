import { LIVE_PAYMENT_GATEWAYS, REAL_PAYMENTS_ENABLED } from '../src/config/featureFlags';
import { GATEWAYS, GatewaySelectionError, selectGateway } from '../src/payments/gateways';
import { createPaymentIntent } from '../src/utils/paymentEngine';

it('ships with real payments off and no live gateway enabled', () => {
  expect(REAL_PAYMENTS_ENABLED).toBe(false);
  expect(LIVE_PAYMENT_GATEWAYS).toEqual([]);
  expect(() => selectGateway('mercado_pago', 'live')).toThrow('real_payments_disabled');
});

it('needs both independent switches and an implemented adapter to go live', () => {
  expect(() => selectGateway('mercado_pago', 'live', { realPaymentsEnabled: true, liveGateways: [] }))
    .toThrow('gateway_not_enabled');
  expect(() => selectGateway('mercado_pago', 'live', { realPaymentsEnabled: false, liveGateways: ['mercado_pago'] }))
    .toThrow('real_payments_disabled');
  // Aun con ambos encendidos no hay adaptador en vivo implementado.
  expect(() => selectGateway('mercado_pago', 'live', { realPaymentsEnabled: true, liveGateways: ['mercado_pago'] }))
    .toThrow(GatewaySelectionError);
});

it('routes every simulated request to the lab simulator', () => {
  expect(selectGateway('mercado_pago', 'simulated')).toEqual({ gateway: GATEWAYS.simulated_gateway, live: false });
});

it('does not describe candidate gateways as verified or capable', () => {
  expect(GATEWAYS.mercado_pago.status).toBe('candidate_unverified');
  expect(GATEWAYS.mercado_pago.methods).toEqual([]);
  expect(GATEWAYS.mercado_pago.pendingVerification.length).toBeGreaterThan(0);
  expect(Object.values(GATEWAYS).every(gateway => gateway.chargeCurrency === 'BRL')).toBe(true);
});

it('records demo payment intents against the simulator by default', () => {
  expect(createPaymentIntent({ bookingId: 'b1', amountCents: 1000, travelerCountry: 'CL', travelerHasCpf: false }).provider)
    .toBe('simulated_gateway');
});
