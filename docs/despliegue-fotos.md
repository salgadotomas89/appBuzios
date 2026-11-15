# Despliegue de las fotos de ofertas en buziosflow

Procedimiento para la persona del equipo que despliegue, **solo con una autorización específica de despliegue**.
Cambia el esquema, crea un bucket, despliega una función y programa una tarea en producción. Nada de esto se ha
ejecutado todavía en buziosflow.

Qué se despliega:

- Las migraciones `20261116000003` (solo se registran fotos que escribió la función, 30 por usuario y hora, con
  bloqueo por usuario) y `20261116000004` (el bucket `offer-media` queda cerrado a toda sesión de usuario).
- El bucket **privado** `offer-media`.
- La función [`functions/offer-media.ts`](../functions/offer-media.ts).
- La URL pública de esa función en `connectical_settings`.
- Una limpieza horaria de archivos huérfanos.

La app sigue sin mostrar fotos a los proveedores hasta el paso 11.

Cada paso dice qué debe salir. **Si algo no coincide, parar** y seguir «Recuperación» desde el paso alcanzado.

## Antes de empezar

- [ ] La autorización cubre los pasos 1 a 9. El paso 1 lee la base con la URL de `postgres` que da el CLI (solo
      lectura, para el volcado); si esa lectura no está autorizada, no seguir.
- [ ] Repositorio en `main`, sin cambios locales: `git status`. Anotar `git rev-parse HEAD`.
- [ ] `npx -y @insforge/cli current` dice `buziosflow (bfab79dc-…)`.
- [ ] `npm run check:remote-schema` dice `Applied: 17 of 19 migrations`, pendientes `20261116000003 20261116000004`,
      y `PASS` en verificación y conciliación.
- [ ] `npx -y @insforge/cli storage buckets` no muestra `offer-media`; `npx -y @insforge/cli functions list` no muestra
      `offer-media`.
- [ ] `npm run check:deno` termina en `ok | 3 passed` (es el mismo `deno check` que InsForge hace al desplegar).
- [ ] Al menos 2 GB libres en el Mac (`df -h ~`): el volcado se restaura en Docker.

## 1. Respaldo y prueba de restauración

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

## 2 y 3. Migraciones 19 y 20, y comprobar 19 de 19

```sh
npx -y @insforge/cli db migrations up --all
npm run check:remote-schema
npx -y @insforge/cli db query "select policyname, permissive, cmd from pg_policies where schemaname = 'storage' and policyname like 'connectical\_offer\_media\_%' order by 1"
```

Qué debe salir:

- `db migrations up`: `Applied 2 migration file(s)`, `20261116000003_offer-media-gateway-only.sql` y
  `20261116000004_offer-media-storage.sql`. Se aplican como `project_admin`; las políticas de `storage.objects` las
  permite `insforge_pg_utils` (`insforge.policy_grant_tables`), ensayado con la imagen oficial en el laboratorio.
- `check:remote-schema`: `Applied: 19 of 19 migrations`, `PASS` en verificación y conciliación, y sin diferencias de
  inventario.
- La consulta: cuatro filas `connectical_offer_media_{delete,insert,select,update}`, todas `RESTRICTIVE`.

## 4. Bucket privado

```sh
npx -y @insforge/cli storage create-bucket offer-media --private
npx -y @insforge/cli db query "select name, public from storage.buckets"
```

**`--private` es obligatorio**: el CLI crea buckets públicos si no se indica. La consulta debe dar `offer-media | false`.

## 5. Función

```sh
npx -y @insforge/cli functions deploy offer-media --file functions/offer-media.ts --name "Fotos de ofertas" \
  --description "Sube, sirve y borra fotos de ofertas; único camino al bucket offer-media"
npx -y @insforge/cli functions list
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS https://ykfv5j3m.function2.insforge.app/offer-media/offers/00000000-0000-4000-8000-000000000000
curl -s -w ' %{http_code}\n' -X POST https://ykfv5j3m.function2.insforge.app/offer-media/maintenance/cleanup
```

Qué debe salir:

- `functions list` muestra `offer-media` activa.
- El `OPTIONS` responde `204`.
- El `POST` sin clave responde `{"error":"authentication_required"} 401`.

Si responde `503 offer_media_not_configured`, faltan los secretos `API_KEY`, `ANON_KEY` o `INSFORGE_BASE_URL`. Hoy
existen los tres (`npx -y @insforge/cli secrets list`).

## 6. URL pública del servicio de fotos

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
- Borra solo archivos sin foto registrada y con más de una hora: nunca fotos registradas ni subidas en curso.
- Tras la primera ejecución, `npx -y @insforge/cli schedules logs <id>` debe mostrar `200` con
  `{"checked":N,"removed":M}`.
- Debe seguir activa `connectical-hold-sweep`, el barrido de reservas.

## 8 y 9. Acceso permitido y denegado, y catálogo sin fotos privadas

Hacen falta cuentas de prueba **del equipo** que ya existan: un turista y, si se quiere probar la subida, un proveedor
aprobado con una oferta de prueba suya. No se crean usuarios, ofertas ni administradores para esto.

```sh
npm run verify:offer-media -- --traveler turista@equipo.com
npm run verify:offer-media -- --traveler turista@equipo.com --provider pousada@equipo.com --offer <uuid de su oferta de prueba>
```

El script pide las contraseñas sin mostrarlas. Debe terminar en `Offer photos verified`. Comprueba:

- **Sin sesión:** subir, limpiar y servir una foto desconocida fallan, y subir directo al bucket también.
- **Turista:** no puede subir por la función, ni directamente al bucket, ni listarlo, ni registrar fotos por RPC.
- **Catálogo sin sesión (paso 9):** cada foto visible pertenece a una oferta publicada y aprobada, y se sirve como
  imagen.
- **Proveedor:**
  - Un SVG disfrazado se rechaza.
  - Sube un PNG real y lo ve con su sesión.
  - Sin sesión solo se ve si la oferta está aprobada.
  - El turista no puede borrarlo.
  - Al final la borra (fila y archivo) y deja de servirse.

## 10. Recuperación ante fallos

Del cambio menos invasivo al más invasivo. Anotar qué paso falló y su salida.

| Situación | Qué hacer |
| --- | --- |
| La función falla o sirve algo indebido | `npx -y @insforge/cli functions delete offer-media`. Sin función no se sube ni se sirve ninguna foto; el catálogo muestra la ilustración de la categoría. La app sigue con `OFFER_PHOTOS_ENABLED = false` |
| La limpieza borra de más o falla | `npx -y @insforge/cli schedules list` y `schedules delete <id>` de `offer-media-cleanup` |
| Hay que retirar el bucket | Primero sin función ni limpieza; `npx -y @insforge/cli storage delete-bucket offer-media` (borra también sus objetos) |
| Hay que deshacer las migraciones 19 y 20 | Copiar [`docs/rollback/offer-media-photos.sql`](rollback/offer-media-photos.sql) a `migrations/` con el siguiente número libre (p. ej. `20261117000001_offer-media-rollback.sql`), copiarlo también a `supabase/migrations/` y aplicarlo con `npx -y @insforge/cli db migrations up <archivo>`. Quita las cuatro políticas y devuelve el registro de fotos a su versión anterior; está probado en `npm run test:insforge-compat`. No borra fotos ni archivos |
| Daño en datos | Restaurar la copia `pre-fotos` con `npx -y @insforge/cli backups restore <id>`. Sobrescribe toda la base y es la última opción; requiere su propia autorización |

En cualquier caso, `OFFER_PHOTOS_ENABLED` se queda en `false` y la app publicada no cambia.

## 11. Activar en la app (otra entrega)

Solo con los pasos 1 a 9 correctos:

1. `OFFER_PHOTOS_ENABLED = true` en `src/config/featureFlags.ts`.
2. `cd ios && pod install`, por el módulo nativo `react-native-image-picker`.
3. Compilar en un iPhone y un Android reales, y comprobar:
   - galería y cámara;
   - permisos (los textos de `Info.plist` ya están);
   - fotos HEIC del iPhone (el selector las convierte a JPEG);
   - progreso, cancelación, borrado;
   - el mensaje de error con el modo avión.
4. Publicar la build por el canal habitual.

## Registro

Anotar en `docs/operacion-AAAA-MM-DD.md`:

- Fecha y hora (UTC).
- Commit de `main`.
- Id de la copia `pre-fotos`.
- Salida resumida de cada paso.
- Quién lo ejecutó y quién lo autorizó.

No anotar correos, contraseñas, tokens ni claves.
