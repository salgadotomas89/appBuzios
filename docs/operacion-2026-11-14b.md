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

## Checkpoint 2 y cierre (07:54)

Commits después del checkpoint 1: `c9f3a72` (modelo en memoria alineado con SQL), `782a1e8` y `0c2b203` (documentación,
aviso de motivo visible), `f4625c0` (Podfile), `53d7d21` (`supabase/checks/verify_migrations.sql`), `2a4751e`
(se elimina `HomeScreen.tsx`, sin uso), `56dd732` (correcciones de la revisión independiente).
Merge a `main`: `55aa787` (`--no-ff`, push normal). CI de `main`: run 43586721006, ambos jobs en verde.

- Build iOS: compilación Debug para simulador genérico **exitosa** tras subir el mínimo de los pods a iOS 15.
  Solo compilación: no se ejecutó en ningún simulador porque CoreSimulator está desactualizado (1174.9.2 < 1174.21.0).
  Android: sin Java ni SDK, no se intentó.
- Revisión independiente del diff: sin hallazgos graves; dos medios (un reembolso podía registrarse dos veces desde el
  formulario) y cuatro menores. Corregidos todos menos la visibilidad de `actor_user_id`, que pasa a revisión humana.
- Resultados finales medidos: Jest 128/128, tsc y ESLint sin errores, integración PostgreSQL 32/32.
- Tiempo efectivo: 06:56–07:54, unos 58 minutos. No se trabajaron siete horas: el resto del backlog depende del
  tenant, de decisiones comerciales o de componentes del sistema que requieren a una persona.
