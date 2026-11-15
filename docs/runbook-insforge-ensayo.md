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

Pendiente: SMTP sigue desactivado (`[auth.smtp] enabled = false`) con verificación por código obligatoria. No se
crearon usuarios ni datos de prueba en el tenant.

### Respaldo y recuperación tras las 15 migraciones (15-11-2026, tarde)

El plan gratuito admite **un** respaldo manual. Se sustituyó `pre-reservas` solo después de demostrar una
recuperación completa de la base actual, según la autorización:

1. `npx -y @insforge/cli db connection-string` da la URL de `postgres` (superusuario); se usó solo para leer y
   volcar, sin imprimirla. Con un snapshot exportado (`pg_export_snapshot`) se tomó `pg_dump -Fc` de la base entera,
   `pg_dumpall --roles-only --no-role-passwords` y una huella de la base en esa misma transacción
   (`fingerprint.sql`: esquemas, tablas, columnas, restricciones, índices, funciones con md5 del código, políticas,
   triggers, permisos normalizados, secuencias y md5 de las filas de cada tabla).
2. Restauración en PostgreSQL 15 con `pgvector`, `pg_cron` y `http` (como el tenant), en una red de Docker sin
   salida y con `cron.launch_active_jobs=off`: **los trabajos de `pg_cron` de la copia llaman al tenant real** si se
   restauran con red. Único error: `SET transaction_timeout` (parámetro de `pg_dump` 17 que la 15 no conoce).
3. Huella de la copia ordenada = huella del tenant: **0 diferencias** en 1525 líneas (72 relaciones, 80 funciones,
   16 políticas, 41 triggers, 69 tablas y 1087 filas).
4. Después: `backups delete f374147d-…` (`pre-reservas`, cuyo volcado sigue en local) y
   `backups create --name post-migraciones-15 --wait` → `e134bb27-09f2-43f3-92fa-257a31fa6864`, `completed`
   17:48 UTC. Descargado y restaurado igual: estructura idéntica; los datos solo difieren en lo que cambió en esos
   3 minutos (dos pasadas del barrido, sus registros de cron y `last_used_at` del secreto del schedule).

Copias en `~/RespaldosBuziosFlow/` (fuera del repositorio, solo lectura, `MANIFEST.sha256` verificado): el volcado
de `pre-reservas`, el de la plataforma `post-migraciones-15` y la carpeta `20261115_post-migraciones-15/` con el
volcado por snapshot, los roles, las dos huellas y un `LEEME.txt` con el procedimiento. Contienen hashes de
contraseñas y secretos cifrados: no compartir.

El procedimiento quedó en `npm run backup:verified` ([scripts/backup-verified.sh](../scripts/backup-verified.sh),
huella en `supabase/checks/database_fingerprint.sql`): vuelca con snapshot, restaura aislado y compara; falla si
algo difiere. Las secuencias no siguen el snapshot, así que se comprueba que no queden por detrás de su columna en
lugar de comparar su valor. Tras aplicar la retención y los índices se ejecutó otra vez: `PASS` (1530 líneas, 69 tablas),
copia en `~/RespaldosBuziosFlow/20261115_180303_snapshot/`.

Recuperación ante un problema grave: `npx -y @insforge/cli backups restore e134bb27-09f2-43f3-92fa-257a31fa6864`
(sobrescribe todo; vuelve al estado tras las 15 migraciones). No se ha restaurado nunca sobre la base productiva.

### Migraciones 16 a 18 (15-11-2026, tarde, con autorización condicionada)

Antes de aplicar en producción se ensayaron las tres sobre la restauración exacta, ejecutando cada una como el
backend (`BEGIN`, `SET LOCAL search_path TO public`, `SET LOCAL ROLE project_admin`):

| Versión | Ensayo en la copia | En buziosflow |
| --- | --- | --- |
| `20261116000001_sweep-runs-retention` | aplica; una pasada `succeeded` sin borrar nada | **Aplicada** (`db migrations up <archivo>`). Funciones `SECURITY DEFINER` sin `EXECUTE` para `anon` ni `authenticated`; verificación 15/15; la primera pasada programada (17:58 UTC) `succeeded` y no borró filas (242 → 243, la más antigua sigue siendo la de las 09:55) |
| `20261116000002_foreign-key-indexes` | aplica | **Aplicada** con las cuatro tablas vacías y sin sesiones activas; los seis índices válidos |
| `20261116000003_offer-media-storage` | **falla**: `must be owner of table objects`; la transacción no deja nada (ni la función auxiliar) | **Sin aplicar** |

La migración de storage iba antes que los índices; se intercambió el orden (mismo contenido, CI verde en
`8b70192`) para no bloquear los índices y poder aplicarla después. Tras aplicar:
`npm run check:remote-schema` → 17 de 18, verificación y conciliación correctas y el inventario solo difiere en lo
que crea la migración de storage.

**Por qué no se aplica la de storage.** InsForge 2.3.5 (la versión del tenant, igual a la del código abierto
consultado) ejecuta las migraciones con `SET LOCAL ROLE project_admin`; crear o borrar políticas en
`storage.objects` exige ser su dueño (`postgres`) y `project_admin` no es miembro de ese rol. La documentación de
InsForge dice que estas políticas se gestionan con una migración propia, pero en esta versión no es posible. Con la
URL de `postgres` funcionaría, pero sería elevar privilegios para saltarse una restricción de la plataforma: no se
hizo. Opciones: que InsForge la aplique o habilite el procedimiento (reporte preparado abajo), o una decisión
expresa del responsable de aplicarla con la conexión de `postgres` que da el propio CLI.

Reporte para InsForge (no enviado: el envío desde esta sesión fue denegado; se puede mandar con
`npx -y @insforge/cli feedback --type bug --component backend --area storage`): «Custom migrations cannot create
policies on storage.objects although the storage RLS docs say to put them in a custom migration. On 2.3.5
DatabaseMigrationService runs migrations under SET LOCAL ROLE project_admin, storage.objects is owned by postgres,
so CREATE/DROP POLICY fails with "must be owner of table objects". Reproduced on an exact restore of the project.»

**Vía oficial para las políticas de storage (investigado el 15-11-2026).** No hay ninguna en 2.3.5 que un proyecto
pueda usar por sí mismo: la documentación pública (`core-concepts/storage`) solo dice que storage usa RLS; la skill
de InsForge indica una migración propia, que falla; el editor SQL del panel también ejecuta como `project_admin`
(`/api/database/advance/rawsql`, auditado con `executionRole: 'project_admin'`); no hay issues ni PR que lo
resuelvan (los de storage RLS tratan de `anon` y de buckets públicos). Queda pedírselo a InsForge (soporte o
`feedback`, con el texto de arriba).

**Fotos: alternativa con backend autorizado (preparada, sin desplegar).** Mientras tanto, la función
[`functions/offer-media.ts`](../functions/offer-media.ts) es el único camino a un bucket **privado** `offer-media`:

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /offer-media/offers/<oferta>` | usuario con sesión | Lee tipo y medidas de los bytes (firma y cabecera de JPEG, PNG o WebP; 600–6000 px; ≤ 5 MB; texto alternativo obligatorio), sube con la clave de API y registra con `connectical_add_offer_media` **como el usuario**: la base decide si gestiona la oferta. Si la base rechaza, borra el archivo |
| `GET /offer-media/offers/<oferta>/<id>.<ext>` | cualquiera | Sirve la foto solo si el llamante la ve por RLS en `connectical_offer_media` (publicada y aprobada; dueño y admin también las suyas). Sin sesión, caché pública de 5 minutos; con sesión, `no-store` |
| `DELETE /offer-media/media/<id>` | usuario con sesión | `connectical_remove_offer_media` como el usuario y después borra el archivo |
| `POST /offer-media/maintenance/cleanup` | solo la clave de API | Borra archivos sin foto registrada con más de una hora |

Riesgo que queda: con las políticas por defecto, un usuario con sesión puede subir archivos propios al bucket
privado por la API de storage; nadie más los ve (el bucket no es público y la función solo sirve fotos registradas)
y la limpieza horaria los borra. Si InsForge permite después aplicar `20261116000003`, ambas capas se suman.
Probado en Jest con almacén y base simulados (`__tests__/offerMediaFunction.test.ts`, con mutaciones que
confirman que las pruebas detectan un fallo de visibilidad o de limpieza); la app tiene su cliente en
`src/media/offerMediaGateway.ts`. **No probado contra InsForge**: el despliegue es un cambio en producción y requiere
autorización. Pasos, en orden, cada uno verificable:

```sh
npx -y @insforge/cli storage create-bucket offer-media --private        # nunca --public
npx -y @insforge/cli functions deploy offer-media --file functions/offer-media.ts --name "Fotos de ofertas"
npx -y @insforge/cli db query "insert into public.connectical_settings (key, value) values ('media_public_base_url', '\"https://ykfv5j3m.function2.insforge.app/offer-media\"') on conflict (key) do update set value = excluded.value, updated_at = now()"
npx -y @insforge/cli schedules create --name offer-media-cleanup --cron "17 * * * *" \
  --url "https://ykfv5j3m.function2.insforge.app/offer-media/maintenance/cleanup" \
  --method POST --headers '{"Authorization":"Bearer ${{secrets.API_KEY}}"}' --body '{}'
```

Comprobación con cuentas reales del equipo (sin datos ficticios de clientes): un turista recibe 403 al subir; un
proveedor no puede subir ni borrar en ofertas de otro; el dueño sube y ve su foto; sin sesión, 404 hasta que la
oferta esté publicada y aprobada y 200 después; un archivo `.jpg` que no es imagen da 422; subir directamente al
bucket con la API de storage no hace visible nada y la limpieza lo borra. Retirada: `functions delete offer-media`
y borrar el bucket.

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
«generado pero no entregado» (configurar SMTP o revisar spam) y «no generado». Sin ejecutar todavía: necesita un
correo del equipo y a la persona que lo lea.

**Idioma de los correos.** Sin SMTP propio, InsForge Cloud envía los correos con su proveedor gestionado, que solo
recibe el tipo de plantilla y las variables y usa **su propia plantilla en inglés**; las de `email.templates` solo
se usan con SMTP. Además hay una plantilla por tipo, sin selección por idioma. Por eso:

- `config/email-templates/pt-BR/` tiene las cinco plantillas en portugués (mismas variables `{{ token }}` y
  `{{ link }}`) y `subjects.json` con los asuntos. Se cargan en el panel de InsForge (Auth → plantillas; no hay
  comando del CLI) **cuando se active SMTP**; antes no tienen efecto.
- La app avisa al turista, en su idioma, de que el correo llega por ahora en inglés y con qué asunto.

**Alternativa SMTP (preparada, sin contratar ni activar).** `[auth.smtp]` en `insforge.toml`
(`npx -y @insforge/cli config export`, editar, `config plan`, `config apply`): `enabled`, `host`, `port` (465 o
587), `username`, `sender_email`, `sender_name`, `min_interval_seconds` (hoy 60); la contraseña se carga en el panel.
Sirve una cuenta de correo del equipo con SMTP o un proveedor transaccional; elegirlo es decisión del equipo.
Con SMTP activo, cargar las plantillas en portugués y repetir `verify-email-delivery.mjs`.

**Recuperación de contraseña** (`resetPasswordMethod = code` en el tenant): la app pide el código con
`sendResetPasswordEmail` (el servidor no revela si el correo tiene cuenta), lo canjea por un token de un solo uso y
fija la contraseña nueva; no inicia sesión. Probado con el SDK real y red simulada; sin probar contra el tenant.

### Comprobación del tenant, advisor y contrato con la app

Comprobación de solo lectura en cualquier momento: `npm run check:remote-schema` (migraciones aplicadas frente a
`migrations/`, verificación, conciliación e inventario, que incluye índices y las políticas `connectical_*` de
`storage.objects`). Con migraciones pendientes muestra la diferencia esperada sin fallar.

**Advisor de InsForge** (escaneo del 15-11-2026: 51 críticos, 23 avisos, 9 informativos). Los críticos son del diseño:
43 `dangerous-function` son las RPC `SECURITY DEFINER` que comprueban `auth.uid()` y el rol por dentro (las pruebas
cubren sus rechazos); las que puede llamar `anon` (`is_admin`, `owns_offer`, `active_campaigns`) solo responden sobre
el propio llamante o campañas públicas. 8 `rls-no-policy` son tablas a las que solo se llega por RPC. Avisos: índices
de claves foráneas (aplicados en `20261116000002`) y cinco políticas que conviene reescribir con `(select auth.uid())` cuando
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
