# Matriz de estado por módulo — Búzios Flow

Actualizada el 14-11-2026 (tarde), sobre la rama `work/dev-2026-11-14c`. "Probado" significa con pruebas automatizadas
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
| Pagos simulados (tarjeta, Pix) | SIMULADO | `simulate_payment`: aprobado, rechazado, pendiente, reintentos | — |
| Webhooks de pasarela | PARCIAL | Ingesta idempotente con revisión de doble cobro (0008), probada; **falta el manejador firmado** y una pasarela contratada | P1 |
| Pagos reales | BLOQUEADO | Sin pasarela contratada ni tarifas confirmadas; ningún código cobra | Decisión comercial |
| Reembolsos | SIMULADO | Registro de admin idempotente con topes (0003); sin devolución bancaria | — |
| Política de cancelación | PARCIAL | Motor configurable probado, **apagado**, sin política aprobada | Decisión comercial |
| Comisiones | PARCIAL | Por proveedor y por producto, solo admin, congeladas por cotización (0007); referencias sin aprobar; Buggy sin tasa | Decisión comercial |
| Cargo al turista 4/6/8 % | SIMULADO | 6 % como escenario por defecto; no es tarifa aprobada | Decisión comercial |
| Tipos de cambio | SIMULADO | Tasas fijas etiquetadas como demostración; sin fuente cambiaria real | P2 |
| Panel admin: finanzas | COMPLETO | Retenido no es ingreso, bruto/neto/cargo/comisión conciliados, estados inconsistentes | — |
| Panel admin: proveedores, tasas, auditoría | COMPLETO | Pausa/reactivación, tasas por producto, auditoría con autoría solo por RPC | — |
| Panel admin: usuarios, promociones, aprobación de publicaciones | NO IMPLEMENTADO | Los roles se asignan por SQL (PROVISIONING) | P2 |
| Portal proveedor: ofertas, cupo, rangos, reservas | COMPLETO | Validación de propiedad y proveedor activo en SQL | — |
| Portal proveedor: fotos, ubicación, horarios, políticas, ingresos | NO IMPLEMENTADO | El modelo de oferta solo tiene título, categoría, precio y modalidad | P1 |
| Registro de proveedores | NO IMPLEMENTADO | Alta manual por la administración | P2 |
| Autenticación correo/contraseña | PARCIAL | Implementada con el SDK; no probada contra el tenant | Bloqueado por tenant |
| OAuth | BLOQUEADO | No configurado; requiere credenciales y aprobación | Decisión humana |
| Catálogo unificado | PARCIAL | Detrás de `SHARED_CATALOG_ENABLED` (apagado); probado con mocks | Bloqueado por tenant |
| Categorías | COMPLETO | Pousadas, barcos, noche/discotecas, buggy y experiencias VIP (0007) | — |
| Recorrido demo del turista | COMPLETO | Exploración → detalle → viaje → confirmación demo, fechas de Búzios | — |
| Fotos, mapas, favoritos, promociones | NO IMPLEMENTADO | No hay fotografías autorizadas ni proveedor de mapas elegido | P2 |
| Notificaciones y comprobantes | NO IMPLEMENTADO | Requiere proveedor de correo/push | P2 |
| Idiomas ES/PT | COMPLETO | Contrato de errores SQL ↔ textos; etiquetas accesibles | — |
| Inglés | NO IMPLEMENTADO | Arquitectura preparada (`Record<Language, …>`); traducción pendiente de revisión humana | P2 |
| Privacidad de identificadores | COMPLETO | Privilegios por columna (0005), sondas de fuga y verificación automática | P0 hecho |
| iOS | PARCIAL | Build Debug para simulador compila; **no ejecutado**: CoreSimulator desactualizado | Bloqueado (equipo) |
| Android | BLOQUEADO | Sin Java ni Android SDK en el equipo | Bloqueado (equipo) |
| CI | COMPLETO | Jest, tsc, ESLint, integración PostgreSQL y ensayo de actualización en cada push | — |
| Despliegue InsForge | BLOQUEADO | Tenant sin confirmar; runbook y preflight listos | Decisión humana |
