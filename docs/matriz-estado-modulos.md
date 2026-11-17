# Matriz de estado por módulo — Búzios Flow

Actualizada el 14-11-2026 (noche); ciclo de catálogo y comercio el 17-11-2026 en `work/mvp-2026-11-16`, sobre la rama `work/dev-2026-11-15`. "Probado" significa con pruebas automatizadas
en este repositorio (Jest o PostgreSQL 17 local en Docker); **nada está desplegado ni operativo en producción**.
Actualización 15-11-2026: 17 de 20 migraciones aplicadas y verificadas en el proyecto InsForge buziosflow (sin datos). Las
tres de fotos (registro solo por la función, bucket cerrado a las sesiones y moderación) están preparadas y ensayadas en el laboratorio
InsForge 2.3.5 (`npm run lab:e2e`), pendientes de autorización; sí se pueden aplicar con el CLI (`insforge_pg_utils`).

Estados: **COMPLETO** (implementado y probado localmente) · **PARCIAL** · **SIMULADO** (funciona sin efectos reales) ·
**BLOQUEADO** (depende de algo externo) · **NO IMPLEMENTADO**.

| Módulo | Estado | Evidencia o motivo | Prioridad |
| --- | --- | --- | --- |
| Inventario por noche y concurrencia | COMPLETO | Migraciones 0001/202611140001; carreras de 8 sesiones, varias habitaciones, cancelación concurrente, Año Nuevo; conciliación global | P0 hecho |
| Retenciones de 10 min y expiración diferida | COMPLETO | Se liberan al listar o reservar; pruebas de retención vencida | P0 hecho |
| Barrido programado de retenciones | COMPLETO | Función con registro, sin solapes y aislamiento por oferta (0006), probada; schedule `connectical-hold-sweep` cada 2 minutos en buziosflow, ejecutando con éxito (15-11-2026); retención del registro aplicada (20261116000001) y comprobada en una pasada real | P0 hecho |
| Idempotencia de reservas | COMPLETO | Doble envío simultáneo, reintento tras vencer la cotización | P0 hecho |
| Pagos simulados (tarjeta, Pix) | SIMULADO | `simulate_payment`: aprobado, rechazado, pendiente, reintentos; interruptor en la base de datos (0010), que hay que apagar antes de una pasarela real | — |
| Webhooks de pasarela | PARCIAL | Ingesta idempotente con revisión de doble cobro (0008), probada; **falta el manejador firmado** y una pasarela contratada | P1 |
| Pagos reales | BLOQUEADO | Sin pasarela contratada; tres controles independientes apagados y ningún adaptador en vivo ([arquitectura-pagos.md](arquitectura-pagos.md)) | Decisión comercial |
| Reembolsos | SIMULADO | Registro de admin idempotente con topes (0003); sin devolución bancaria | — |
| Política de cancelación | PARCIAL | Motor configurable probado, **apagado**, sin política aprobada | Decisión comercial |
| Comisiones | PARCIAL | Tres niveles: producto > proveedor+categoría > proveedor, solo admin y auditado; cada cotización congela la tasa y guarda el nivel aplicado (`provider_commission_source`, nunca visible al turista) — 202611160006 y sección «Comisión por categoría» de la consola; **migración sin aplicar**; referencias sin aprobar; Buggy, Restaurantes y Actividades sin tasa | Decisión comercial y aplicar 202611160006 |
| Cargo al turista 4/6/8 % | SIMULADO | 6 % como escenario por defecto; no es tarifa aprobada | Decisión comercial |
| Tipos de cambio | SIMULADO | Tasas fijas etiquetadas como demostración; sin fuente cambiaria real | P2 |
| Panel admin: finanzas | COMPLETO | Retenido no es ingreso, bruto/neto/cargo/comisión conciliados, estados inconsistentes | — |
| Panel admin: proveedores, tasas, auditoría | COMPLETO | Pausa/reactivación, tasas por producto, auditoría con autoría solo por RPC | — |
| Panel admin: solicitudes, moderación, incidencias, usuarios, indicadores, actividad, campañas | COMPLETO | Migraciones 202611150001/0002 y consola admin; todo validado en SQL. Campañas solo de contenido (sin descuentos). Los roles de admin siguen asignándose por SQL | — |
| Portal proveedor: ofertas, cupo, rangos, reservas | COMPLETO | Validación de propiedad y proveedor activo en SQL | — |
| Portal proveedor: descripción, ubicación, horario, límites por reserva, ingresos | COMPLETO | Migración 0009 y resumen de ingresos | — |
| Fotos de ofertas | PARCIAL | Selector (galería y cámara), gestor del proveedor con estado de cada foto, bandeja de revisión de la administración, función `offer-media` (valida bytes, quita metadatos de ubicación, límites, sirve solo lo aprobado) y migraciones 202611160003/0004/0005, probadas en Jest, PostgreSQL y Deno (auditoría en docs/auditoria-fotos.md); **sin desplegar, sin bucket**, oculto con `OFFER_PHOTOS_ENABLED` y sin probar en teléfonos reales | Autorización de despliegue y prueba en dispositivos |
| Políticas propias del proveedor | NO IMPLEMENTADO | Esperan la política comercial | Decisión comercial |
| Registro de proveedores | COMPLETO | Solicitud del turista, revisión admin con comisión explícita, estado visible para el solicitante | — |
| Autenticación y sesión persistente | PARCIAL | Sesión en Keychain/Keystore con renovación y caducidad (flujo móvil del SDK); endpoint móvil comprobado contra buziosflow; errores de acceso traducidos (ES/PT/EN); recuperación de contraseña por código. **Sin probar en dispositivo** y sin confirmar la entrega de códigos por correo (`scripts/verify-email-delivery.mjs`); el correo llega en inglés sin SMTP propio | P1 |
| OAuth | BLOQUEADO | No configurado; contrato PKCE y URI de retorno propuestos en [autenticacion-oauth.md](autenticacion-oauth.md) | Decisión humana |
| Catálogo unificado | PARCIAL | Detrás de `SHARED_CATALOG_ENABLED` (apagado en `main`); lectura sin sesión comprobada contra buziosflow con el SDK (catálogo, inventario y fotos) | Recorrido en dispositivo |
| Categorías | COMPLETO (local) | Pousadas, barcos, noche/discotecas, buggy, experiencias VIP, **restaurantes y actividades**; desde 202611160006 son datos (`connectical_categories`, FK en ofertas, solicitudes, campañas y referencias) en vez de listas fijas. Sin ofertas de ejemplo inventadas para las nuevas | Aplicar 202611160006 |
| Promociones y descuentos | COMPLETO (local) | Descuento 1-90 % por fechas de servicio, sin solapes por oferta, creado por el proveedor dueño o admin y auditado; la cotización congela precio de lista, descuento y promoción; comisión y cargo sobre el precio descontado (lo financia el proveedor). Catálogo público muestra precio tachado según la fecha elegida; gestor en el portal del proveedor. **Migración sin aplicar** | Aplicar 202611160006; validar con proveedores quién financia el descuento |
| Búsqueda | COMPLETO | Sin distinguir acentos ni mayúsculas, todas las palabras, sobre título, ubicación, descripción y categoría | — |
| Recorrido demo del turista | COMPLETO | Exploración → detalle → viaje → confirmación demo, fechas de Búzios | — |
| Favoritos y filtros por fecha y personas | COMPLETO | Favoritos locales sin datos personales; filtros con cupo real publicado | — |
| Mapas | NO IMPLEMENTADO | Sin proveedor de mapas elegido | P2 |
| Notificaciones y comprobantes | NO IMPLEMENTADO | Requiere proveedor de correo/push | P2 |
| Idiomas ES/PT | COMPLETO | Contrato de errores SQL ↔ textos; etiquetas accesibles | — |
| Inglés | PARCIAL | Interfaz y contenido de ejemplo traducidos, con aviso visible de traducción pendiente de revisión profesional; términos legales no aprobados en inglés | Revisión humana |
| Privacidad de identificadores y comisiones | COMPLETO | 0005 y 0010: el proveedor no lee uuid de turistas (tampoco en cotizaciones) y el turista no recibe la comisión B2B en ninguna lectura ni respuesta; sondas de fuga y verificación automática | P0 hecho |
| iOS | PARCIAL | Compila y **arranca en un iPhone 17 Pro simulado** sin errores en los logs; bundle de producción en CI. Falta el recorrido manual y un iPhone real | P1 |
| Android | BLOQUEADO | Sin JDK 17 ni Android SDK; `scripts/setup-android-env.sh` lo instala con aprobación. El release ya no firma con la clave debug (cambio de Gradle sin compilar aquí) | Bloqueado (equipo) |
| CI | COMPLETO | Jest, tsc, ESLint, integración PostgreSQL y ensayo de actualización en cada push | — |
| Despliegue InsForge | PARCIAL | buziosflow: 17 de 20 migraciones con verificación y conciliación; respaldo de plataforma `post-migraciones-15` y volcado local con recuperación comprobada (`npm run backup:verified`). Faltan las tres de fotos (autorización) y comprobar los códigos de correo con una cuenta real | P0 |
