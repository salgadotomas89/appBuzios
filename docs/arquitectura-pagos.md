# Arquitectura de pagos — Búzios Flow

Para quien decida e integre la pasarela. **Hoy no hay cobros reales**: todo pago es simulado y ningún código puede
cobrar. Los hechos sobre pasarelas concretas están marcados como pendientes de verificar.

## Principios

- **Se cobra en BRL.** La cotización se congela en centavos BRL (`connectical_create_quote`). Las conversiones a CLP,
  USD, EUR o ARS son informativas, hoy con tasas fijas de demostración. Cuando haya una fuente cambiaria real, la app
  debe seguir diciendo que el cargo es en BRL y que el banco del turista puede aplicar otro tipo de cambio.
- **La base de datos es la autoridad.** La app nunca confirma una reserva por sí sola; la confirma una función SQL
  bajo el lock de la oferta.
- **El cargo al turista y la comisión del proveedor van separados** en cada cotización y reserva
  (`service_fee_cents` frente a `provider_commission_cents`).

## Flujo previsto con una pasarela real

1. La app crea la cotización y la retención (10 minutos) como hoy.
2. Un servicio de confianza (función edge con la clave de servicio, **nunca la app**) crea el cobro en la pasarela con
   el importe exacto `amount_cents` y una clave de idempotencia ligada a la reserva.
3. La pasarela notifica por webhook. El manejador **verifica la firma** según la documentación de la pasarela y llama a
   `connectical_system_ingest_payment_event` (migración `202611140008`).
4. Esa función registra el evento una sola vez por `(gateway, event_id)`, exige BRL e importe exacto, confirma o libera
   la reserva y deja para revisión: posible doble cobro, importe o moneda distintos, cobro con la retención vencida y
   reserva desconocida. La administración ve esas revisiones en el portal.
5. Los reembolsos se registran con `connectical_admin_record_refund` (tope en lo cobrado, idempotente). La devolución
   bancaria la hará el adaptador de la pasarela cuando exista y esté aprobado.

## Controles para activar cobros reales

Tres controles independientes, todos necesarios (`src/payments/gateways.ts`, probados en `__tests__/gateways.test.ts`):

1. `REAL_PAYMENTS_ENABLED = true` en `src/config/featureFlags.ts`.
2. La pasarela incluida en `LIVE_PAYMENT_GATEWAYS`.
3. Un adaptador en vivo implementado, revisado y probado en sandbox. **Hoy no existe ninguno.**

## A verificar con cada pasarela candidata antes de integrarla

Mercado Pago figura como candidata **sin verificar**. Para ella y para cualquier alternativa, confirmar por escrito:

- País y tipo de cuenta del comerciante (CNPJ en Brasil) y quién es el comerciante de registro.
- Si acepta tarjetas emitidas fuera de Brasil (Chile, Argentina, Europa, EE. UU.) y con qué condiciones.
- Si Pix sirve a turistas sin cuenta bancaria brasileña.
- Tarifas por método, cuotas, impuestos, plazos de liquidación, reembolsos y contracargos.
- Formato, firma y política de reintentos de los webhooks.
- Split o liquidación directa al proveedor, y quién asume cada tarifa.

## Pendiente de decisión humana

Elegir pasarela y contratarla; aprobar las tasas de comisión y el cargo al turista (hoy 6 % es solo un escenario);
definir la política de cancelación (el motor existe y está apagado); y obtener asesoría fiscal sobre los impuestos
aplicables a la intermediación (el laboratorio de precios todavía no incluye impuestos).
