# Políticas comerciales pendientes de decisión — Búzios Flow

Para el responsable del negocio. Estado al 17-11-2026: **toda la mecánica existe, está probada y aplicada en
buziosflow, pero ninguna política está aprobada** y no hay cobros reales. Cada punto dice qué hay hoy, qué hay que
decidir y cómo se activa después (sin cambios de código salvo donde se indica).

## 1. Comisión del proveedor

| Categoría | Referencia cargada (sin aprobar) |
| --- | --- |
| Pousadas (alojamiento) | 10 % |
| Barcos | 18 % |
| Noche / discotecas | 15 % |
| Experiencias VIP | 18–20 % |
| Buggy, restaurantes, actividades | **sin valor** |

- **Hoy:** cada proveedor recibe una comisión obligatoria al aprobar su solicitud. La administración puede fijar una
  distinta por categoría para un proveedor o por producto. La cotización guarda la tasa y el nivel usados; cambiarla
  no altera reservas ya cotizadas. La consola avisa si una tasa queda fuera de la referencia.
- **Decidir:** las tasas de buggy, restaurantes y actividades, y si las referencias pasan a «aprobadas».
- **Activar:** se aplican al aprobar cada proveedor (Proveedores → Solicitudes) y, si hace falta, en «Comisión por
  categoría». Marcar las referencias como aprobadas es una consulta SQL de una línea por categoría.

## 2. Cargo de servicio al turista

- **Hoy:** 4 %, 6 % u 8 % sobre el subtotal; la demo usa 6 % como escenario. Es aparte de la comisión del proveedor.
- **Decidir:** un único porcentaje (o ninguno) para el lanzamiento.
- **Activar:** fijar el valor por defecto de la app (cambio de código de una línea y CI).

## 3. Promociones y descuentos

- **Hoy:** el proveedor crea descuentos de 1 a 90 % por fechas, sin solapes; **los financia él**: la comisión y el
  cargo se calculan sobre el precio rebajado. No existen cupones ni descuentos pagados por la plataforma.
- **Decidir:** confirmar con proveedores que aceptan financiar el descuento, y si debe haber un tope (por ejemplo,
  50 %) o aprobación previa de la administración.
- **Activar:** ya está activo para proveedores aprobados. Un tope distinto o aprobación previa requiere una migración
  pequeña.

## 4. Cancelación y reembolso

- **Hoy:** el turista, el proveedor o la administración pueden cancelar; el reembolso lo registra la administración a
  mano (tope en lo cobrado, sin duplicados). Hay un motor de política por tramos **apagado**
  (`CANCELLATION_POLICY_ENABLED = false`) sin ninguna política cargada.
- **Decidir:** los tramos (por ejemplo, 100 % con 48 h o más, 50 % entre 48 y 24 h, 0 % con menos de 24 h), si el
  cargo de servicio se devuelve, y que una cancelación del proveedor devuelve todo.
- **Activar:** cargar la política aprobada como datos y encender el interruptor (cambio de código revisado y CI). La
  base sigue siendo la autoridad: el reembolso lo confirma la administración.

## 5. Moderación de ofertas nuevas

- **Hoy:** `offer_moderation_required = false`: la oferta de un proveedor aprobado se publica al guardarla. Fotos y
  publicaciones sí esperan revisión siempre.
- **Decidir:** si para el piloto cada oferta nueva espera aprobación (recomendado mientras haya pocos proveedores).
- **Activar:** una consulta preparada en [piloto-cerrado.md](piloto-cerrado.md).

## 6. Pagos

- **Hoy:** solo pagos simulados (tarjeta y Pix), marcados como tales. Tres controles independientes impiden cobrar.
- **Decidir:** pasarela (Mercado Pago figura como candidata sin verificar) y contrato.
- **Activar:** ver [arquitectura-pagos.md](arquitectura-pagos.md); requiere un adaptador nuevo, revisión de seguridad y
  pruebas en sandbox antes de encender nada.
