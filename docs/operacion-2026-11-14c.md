# Operación intensiva — sábado 14 de noviembre de 2026 (tarde)

Rama: `work/dev-2026-11-14c`, desde `main` = `fc72c4b`. Horas en America/Santiago (UTC−3), tomadas de `date`.
Inicio: **17:29**. Bitácoras anteriores: [operacion-nocturna-2026-11-14.md](operacion-nocturna-2026-11-14.md),
[operacion-2026-11-14b.md](operacion-2026-11-14b.md).

## Auditoría inicial (17:29)

- `main` = `origin/main` = `fc72c4b`, árbol limpio. tsc y ESLint sin errores, Jest 128/128, PostgreSQL 32/32.
- Coincide con lo reportado. La "cuarta migración" pendiente es la base, `202611110001_shared_reservations.sql`.
- Zod sin cambios: `zod@3.25.76` por `@insforge/shared-schemas` (exige `^3.23.8`); la advisory pide `>=4.6.6`.
  Sin versión compatible corregida. Riesgo documentado en [operacion-2026-11-14b.md](operacion-2026-11-14b.md).

## Orden completo de migraciones (todas sin aplicar en remoto)

1. `202611110001_shared_reservations.sql`: esquema, RLS y RPC base.
2. `202611140001_multi_night_inventory.sql`: inventario por noche y endurecimiento.
3. `202611140002_system_hold_sweep.sql`: barrido sin sesión para un scheduler.
4. `202611140003_refund_ledger.sql`: reembolsos simulados de administración.
5. `202611140004_operations_tools.sql` (**nueva hoy**): publicación por rango y pausa de proveedores.
6. `202611140005_hide_internal_ids.sql` (**nueva hoy**): privilegios por columna que ocultan uuid de Auth.

Cada una depende de las anteriores; aplicarlas en este orden, una por ejecución.

## Checkpoint 1 (17:43, unos 14 min de reloj)

Commits: `eb7d553`, `9358b33`, `58afdf7`, `9a6ffa9`, `ec30bfc`, `9dc9d9a`.

- **UUID del administrador (P0)**: turistas y proveedores leían `actor_user_id` de eventos y reembolsos, y el
  proveedor leía `traveler_user_id` e `idempotency_key` del turista (también en la fila que devuelve la cancelación).
  Migración `0005`: privilegios por columna, cancelación que no devuelve esos campos, auditoría solo para admin por
  RPC y un helper booleano para las políticas RLS. La app pide columnas explícitas (prueba de contrato contra los
  GRANT). La integración sondea cada vía de fuga y `verify_migrations.sql` falla ante cualquier `*_user_id` legible.
- Publicación de cupo por rango (hasta 90 noches, atómica) y pausa o reactivación de proveedores por el admin,
  en SQL y en el portal.
- Casos límite de reservas: varias habitaciones en concurrencia, cancelación compitiendo con una retención,
  transacción revertida, retención que vence en mitad del flujo, estancia que cruza Año Nuevo.
  `supabase/checks/reconcile_inventory.sql` concilia contadores con reservas.
- Finanzas: desglose admin (retenido no es ingreso, bruto confirmado, neto proveedor, cargo, comisión) con prueba de
  conciliación, y detección de estados imposibles.
- Motor de política de cancelación configurable, **apagado** y sin ninguna política cargada.
- Jest 142/142 · PostgreSQL 41/41.
- Siguiente: scheduler local, catálogo y recorrido del turista, preflight y checklist de InsForge, Android.
