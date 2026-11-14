# Runbook: desplegar reservas compartidas en el tenant de ENSAYO de InsForge

Para la persona que aplique las migraciones. No contiene secretos. Cada paso tiene un resultado esperado;
si no coincide, **detenerse** y no seguir improvisando. Nada de esto debe ejecutarse en producción ni en
proyectos de Connectical.

## 0. Antes de empezar

- [ ] En el panel de InsForge, confirmar que el proyecto es **OfertasApp** con host `8ntv6m27.us-east.insforge.app`,
      que está marcado o acordado como **ensayo**, y que no comparte base con Connectical Logística.
- [ ] Si la plataforma ofrece copia de seguridad o snapshot, crear uno y anotar su identificador. No hay migraciones
      de vuelta atrás: la recuperación ante un error grave es restaurar esa copia.
- [ ] Tener el repositorio en `main` actualizado (`git pull`) y anotar el SHA.

## 1. Preflight (solo lectura)

Pegar [`supabase/checks/preflight.sql`](../supabase/checks/preflight.sql) en el SQL Editor y guardar el resultado.

| Consulta | Esperado |
| --- | --- |
| 1. Identidad | PostgreSQL 15 o superior; anotar base, usuario y versión |
| 2. Extensiones | anotar si `pg_cron` está disponible (decide el scheduler del paso 5) |
| 3. Auth | las cuatro columnas en `true` |
| 4. Objetos `connectical_*` | **ninguna fila**. Si hay filas, detenerse y comparar con las migraciones |
| 5. Historial de migraciones | anotar lo que aparezca; no tocarlo |
| 6. Volumen | solo recuentos; anotar |
| 7. Privilegios | `can_create_in_public = true` y (`is_superuser` u `owns_auth_users`) `= true` |

## 2. Migraciones, en este orden y una por ejecución

1. `supabase/migrations/202611110001_shared_reservations.sql`
2. `supabase/migrations/202611140001_multi_night_inventory.sql`
3. `supabase/migrations/202611140002_system_hold_sweep.sql`
4. `supabase/migrations/202611140003_refund_ledger.sql`
5. `supabase/migrations/202611140004_operations_tools.sql`
6. `supabase/migrations/202611140005_hide_internal_ids.sql`
7. `supabase/migrations/202611140006_sweep_runs.sql`
8. `supabase/migrations/202611140007_commercial_terms.sql`

Resultado esperado de cada una: sin errores (los avisos `NOTICE ... skipping` son normales).

Si una ejecución se corta a mitad, se puede **repetir el mismo archivo**: las ocho se ensayaron aplicadas dos veces
seguidas sin error. No saltar al archivo siguiente hasta que el actual termine sin errores.

Ensayo local de este paso: `npm run test:shared-reservations` (base vacía) y `npm run test:migration-upgrade`
(actualización desde etapas intermedias con datos). Ambos corren en CI.

## 3. Verificación posterior (solo lectura)

- [ ] [`supabase/checks/verify_migrations.sql`](../supabase/checks/verify_migrations.sql): **todas** las filas con `ok = true`.
- [ ] [`supabase/checks/reconcile_inventory.sql`](../supabase/checks/reconcile_inventory.sql): **ninguna fila**.

## 4. Cuentas de ensayo

Seguir la sección "Accounts and roles" de [`supabase/PROVISIONING.md`](../supabase/PROVISIONING.md) con correos
controlados por el equipo. No escribir contraseñas en el repositorio ni en chats.

## 5. Scheduler del barrido de retenciones (requiere aprobación)

La función a programar es `public.connectical_system_run_hold_sweep()`, cada 1–5 minutos, con un rol de confianza
(no `anon` ni `authenticated`). Si dos ejecuciones se cruzan, la segunda queda como `skipped`; si una oferta falla, el
resto se procesa y la ejecución queda como `partial`.

- Si el preflight mostró `pg_cron` disponible y se aprueba activarlo:
  ```sql
  create extension if not exists pg_cron;
  select cron.schedule('connectical-hold-sweep', '*/2 * * * *', $$select public.connectical_system_run_hold_sweep()$$);
  ```
  Para retirarlo: `select cron.unschedule('connectical-hold-sweep');`
- Si no hay `pg_cron`, usar el mecanismo de tareas programadas de InsForge con un rol de servicio; confirmar antes
  en su documentación cómo se autentica, sin poner la clave en la app.
- Comprobación: en el portal, como admin, la sección "Barrido de retenciones vencidas" debe mostrar una última
  ejecución correcta reciente y 0 retenciones vencidas en espera.

## 6. Activar el catálogo compartido en un build de ensayo

Solo después de los pasos 1–4: cambiar `SHARED_CATALOG_ENABLED` a `true` en `src/config/featureFlags.ts` en una
rama de ensayo y probar con dos dispositivos el recorrido del documento de revisión humana. Los pagos siguen
simulados; `CANCELLATION_POLICY_ENABLED` sigue en `false`.

## 7. Qué anotar al terminar

Fecha, SHA de `main`, resultado de cada paso, identificador del snapshot, decisión sobre el scheduler y cualquier
desviación. Añadirlo al final de este archivo o a la bitácora de operación.
