# Auditoría de seguridad de las fotos de ofertas — 15-11-2026

Alcance:

- Migraciones `20261116000003` (registro solo por la función), `20261116000004` (bucket cerrado a las sesiones) y
  `20261116000005` (moderación).
- La función [`functions/offer-media.ts`](../functions/offer-media.ts).
- El cliente de la app (`src/media/`, `src/components/OfferPhotoManager.tsx`) y la bandeja de administración.

Nada de esto está desplegado en buziosflow. Las pruebas son locales o de CI:

- **Jest:** Node, con almacén y base simulados.
- **PostgreSQL:** harnesses en Docker con las migraciones reales.
- **Deno:** el `deno check` de InsForge y el manejador detrás de una copia de su router.
- **Laboratorio InsForge 2.3.5:** ejecutado el 15-11 antes de la moderación. Ya está adaptado a la moderación, pero
  no se ha vuelto a ejecutar por falta de disco.

## Resultado por amenaza

| Amenaza | Defensa | Prueba adversarial | Resultado |
| --- | --- | --- | --- |
| Subir fotos a una oferta ajena | La base decide como el usuario (`connectical_can_manage_offer`) | Turista y otro proveedor suben y borran por la función; la clave de API usada como token de usuario | 403/401, sin archivo ni fila |
| Token falso o caducado | La función comprueba la sesión con InsForge antes de escribir nada | Token inventado | 401, nada escrito en el bucket |
| Subir directo al bucket | `…0004`: cuatro políticas RESTRICTIVE cierran `offer-media` a toda sesión | Proveedor, administrador, turista y sin sesión insertan, leen, cambian y borran objetos | Todo denegado; los demás buckets siguen igual |
| Registrar por RPC un archivo subido directamente | `…0003`: solo se registra si lo escribió la clave de API (`uploaded_by` nulo) con el mismo tamaño y tipo | Archivo inexistente, archivo a nombre del proveedor, tamaño o tipo distintos | `invalid_media` en todos los casos |
| Fotos públicas sin aprobar | `…0005`: lectura pública solo con la foto `approved` y la oferta publicada y aprobada; la función sirve sin sesión solo lo que esa lectura devuelve | Foto pendiente, rechazada, cambiada tras aprobarla y de oferta suspendida | Ninguna visible sin sesión; mutación que quita la condición: detectada |
| Proveedor que se aprueba sus fotos | Sin permiso de escritura en la tabla; RPC solo para administración; trigger que rechaza cambios de estado de sesiones no administradoras; la inserción siempre nace `pending` | RPC, `update` directo, `update` con permisos de superusuario y sesión de proveedor, `insert` con estado `approved` | Denegado o forzado a `pending`; mutación sin el trigger: detectada |
| Rechazo sin motivo o sin rastro | La RPC exige motivo (3–300 caracteres) y escribe `media_approved` o `media_rejected` en el registro de actividad con actor, estado anterior, nuevo y motivo | Rechazo con motivo en blanco; comprobación del registro | Rechazado; registro completo |
| Reemplazar una foto aprobada sin revisión | Reemplazar es borrar y subir (nace `pending`); si cambia el contenido de una fila, el trigger la vuelve a `pending` | Cambio del texto alternativo de una foto aprobada | Deja de ser pública hasta otra aprobación |
| Superar los límites con peticiones simultáneas | Función: 2 a la vez y 20 cada 10 minutos por usuario (en cada instancia). Base: 30 por hora con bloqueo por usuario | 25 subidas a la vez; dos registros simultáneos en ofertas distintas con 29 hechas | 2 aceptadas y 23 con 429; solo 1 de las 2 en la base; mutación sin bloqueo: detectada |
| Archivo malicioso o disfrazado | Tipo y medidas leídos de los bytes; HTML, SVG, GIF y HEIC rechazados; cuerpo cortado al pasar de 5 MB aunque llegue por bloques; al servir se revalida y va con `nosniff` y `CSP default-src 'none'` | SVG con `onload`, HTML con `.png`, PNG de 10×10, flujo de 40 MB, archivo HTML registrado por RPC | 422/413 o 404; nada guardado |
| Ubicación en los metadatos | **Nuevo:** la función vacía el GPS de EXIF (y pone a cero sus datos) y quita XMP, IPTC, comentarios y los textos de PNG y WebP antes de guardar; conserva la orientación | JPEG con EXIF GPS, XMP con coordenadas y comentario con dirección; PNG con `tEXt`/`eXIf`; WebP con EXIF/XMP | Sin rastro de las coordenadas; orientación intacta; mutación sin la limpieza: detectada |
| Huérfanos tras un error | Si la base rechaza o no responde, la función borra el archivo; si borrar falla, la limpieza horaria lo retira | Rechazo, excepción de red, fallo al borrar, fallo al subir | Sin archivo; el que no se pudo borrar desaparece en la limpieza |
| Limpieza que borra fotos válidas | Solo borra objetos sin fila con más de una hora; solo con la clave de API | Fotos registradas de 30 días, subida en curso de 1 minuto, llamada sin clave | Se conservan; 401 sin clave |
| Errores de la base | Errores de RPC traducidos a códigos HTTP; excepciones a 500/502 sin detalles internos | RPC que lanza, almacén caído | 502 sin dejar archivos |
| Incompatibilidad con InsForge Cloud | Mismo `deno check` que InsForge antes de desplegar; router copiado de 2.3.5; SDK real de npm | CI «Función offer-media en Deno» | Pasa (antes encontró dos errores que habrían impedido desplegar) |

## Riesgos que quedan

- Los límites de la función son por instancia. El que vale para todas es el de la base: 30 fotos por usuario y
  hora.
- Una foto aprobada que después se rechaza puede seguir en cachés durante 60 segundos como mucho (`max-age=60`).
- No se recodifican las imágenes. Un archivo que es imagen válida y además contiene otros datos al final se sirve
  como imagen, con `nosniff` y CSP, así que el navegador no lo ejecuta.
- La limpieza de metadatos de WebP quita bloques completos. No se probó con WebP animados reales.
- Las fotos rechazadas cuentan para el máximo de 10 hasta que el proveedor las borra.
- El límite global de InsForge sigue en 50 MB por archivo, pero nadie puede escribir en `offer-media` sin la
  función, que corta a 5 MB.
