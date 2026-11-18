# Operación 17-11-2026 — migraciones y despliegue de fotos en buziosflow

Autorizado por el responsable del proyecto en las instrucciones de jornada del 17-11-2026 («migraciones pendientes» y
«completar el despliegue de fotografías, bucket y controles de acceso»). Ejecutado por Claude Code desde este Mac.

## Migraciones (22:22–22:23 -03, 01:22–01:23 UTC del 18-11)

Detalle y evidencia en [runbook-insforge-ensayo.md](runbook-insforge-ensayo.md), «Migraciones 18 a 26 aplicadas».
Commit de `main` de partida: `f0aa81c`. Resultado: 26 de 26, inventario idéntico.

## Despliegue de fotos (23:30–23:36 -03; 02:30–02:36 UTC del 18-11)

Commit de `main`: `586d669` (CI verde, incluido «Función offer-media en Deno»).

| Paso | Resultado |
| --- | --- |
| Antes de empezar | CLI `current` = buziosflow `bfab79dc-…`; sin buckets ni funciones; secretos `API_KEY`, `ANON_KEY` e `INSFORGE_BASE_URL` presentes (solo nombres) |
| 1. Respaldo | `npm run backup:verified` → `PASS` (1677 líneas de huella, 74 tablas), `~/RespaldosBuziosFlow/20261118_023052_snapshot`. Copia de plataforma **no renovada**: cupo 1/1 con `post-migraciones-15`, que se conserva por instrucción expresa |
| 2. Migraciones | Ya aplicadas en la operación anterior (26 de 26) |
| 3. Políticas | 4 `connectical_offer_media_*` RESTRICTIVE y las 4 `storage_objects_owner_*` de InsForge intactas; disparadores de moderación presentes |
| 4. Bucket | `offer-media` creado **privado** (`public = false`) |
| 5. Función | `offer-media` desplegada y activa (`deno check` de InsForge aceptado). Sin sesión: `OPTIONS` 204; limpieza 401; subir 401; borrar 401; foto desconocida 404 |
| 6. URL | `media_public_base_url` = `https://ykfv5j3m.function2.insforge.app/offer-media`, igual a la que construye la app (`offerMediaFunctionUrl`) |
| 7. Limpieza | Schedule `offer-media-cleanup` (`64f6762b-…`, `17 * * * *`, POST con `${{secrets.API_KEY}}`); `connectical-hold-sweep` sigue activo |
| Acceso anónimo (SDK con la clave de la app) | listar el bucket: rechazado; subir: rechazado; 0 fotos visibles; 0 objetos en el bucket |
| 8–9. Cuentas del equipo | **Pendiente**: buziosflow no tiene usuarios. Se hará con `npm run verify:offer-media` cuando existan el turista, el proveedor con oferta y el administrador del equipo |
| 10. Recuperación | Sin incidencias; procedimiento disponible |
| 11. Bandera | `OFFER_PHOTOS_ENABLED = __DEV__`: solo builds de desarrollo; release apagado hasta completar 8–9 y las pruebas en teléfonos |

La comprobación de punta a punta de la función con InsForge 2.3.5 real (subida, moderación, servir, borrar, limpieza,
intentos de saltarse la función) está en el laboratorio: `npm run lab:e2e`, 93 de 93 el 17-11-2026.
