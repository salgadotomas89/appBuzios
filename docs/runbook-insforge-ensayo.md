# Runbook: desplegar reservas compartidas en el tenant de ENSAYO de InsForge

Para la persona que aplique las migraciones. No contiene secretos. Cada paso tiene un resultado esperado;
si no coincide, **detenerse** y no seguir improvisando. Nada de esto debe ejecutarse en producción ni en
proyectos de Connectical.

## Procedimiento con el CLI de InsForge (proyecto buziosflow, 14-11-2026)

El directorio está vinculado al proyecto **buziosflow** (`ykfv5j3m.us-east.insforge.app`) y el `.env` de la app ya
apunta a él (la configuración anterior de OfertasApp quedó en `.env.ofertasapp.local`, ignorado por git).
Estado leído en solo lectura: PostgreSQL 15.18, versión de plataforma 1.0.0, base vacía (sin tablas en `public`,
0 usuarios, 0 migraciones, 0 backups), verificación de correo por código obligatoria y **SMTP sin configurar**.
Las ramas de backend no están disponibles (requieren 2.x y cada una tiene coste propio).

Requiere **autorización específica** porque buziosflow es el proyecto principal:

```sh
npx -y @insforge/cli current                                   # debe decir buziosflow
npx -y @insforge/cli backups create --name pre-reservas --wait  # respaldo antes de aplicar
npm run check:insforge-migrations                              # migrations/ = supabase/migrations
npx -y @insforge/cli db migrations up --all                    # aplica las 15 en orden, una transacción cada una
npx -y @insforge/cli db migrations list                        # deben aparecer las 15
```

Después, los pasos 3 (verificación, conciliación e inventario) de este runbook con `npx -y @insforge/cli db query`.
`npm run test:insforge-compat` ensaya exactamente esta aplicación en local (PostgreSQL 15, `auth.users` de InsForge,
migraciones como `project_admin` sin superusuario) y corre en CI.

Barrido de retenciones: `project_admin` no tiene acceso a `cron`, así que se programa con
`npx -y @insforge/cli schedules create` llamando por HTTP a `connectical_system_run_hold_sweep`; antes hay que
confirmar en el tenant con qué rol ejecuta esa llamada la clave de API (no debe ser `anon` ni `authenticated`).

### Aplicado en buziosflow (15-11-2026, con autorización expresa)

| Paso | Resultado |
| --- | --- |
| `current` | buziosflow (`bfab79dc-…`), `ykfv5j3m.us-east.insforge.app` |
| Estado previo | 0 tablas en `public`, 0 usuarios, 0 migraciones, 0 backups; `main` en `54df930` con CI verde; `migrations/` sin cambios desde ese commit |
| Respaldo `pre-reservas` | id `f374147d-f4ff-4071-a20f-dcf42b7f9ea5`, `completed`, archivo `20261115_095131.sql.gz` (31 442 bytes). Descargado, `gzip -t` correcto y restaurado en un PostgreSQL 15 local: 49 tablas de los esquemas de InsForge; solo fallan las extensiones que esa imagen no trae (`vector`, `http`, `pg_cron`) |
| `db migrations up --all` | 15 aplicadas (09:52 UTC), `db migrations list` las muestra todas |
| `verify_migrations.sql` | 14 comprobaciones, todas `true` |
| `reconcile_inventory.sql` | 0 filas |
| Inventario del esquema | 257 líneas, **idéntico** a `expected_schema_inventory.txt` |
| App con la clave anónima (SDK real) | lee ofertas, inventario y fotos (0 filas); `connectical_ensure_profile` y `connectical_list_reservations` rechazan a `anon` (42501). `select *` sobre ofertas da 401/42501 por los permisos por columna: la app siempre nombra las columnas |
| Ajustes por defecto | `offer_moderation_required = false`, `simulated_payments_enabled = true`, sin `media_public_base_url` |
| Otros esquemas | sin cambios fuera de `public` (17 tablas `connectical_*`) |

Barrido programado: la clave de API ejecuta las RPC como `project_admin` (dueño y único con `EXECUTE` sobre
`connectical_system_*`). Una llamada manual (`db rpc connectical_system_run_hold_sweep --data '{}'`) terminó
`succeeded` con 0 expiradas. Sin cuerpo, el CLI usa GET y la base la ejecuta en solo lectura (`cannot execute
INSERT in a read-only transaction`): el schedule debe ser POST con `{}`. Creado así:

```sh
npx -y @insforge/cli schedules create --name connectical-hold-sweep --cron "*/2 * * * *" \
  --url "https://ykfv5j3m.us-east.insforge.app/api/database/rpc/connectical_system_run_hold_sweep" \
  --method POST --headers '{"Authorization":"Bearer ${{secrets.API_KEY}}","Content-Type":"application/json"}' --body '{}'
# Para retirarlo: npx -y @insforge/cli schedules delete f195463f-70b8-4491-bc2f-e679b77a1bc5
```

Recuperación ante un problema grave: `npx -y @insforge/cli backups restore f374147d-f4ff-4071-a20f-dcf42b7f9ea5`
(sobrescribe todo; vuelve a la base vacía).

Pendiente: SMTP sigue desactivado (`[auth.smtp] enabled = false`) con verificación por código obligatoria. La
documentación no aclara si InsForge envía los códigos sin SMTP propio; hay que comprobarlo con un registro real
desde la app usando un correo del equipo. No se crearon usuarios ni datos de prueba en el tenant.

### Integración operativa (15-11-2026): preparado, sin aplicar

Comprobación de solo lectura en cualquier momento: `npm run check:remote-schema` (migraciones aplicadas frente a
`migrations/`, verificación, conciliación e inventario, que ahora incluye índices y las políticas `connectical_*` de
`storage.objects`). Con migraciones pendientes muestra la diferencia esperada sin fallar.

**Migraciones preparadas, pendientes de autorización específica** (probadas en los cinco harnesses y en CI):

| Versión | Qué hace | Riesgo |
| --- | --- | --- |
| `20261116000001_sweep-runs-retention` | El barrido borra su propio registro: ejecuciones sin efecto a los 30 días, con efecto o `partial` a los 180, como mucho 1000 por pasada. Hoy crece ~720 filas/día | Bajo: reemplaza la función del barrido; si la limpieza falla, la pasada queda `partial` |
| `20261116000002_offer-media-storage` | Políticas RESTRICTIVE en `storage.objects` para el bucket `offer-media`: solo imágenes (JPEG/PNG/WebP, ≤ 5 MB) con clave `offers/<oferta>/<uuid>.<ext>`, subidas o borradas por quien gestiona esa oferta. Otros buckets sin cambios | Medio: `storage.objects` pertenece a `postgres` y `project_admin` no es miembro; la documentación de InsForge dice que estas políticas se gestionan con migraciones, pero no está comprobado. Si falla, la transacción no deja nada |
| `20261116000003_foreign-key-indexes` | Seis índices de claves foráneas señalados por el advisor | Bajo: tablas vacías |

Aplicación propuesta (cuando se autorice): `backups` (la cuota manual del plan es 1 y la ocupa `pre-reservas`: hay
que decidir si se reemplaza; su volcado está en `~/RespaldosBuziosFlow/`), `npx -y @insforge/cli db migrations up
--all`, `npm run check:remote-schema` sin diferencias y `schedules logs` con ejecuciones correctas.

**Primer administrador** (`scripts/promote-admin.sh`): solo promueve una cuenta existente, con el correo verificado,
no anónima, que ya inició sesión en la app y es `traveler`; sin `--additional` se niega si ya hay un admin. Por
defecto solo informa (`would_promote`); `--apply` promueve y el trigger registra `role_changed` con actor nulo.

```sh
sh scripts/promote-admin.sh correo@equipo.com           # comprobar
sh scripts/promote-admin.sh correo@equipo.com --apply   # promover
```

**Códigos de verificación** (`node scripts/verify-email-delivery.mjs correo@equipo.com`, lo ejecuta una persona):
registra la cuenta como la app, mira en `auth.email_otps` si el servidor generó el código (solo recuentos y fechas;
los códigos se guardan con hash), pide el código recibido y verifica. Concluye entre «entregado y verificado»,
«generado pero no entregado» (configurar SMTP o revisar spam) y «no generado». Las plantillas de correo del tenant
están en inglés (`email.templates`); traducirlas es un cambio de configuración pendiente de decisión.

**Fotos, orden para activarlas**: aplicar `20261116000002`; crear el bucket público
(`npx -y @insforge/cli storage create-bucket offer-media`); fijar `media_public_base_url` a
`https://ykfv5j3m.us-east.insforge.app/api/storage/buckets/offer-media/objects/`; con la cuenta del equipo, comprobar
que un turista no puede subir a `offer-media` y que el dueño sí. El servidor trata igual la clave con barras literales
(como la construye la base) y codificadas (como el SDK); falta confirmarlo con un objeto real. El adaptador
`createInsforgeMediaStorage` está probado con el SDK y no lo usa ninguna pantalla (falta el selector de fotos).

**Advisor de InsForge** (escaneo del 15-11-2026: 51 críticos, 23 avisos, 9 informativos). Los críticos son del diseño:
43 `dangerous-function` son las RPC `SECURITY DEFINER` que comprueban `auth.uid()` y el rol por dentro (las pruebas
cubren sus rechazos); las que puede llamar `anon` (`is_admin`, `owns_offer`, `active_campaigns`) solo responden sobre
el propio llamante o campañas públicas. 8 `rls-no-policy` son tablas a las que solo se llega por RPC. Avisos: índices
de claves foráneas (migración 3 de arriba) y cinco políticas que conviene reescribir con `(select auth.uid())` cuando
haya volumen. No se suprimió ningún hallazgo.

**Contrato app ↔ tenant**: las 70 combinaciones de columna y rol que la app selecciona tienen permiso; el inicio de
sesión móvil responde `401 AUTH_UNAUTHORIZED` ante credenciales inválidas, y la app ahora lo muestra traducido.

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
| 3. Auth | las cinco columnas en `true` |
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
9. `supabase/migrations/202611140008_payment_events.sql`
10. `supabase/migrations/202611140009_offer_details.sql`
11. `supabase/migrations/202611140010_traveler_privacy.sql`
12. `supabase/migrations/202611150001_provider_onboarding.sql`
13. `supabase/migrations/202611150002_admin_operations.sql`
14. `supabase/migrations/202611150003_offer_media.sql`
15. `supabase/migrations/202611150004_public_catalog_access.sql`

Resultado esperado de cada una: sin errores (los avisos `NOTICE ... skipping` son normales).

Si una ejecución se corta a mitad, se puede **repetir el mismo archivo**: las quince se ensayaron aplicadas dos veces
seguidas sin error. No saltar al archivo siguiente hasta que el actual termine sin errores.

Ensayo local de este paso: `npm run test:shared-reservations` (base vacía) y `npm run test:migration-upgrade`
(actualización desde etapas intermedias con datos). Ambos corren en CI.

## 3. Verificación posterior (solo lectura)

- [ ] [`supabase/checks/verify_migrations.sql`](../supabase/checks/verify_migrations.sql): **todas** las filas con `ok = true`.
- [ ] [`supabase/checks/reconcile_inventory.sql`](../supabase/checks/reconcile_inventory.sql): **ninguna fila**.
- [ ] [`supabase/checks/schema_inventory.sql`](../supabase/checks/schema_inventory.sql): copiar el resultado a un archivo y
      compararlo con [`expected_schema_inventory.txt`](../supabase/checks/expected_schema_inventory.txt)
      (`diff -u expected_schema_inventory.txt resultado.txt`). Debe ser idéntico: una diferencia indica una migración
      pendiente, aplicada a medias o un cambio hecho a mano en el tenant.
- **Antes de aplicar** (con el preflight) también se puede ejecutar el inventario: en un tenant nuevo no devuelve filas.

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

## 5b. Fotos (cuando el bucket esté confirmado)

Las fotos no se pueden registrar hasta configurar la URL pública del bucket (solo `https`). La base de datos construye
cada URL como base + clave, así que ningún cliente puede apuntar una foto a otro servidor:

```sql
insert into public.connectical_settings (key, value)
values ('media_public_base_url', '"https://<host-del-bucket>/<ruta>/"')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

## 6. Activar el catálogo compartido en un build de ensayo

Solo después de los pasos 1–4: cambiar `SHARED_CATALOG_ENABLED` a `true` en `src/config/featureFlags.ts` en una
rama de ensayo y probar con dos dispositivos el recorrido del documento de revisión humana. Los pagos siguen
simulados; `CANCELLATION_POLICY_ENABLED` sigue en `false`.

## 6b. Antes de conectar cualquier pasarela real

Los pagos simulados están encendidos en la base de datos para el ensayo. Antes de conectar una pasarela real
(y siempre en producción), apagarlos y comprobarlo:

```sql
update public.connectical_settings set value = 'false', updated_at = now() where key = 'simulated_payments_enabled';
select value from public.connectical_settings where key = 'simulated_payments_enabled';  -- false
```

Con el interruptor apagado o sin la fila, `connectical_simulate_payment` rechaza toda llamada.

## 7. Qué anotar al terminar

Fecha, SHA de `main`, resultado de cada paso, identificador del snapshot, decisión sobre el scheduler y cualquier
desviación. Añadirlo al final de este archivo o a la bitácora de operación.
