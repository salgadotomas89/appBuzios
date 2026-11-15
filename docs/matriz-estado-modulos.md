# Matriz de estado por módulo — Búzios Flow

Actualizada el 14-11-2026 (noche), sobre la rama `work/dev-2026-11-15`. "Probado" significa con pruebas automatizadas
en este repositorio (Jest o PostgreSQL 17 local en Docker); **nada está desplegado ni operativo en producción**.
InsForge remoto no tiene aplicada ninguna migración.

Estados: **COMPLETO** (implementado y probado localmente) · **PARCIAL** · **SIMULADO** (funciona sin efectos reales) ·
**BLOQUEADO** (depende de algo externo) · **NO IMPLEMENTADO**.

| Módulo | Estado | Evidencia o motivo | Prioridad |
| --- | --- | --- | --- |
| Inventario por noche y concurrencia | COMPLETO | Migraciones 0001/202611140001; carreras de 8 sesiones, varias habitaciones, cancelación concurrente, Año Nuevo; conciliación global | P0 hecho |
| Retenciones de 10 min y expiración diferida | COMPLETO | Se liberan al listar o reservar; pruebas de retención vencida | P0 hecho |
| Barrido programado de retenciones | PARCIAL | Función con registro, sin solapes y aislamiento por oferta (0006), probada; **scheduler no instalado** (bloqueado por tenant) | P0 |
| Idempotencia de reservas | COMPLETO | Doble envío simultáneo, reintento tras vencer la cotización | P0 hecho |
| Pagos simulados (tarjeta, Pix) | SIMULADO | `simulate_payment`: aprobado, rechazado, pendiente, reintentos; interruptor en la base de datos (0010), que hay que apagar antes de una pasarela real | — |
| Webhooks de pasarela | PARCIAL | Ingesta idempotente con revisión de doble cobro (0008), probada; **falta el manejador firmado** y una pasarela contratada | P1 |
| Pagos reales | BLOQUEADO | Sin pasarela contratada; tres controles independientes apagados y ningún adaptador en vivo ([arquitectura-pagos.md](arquitectura-pagos.md)) | Decisión comercial |
| Reembolsos | SIMULADO | Registro de admin idempotente con topes (0003); sin devolución bancaria | — |
| Política de cancelación | PARCIAL | Motor configurable probado, **apagado**, sin política aprobada | Decisión comercial |
| Comisiones | PARCIAL | Por proveedor y por producto, solo admin, congeladas por cotización (0007); referencias sin aprobar; Buggy sin tasa | Decisión comercial |
| Cargo al turista 4/6/8 % | SIMULADO | 6 % como escenario por defecto; no es tarifa aprobada | Decisión comercial |
| Tipos de cambio | SIMULADO | Tasas fijas etiquetadas como demostración; sin fuente cambiaria real | P2 |
| Panel admin: finanzas | COMPLETO | Retenido no es ingreso, bruto/neto/cargo/comisión conciliados, estados inconsistentes | — |
| Panel admin: proveedores, tasas, auditoría | COMPLETO | Pausa/reactivación, tasas por producto, auditoría con autoría solo por RPC | — |
| Panel admin: solicitudes, moderación, incidencias, usuarios, indicadores, actividad, campañas | COMPLETO | Migraciones 202611150001/0002 y consola admin; todo validado en SQL. Campañas solo de contenido (sin descuentos). Los roles de admin siguen asignándose por SQL | — |
| Portal proveedor: ofertas, cupo, rangos, reservas | COMPLETO | Validación de propiedad y proveedor activo en SQL | — |
| Portal proveedor: descripción, ubicación, horario, límites por reserva, ingresos | COMPLETO | Migración 0009 y resumen de ingresos | — |
| Fotos de ofertas | PARCIAL | Política de imágenes, adaptador de almacenamiento, metadatos en SQL (202611150003) y galería; **sin bucket confirmado** (adaptador desactivado) y sin selector de fotos en el teléfono (requiere otra dependencia nativa) | P1, bloqueado por tenant |
| Políticas propias del proveedor | NO IMPLEMENTADO | Esperan la política comercial | Decisión comercial |
| Registro de proveedores | COMPLETO | Solicitud del turista, revisión admin con comisión explícita, estado visible para el solicitante | — |
| Autenticación y sesión persistente | PARCIAL | Sesión en Keychain/Keystore con renovación y caducidad (flujo móvil del SDK); probada con dobles y compilada en iOS; **no probada en dispositivo ni contra el tenant** ([autenticacion-oauth.md](autenticacion-oauth.md)) | P1 |
| OAuth | BLOQUEADO | No configurado; contrato PKCE y URI de retorno propuestos en [autenticacion-oauth.md](autenticacion-oauth.md) | Decisión humana |
| Catálogo unificado | PARCIAL | Detrás de `SHARED_CATALOG_ENABLED` (apagado); legible sin sesión desde 202611150004 (antes fallaba para visitantes) | Bloqueado por tenant |
| Categorías | COMPLETO | Pousadas, barcos, noche/discotecas, buggy y experiencias VIP (0007) | — |
| Recorrido demo del turista | COMPLETO | Exploración → detalle → viaje → confirmación demo, fechas de Búzios | — |
| Favoritos y filtros por fecha y personas | COMPLETO | Favoritos locales sin datos personales; filtros con cupo real publicado | — |
| Mapas | NO IMPLEMENTADO | Sin proveedor de mapas elegido | P2 |
| Notificaciones y comprobantes | NO IMPLEMENTADO | Requiere proveedor de correo/push | P2 |
| Idiomas ES/PT | COMPLETO | Contrato de errores SQL ↔ textos; etiquetas accesibles | — |
| Inglés | PARCIAL | Interfaz y contenido de ejemplo traducidos, con aviso visible de traducción pendiente de revisión profesional; términos legales no aprobados en inglés | Revisión humana |
| Privacidad de identificadores y comisiones | COMPLETO | 0005 y 0010: el proveedor no lee uuid de turistas (tampoco en cotizaciones) y el turista no recibe la comisión B2B en ninguna lectura ni respuesta; sondas de fuga y verificación automática | P0 hecho |
| iOS | PARCIAL | Build Debug para simulador compila; **no ejecutado**: CoreSimulator desactualizado | Bloqueado (equipo) |
| Android | BLOQUEADO | Sin JDK 17 ni Android SDK; `scripts/setup-android-env.sh` lo instala con aprobación. El release ya no firma con la clave debug (cambio de Gradle sin compilar aquí) | Bloqueado (equipo) |
| CI | COMPLETO | Jest, tsc, ESLint, integración PostgreSQL y ensayo de actualización en cada push | — |
| Despliegue InsForge | BLOQUEADO | Tenant sin confirmar; runbook y preflight listos | Decisión humana |
