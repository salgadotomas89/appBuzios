# Continuación autónoma — sábado 14 de noviembre de 2026

Rama: `work/dev-2026-11-14b`, desde `main` = `373d91c`. Horas en America/Santiago (UTC−3).
Inicio verificado con `date`: **06:56**. Bitácora anterior: [operacion-nocturna-2026-11-14.md](operacion-nocturna-2026-11-14.md).

## Auditoría inicial (06:56)

- `main` = `origin/main` = `373d91c`, árbol limpio. Coincide con lo reportado.
- tsc y ESLint sin errores, Jest 81/81, integración PostgreSQL 25/25.
- Migraciones pendientes de aplicar en remoto, en orden: `202611110001`, `202611140001`, `202611140002`.
- Zod: `zod@3.25.76` llega por `@insforge/shared-schemas`, que exige `^3.23.8`; la advisory pide `>=4.6.6`, así que
  no hay versión 3.x corregida y un override rompería el paquete. En tiempo de ejecución el SDK solo usa
  `ERROR_CODES` y la lista de proveedores OAuth (`oAuthProvidersSchema.options`); la app no valida datos del usuario
  con Zod, así que el vector (colecciones enormes validadas) no es alcanzable desde la app. Riesgo aceptado y documentado.
- Entorno móvil: Xcode 27.2 instalado; sin Java ni Android SDK.

## Checkpoint 1 (07:18)

Commits: `0a6c588`, `10324b7`, `60b56f1`, `ef6fbd9`, `437716f`, `54c898f`.

- Concurrencia: 8 sesiones sincronizadas compiten por estancias solapadas (exactamente una gana) y tres envíos
  simultáneos con la misma clave retienen una sola vez. La prueba exige que los arranques caigan en menos de 1 s.
  Mutaciones: sin lock, sin la condición del UPDATE y sin el CHECK de tabla, la prueba previa de dos sesiones falla; con
  el bug antiguo de contar solo la primera noche falla la prueba secuencial de estancias.
- Reembolsos: migración `202611140003_refund_ledger.sql` (solo admin, tope en lo cobrado, idempotente, el total exige
  cancelar antes; sin política comercial ni pasarela). Formulario admin con clave estable entre reintentos.
- Finanzas: los totales admin sumaban comisión y cargo de reservas retenidas, vencidas y canceladas. Ahora solo
  confirmadas, más cobrado, reembolsado, neto y aviso de canceladas cobradas sin reembolso completo.
- Contratos: cada código `raise exception` de las migraciones tiene texto ES/PT (prueba en Jest); paridad de redondeo
  BRL app↔SQL con un fixture de 12 casos calculado con aritmética decimal; paridad del día de Búzios app↔tzdata.
- Catálogo unificado tras `SHARED_CATALOG_ENABLED` (apagado). Las ofertas reales se reservan en el portal.
- Demo: fechas en calendario de Búzios, sin fechas pasadas; botón de operaciones y etiquetas de accesibilidad localizados.
- Jest 120/120 · PostgreSQL 30/30 (contadas en la última ejecución) · CI verde en `60b56f1`.
