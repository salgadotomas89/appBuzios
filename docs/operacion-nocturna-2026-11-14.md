# Operación nocturna 2026-11-14 — bitácora

Rama de trabajo: `work/night-2026-11-14` (desde `main` @ `bb01bb7`). Hora de Chile (`America/Santiago`).
Sin cambios remotos: InsForge, OAuth y pagos reales quedan para revisión humana.

## Checkpoint 1 — 00:12 → 01:10

- Auditoría: Jest 24/24, tsc y ESLint limpios en `main`. La integración PostgreSQL fallaba de forma intermitente
  (la sonda de disponibilidad conectaba con el servidor temporal de `initdb`).
- Corregido: sonda por TCP en `scripts/test-shared-reservations.sh` (`c512be7`).
- Bug de sobreventa: los holds de varias noches solo bloqueaban la fecha de entrada. Nueva migración aditiva
  `supabase/migrations/202611140001_multi_night_inventory.sql` (`54b9cc2`): inventario por noche, bloqueo por oferta,
  fechas pasadas rechazadas (hora de São Paulo), ofertas no nocturnas con una sola fecha.
- Detectado y corregido en el script: `as_user` enmascaraba fallos de `psql` por el `| tail -1`.
- Portal compartido (`55da763`): validación de entradas, ES/PT, errores SQL legibles, categoría y modalidad para
  proveedores, filtro de estado para admin, neto del proveedor sin el cargo del turista.
- Endurecimiento: proveedor pausado no publica cupo; títulos de 1 a 120 caracteres.
- Pruebas: Jest 73/73, tsc, ESLint, integración PostgreSQL 23/23.
- Bloqueo: `gh` sin sesión → no se puede abrir el PR desde la terminal. `git push` sí funciona.

## Checkpoint 2 — 01:10 → 02:05

- Finanzas simuladas (`d856b41`): `applyRefund` descartaba reembolsos parciales legítimos más pequeños (deduplicaba
  por monto); ahora deduplica por `refundId` y solo reembolsa pagos aprobados. Neto del proveedor = subtotal − comisión
  en `createPaymentIntent` y en la confirmación demo. Tasas FX fijas etiquetadas como demostración (`isDemoRate`).
- CI (`c31f440`, `105c408`): GitHub Actions con tsc, ESLint, Jest y la integración `postgres:17`. Run
  `43552283336`: ambos jobs en verde. Sin secretos, token de solo lectura.
- Preflight de solo lectura para identificar el tenant y verificar privilegios EXECUTE en `supabase/PROVISIONING.md`
  (`695ac94`); revocado el EXECUTE por defecto de la función del trigger de registro.
- Revisión independiente del diff: sin fallos graves; 5 detalles menores corregidos (`94c5fc1`).
- Dependencias: `zod < 4.6.6` (alto) llega vía `@insforge/sdk@1.5.2`, que es la última versión; sin corrección upstream.
- Pruebas: Jest 77/77, tsc, ESLint, integración PostgreSQL 25/25.
