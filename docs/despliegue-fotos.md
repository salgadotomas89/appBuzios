# Despliegue de las fotos de ofertas en buziosflow

Procedimiento para la persona del equipo que despliegue, **solo con una autorización específica de despliegue**.
Cambia el esquema, crea un bucket, despliega una función y programa una tarea en producción. Nada de esto se ha
ejecutado todavía en buziosflow. La auditoría de seguridad está en [`auditoria-fotos.md`](auditoria-fotos.md).

Qué se despliega:

| Pieza | Qué hace |
| --- | --- |
| `20261116000003_offer-media-gateway-only` | Solo se registran fotos que escribió la función; 30 por usuario y hora, con bloqueo por usuario |
| `20261116000004_offer-media-storage` | El bucket `offer-media` queda cerrado a toda sesión de usuario (cuatro políticas RESTRICTIVE en `storage.objects`) |
| `20261116000005_offer-media-moderation` | Toda foto nueva nace pendiente y solo es pública cuando la administración la aprueba; rechazar exige motivo; cada decisión queda en el registro de actividad |
| Bucket **privado** `offer-media` | Los archivos |
| Función [`offer-media`](../functions/offer-media.ts) | Valida, quita metadatos de ubicación, sube con la clave de API, sirve solo lo aprobado y limpia huérfanos |
| `media_public_base_url` | URL pública de la función, en `connectical_settings` |
| Limpieza horaria | Borra archivos huérfanos |

La app sigue sin mostrar el gestor de fotos hasta el paso 11.

Cada paso dice qué debe salir. **Si algo no coincide, parar** y seguir «Recuperación» desde el paso alcanzado.

## Antes de empezar

- [ ] La autorización cubre los pasos 1 a 10. El paso 1 lee la base con la URL de `postgres` que da el CLI (solo
      lectura, para el volcado); si esa lectura no está autorizada, no seguir.
- [ ] Repositorio en `main`, sin cambios locales: `git status`. Anotar `git rev-parse HEAD`.
- [ ] El CI de ese commit está en verde, incluido «Función offer-media en Deno».
- [ ] `npx -y @insforge/cli current` dice `buziosflow (bfab79dc-…)`.
- [ ] `npm run check:remote-schema` da:
  - `Applied: 17 of 20 migrations`;
  - pendientes `20261116000003 20261116000004 20261116000005`;
  - `PASS` en verificación y conciliación.
- [ ] `npx -y @insforge/cli storage buckets` y `npx -y @insforge/cli functions list` no muestran `offer-media`.
- [ ] Al menos 2 GB libres en el Mac (`df -h ~`): el volcado se restaura en Docker.
- [ ] Cuentas de prueba **del equipo** que ya existan (no se crean para esto):
  - un turista;
  - un proveedor aprobado con una oferta de prueba suya;
  - el administrador.

## 1. Respaldo verificado

```sh
npm run backup:verified
```

Debe terminar en `PASS` con la carpeta `~/RespaldosBuziosFlow/<fecha>_snapshot`. Exporta la base con un snapshot de
solo lectura, la restaura en un PostgreSQL aislado sin red (los trabajos de `pg_cron` restaurados llamarían al
tenant) y compara las huellas. Es la prueba de restauración: **nunca se restaura sobre la base productiva para
probar**.

Copia en la plataforma: el plan gratuito admite una copia manual. Hoy es `post-migraciones-15`
(`e134bb27-09f2-43f3-92fa-257a31fa6864`). Reemplazarla **solo después** del `PASS` anterior:

```sh
npx -y @insforge/cli backups list
npx -y @insforge/cli backups delete e134bb27-09f2-43f3-92fa-257a31fa6864
npx -y @insforge/cli backups create --name pre-fotos --wait
npx -y @insforge/cli backups list          # anotar el id de pre-fotos
```

## 2. Migraciones pendientes

```sh
npx -y @insforge/cli db migrations up --all
npm run check:remote-schema
```

Qué debe salir:

- `db migrations up`: `Applied 3 migration file(s)`, que son `…0003`, `…0004` y `…0005`. Se aplican como
  `project_admin`; las políticas de `storage.objects` las permite `insforge_pg_utils`
  (`insforge.policy_grant_tables`), ensayado con la imagen oficial en el laboratorio.
- `check:remote-schema`: `Applied: 20 of 20 migrations`, `PASS` en verificación (incluye la invariante «offer media
  moderation absent or complete») y conciliación, y sin diferencias de inventario.

## 3. Políticas RLS

```sh
npx -y @insforge/cli db query "select policyname, permissive, cmd from pg_policies where schemaname = 'storage' and policyname like 'connectical\_offer\_media\_%' order by 1"
npx -y @insforge/cli db query "select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'connectical_offer_media_read'"
npx -y @insforge/cli db query "select tgname from pg_trigger where tgrelid = 'public.connectical_offer_media'::regclass and not tgisinternal order by 1"
```

Qué debe salir:

- **Primera consulta:** cuatro filas `connectical_offer_media_{delete,insert,select,update}`, todas `RESTRICTIVE`.
- **Segunda:** empieza por `((moderation_status = 'approved'::text) AND (EXISTS …`.
- **Tercera:** `connectical_offer_media_moderation_guard` y `connectical_offer_media_new_pending`.

## 4. Bucket privado

```sh
npx -y @insforge/cli storage create-bucket offer-media --private
npx -y @insforge/cli db query "select name, public from storage.buckets"
```

**`--private` es obligatorio**: el CLI crea buckets públicos si no se indica. La consulta debe dar `offer-media | false`.

## 5. Función endurecida

```sh
npx -y @insforge/cli functions deploy offer-media --file functions/offer-media.ts --name "Fotos de ofertas" \
  --description "Sube, sirve y borra fotos de ofertas; único camino al bucket offer-media"
npx -y @insforge/cli functions list
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS https://ykfv5j3m.function2.insforge.app/offer-media/offers/00000000-0000-4000-8000-000000000000
curl -s -w ' %{http_code}\n' -X POST https://ykfv5j3m.function2.insforge.app/offer-media/maintenance/cleanup
```

Qué debe salir:

- `functions deploy` termina sin errores de tipos. Si InsForge responde «Function code failed type check», parar: CI
  no lo detectó y hay que corregirlo en el repositorio.
- `functions list` muestra `offer-media` activa.
- El `OPTIONS` responde `204`.
- El `POST` sin clave responde `{"error":"authentication_required"} 401`.

## 6. Configuración de variables

La función usa los secretos `API_KEY`, `ANON_KEY` e `INSFORGE_BASE_URL`, que ya existen (`npx -y @insforge/cli secrets
list`, solo nombres). Si al llamarla responde `503 offer_media_not_configured`, falta alguno.

La URL pública, que la base usa para construir la URL de cada foto:

```sh
npx -y @insforge/cli db query "insert into public.connectical_settings (key, value) values ('media_public_base_url', '\"https://ykfv5j3m.function2.insforge.app/offer-media\"') on conflict (key) do update set value = excluded.value, updated_at = now()"
npx -y @insforge/cli db query "select value from public.connectical_settings where key = 'media_public_base_url'"
```

Debe devolver `https://ykfv5j3m.function2.insforge.app/offer-media`, la misma URL que construyen la función y la app.
Sin este valor, la base rechaza todas las fotos (`media_storage_not_configured`).

## 7. Limpieza periódica

```sh
npx -y @insforge/cli schedules create --name offer-media-cleanup --cron "17 * * * *" \
  --url "https://ykfv5j3m.function2.insforge.app/offer-media/maintenance/cleanup" \
  --method POST --headers '{"Authorization":"Bearer ${{secrets.API_KEY}}"}' --body '{}'
npx -y @insforge/cli schedules list
```

Qué hace y qué comprobar:

- La clave va como referencia a un secreto, nunca escrita en el comando.
- Corre a las :17 de cada hora (UTC).
- Borra solo archivos sin foto registrada y con más de una hora: nunca fotos registradas (aprobadas, pendientes ni
  rechazadas) ni subidas en curso.
- Tras la primera ejecución, `npx -y @insforge/cli schedules logs <id>` debe mostrar `200` con
  `{"checked":N,"removed":M}`.
- Debe seguir activa `connectical-hold-sweep`, el barrido de reservas.

## 8. Pruebas con turista, proveedor y administrador

```sh
npm run verify:offer-media -- --traveler turista@equipo.com --provider pousada@equipo.com \
  --offer <uuid de su oferta de prueba> --admin admin@equipo.com
```

El script pide las contraseñas sin mostrarlas y debe terminar en `Offer photos verified`. Comprueba:

- **Sin sesión:** subir, limpiar y servir una foto desconocida fallan, y subir directo al bucket también.
- **Turista:** no puede subir por la función, ni directamente al bucket, ni listarlo, ni registrar fotos por RPC.
- **Proveedor:**
  - Un SVG disfrazado se rechaza.
  - Sube un PNG real y lo ve con su sesión.
  - **Mientras espera revisión no la ve nadie más**, y él no puede aprobarla.
  - El turista no puede borrarla.
- **Administrador:**
  - La foto está en la bandeja.
  - La aprueba.
  - Solo entonces se sirve sin sesión (si la oferta está publicada y aprobada).
- **Al final:** el proveedor borra la foto de prueba (fila y archivo) y deja de servirse.

## 9. Validación del catálogo

El mismo script revisa el catálogo sin sesión: cada foto visible pertenece a una oferta publicada y aprobada, y se
sirve como imagen. Además, comprobar a mano:

```sh
npx -y @insforge/cli db query "select moderation_status, count(*) from public.connectical_offer_media group by 1"
```

Antes del paso 11 no debe quedar ninguna foto de prueba. En el registro de actividad («Actividad» en la consola de
administración) deben figurar `media_approved` con el administrador como actor.

## 10. Recuperación ante fallos

Del cambio menos invasivo al más invasivo. Anotar qué paso falló y su salida.

| Situación | Qué hacer |
| --- | --- |
| La función falla o sirve algo indebido | `npx -y @insforge/cli functions delete offer-media`. Sin función no se sube ni se sirve ninguna foto; el catálogo muestra la ilustración de la categoría. `OFFER_PHOTOS_ENABLED` sigue en `false` |
| Una foto indebida ya es pública | En la consola, «Fotos» no la lista (solo pendientes): `npx -y @insforge/cli db query "update public.connectical_offer_media set moderation_status = 'rejected', moderation_note = '<motivo>' where id = '<id>'"`. Deja de servirse en 60 s como mucho; sin sesión del operador, el cambio queda sin actor |
| La limpieza borra de más o falla | `npx -y @insforge/cli schedules list` y `schedules delete <id>` de `offer-media-cleanup` |
| Hay que retirar el bucket | Primero sin función ni limpieza; `npx -y @insforge/cli storage delete-bucket offer-media` (borra también sus objetos) |
| Hay que deshacer la moderación | Copiar [`docs/rollback/offer-media-moderation.sql`](rollback/offer-media-moderation.sql) a `migrations/` y `supabase/migrations/` con el siguiente número libre y aplicarlo con `npx -y @insforge/cli db migrations up <archivo>`. **Antes**, retirar la función o borrar las fotos rechazadas: sin moderación, las pendientes y rechazadas de ofertas públicas se vuelven visibles. Probado en `npm run test:insforge-compat` |
| Hay que deshacer `…0003` y `…0004` | Después de la anterior, lo mismo con [`docs/rollback/offer-media-photos.sql`](rollback/offer-media-photos.sql). Quita las cuatro políticas y devuelve el registro de fotos a su versión anterior; no borra fotos ni archivos. Probado en `npm run test:insforge-compat` |
| Daño en datos | Restaurar la copia `pre-fotos` con `npx -y @insforge/cli backups restore <id>`. Sobrescribe toda la base y es la última opción; requiere su propia autorización |

## 11. Activar `OFFER_PHOTOS_ENABLED` (otra entrega)

Solo con **todas** estas casillas marcadas:

- [ ] Pasos 1 a 9 correctos y anotados en el registro.
- [ ] `check:remote-schema`: 20 de 20, verificación y conciliación correctas.
- [ ] `verify:offer-media` con las tres cuentas terminó en `Offer photos verified`.
- [ ] La primera ejecución de la limpieza devolvió `200`.
- [ ] Ninguna foto de prueba en la base.
- [ ] `cd ios && pod install` hecho y `Podfile.lock` revisado (módulo nativo `react-native-image-picker`).
- [ ] Prueba en **un iPhone y un Android reales**, con la build de prueba con la bandera encendida:
  - [ ] galería: elegir una y varias fotos;
  - [ ] cámara; un dispositivo sin cámara muestra el aviso;
  - [ ] permisos: aceptar, denegar (aviso en el idioma de la app) y volver a activarlos en ajustes;
  - [ ] foto HEIC del iPhone: llega como JPEG; foto grande de 12 MP o más: se reduce y sube;
  - [ ] cancelar a mitad de subida: la foto vuelve a «Subir» y, si el servidor ya la tenía, aparece en la lista;
  - [ ] modo avión durante la subida: aviso de conexión y «Reintentar» funciona al volver;
  - [ ] estados «Pendiente de revisión», «Publicada» y «Rechazada» con su motivo, en ES, PT y EN;
  - [ ] VoiceOver y TalkBack: se anuncian la descripción de cada foto, la barra de progreso y los avisos;
  - [ ] el administrador aprueba y rechaza desde «Fotos» y el catálogo público solo muestra las aprobadas.
- [ ] Entonces sí: `OFFER_PHOTOS_ENABLED = true` en `src/config/featureFlags.ts`, CI en verde y publicar la build por
      el canal habitual.

## Registro

Anotar en `docs/operacion-AAAA-MM-DD.md`:

- Fecha y hora (UTC).
- Commit de `main`.
- Id de la copia `pre-fotos`.
- Salida resumida de cada paso.
- Quién lo ejecutó y quién lo autorizó.

No anotar correos, contraseñas, tokens ni claves.
