# Registro de decisiones — Búzios Flow

Cada entrada: fecha, decisión, motivo y qué queda abierto. Las decisiones comerciales (tasas, políticas) no se
toman aquí: solo se deja la mecánica lista y apagada o sin valores.

## 2026-11-17 · Categorías como datos (202611160006)

- **Decisión:** las categorías viven en `connectical_categories` y las tablas que las usan tienen FK. Se suman
  `restaurantes` y `actividades`.
- **Motivo:** la lista estaba repetida en cuatro CHECK y en `provider_upsert_offer`; sumar una categoría exigía
  redefinir funciones. Ahora basta con una fila (y sus textos e icono en la app; una prueba Jest compara el orden
  sembrado con `PORTAL_CATEGORIES`).
- **Abierto:** referencias de comisión de las dos categorías nuevas (sembradas sin valor).

## 2026-11-17 · Promociones por oferta

- **Decisión:** porcentaje entero en puntos básicos (1-90 %), rango de fechas de servicio de hasta un año, sin solapes
  activos por oferta (bloqueo por oferta, igual que las cotizaciones). Se aplica la promoción vigente en la **fecha de
  inicio** del servicio, también para estancias de varias noches.
- **Quién financia:** el proveedor. Comisión y cargo al turista se calculan sobre el subtotal descontado; la cotización
  guarda `list_subtotal_cents`, `discount_cents` y `promotion_id`. `subtotal_cents` sigue siendo lo que se cobra, así
  que los paneles financieros existentes no cambian.
- **Versión de cotización:** `connectical-brl-v2-promo` solo cuando hay descuento; sin promoción sigue `connectical-brl-v1`.
- **Abierto:** confirmar con proveedores reales el modelo de financiación; descuentos de plataforma (cupones) no existen.

## 2026-11-17 · Comisión en tres niveles con trazabilidad

- **Decisión:** producto > proveedor+categoría > proveedor. La cotización guarda `provider_commission_source`
  (`offer`, `provider_category`, `provider`), redactado para el turista igual que la tasa. Cambios auditados en
  `connectical_admin_audit_log` (`category_rate_set`, `promotion_saved`).
- **Motivo:** el contrato de un proveedor puede variar por línea de negocio (p. ej. pousada y restaurante del mismo dueño)
  sin fijar tasa producto por producto.

## 2026-11-17 · Entorno

- `.env` → buziosflow (`ykfv5j3m`), el proyecto vinculado en `.insforge/project.json`. `.env.ofertasapp.local` →
  `8ntv6m27` (OfertasApp, sin confirmar si es ensayo), no lo lee la app. Connectical Logística no aparece en ninguna
  configuración. El prefijo `connectical_` de las tablas es un nombre heredado del módulo, no ese proyecto.
- Ninguna migración nueva se aplica sin autorización explícita, respaldo verificado (`npm run backup:verified`) y ensayo.
