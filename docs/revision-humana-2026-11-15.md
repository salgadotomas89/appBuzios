# Revisión humana — domingo 15 de noviembre de 2026 (tarde)

Lo que la operación nocturna no pudo ni debía resolver sin una persona. Ordenado por prioridad.
Bitácora técnica: [operacion-nocturna-2026-11-14.md](operacion-nocturna-2026-11-14.md).

## 1. Identificar el tenant InsForge (bloquea todo lo remoto)

- Confirmar en el panel de InsForge que `8ntv6m27.us-east.insforge.app` (proyecto OfertasApp) es **ensayo**, no
  producción, y que no comparte base con Connectical Logística.
- Ejecutar el preflight de solo lectura de [supabase/PROVISIONING.md](../supabase/PROVISIONING.md#preflight-read-only-before-applying-the-migrations).
- Si hace falta una sesión OAuth del CLI de InsForge, autorizarla en persona; no se hizo durante la noche.

## 2. Aplicar las migraciones en el tenant de ensayo

En este orden, cada una en una ejecución separada, y luego las verificaciones del preflight:

1. `supabase/migrations/202611110001_shared_reservations.sql`
2. `supabase/migrations/202611140001_multi_night_inventory.sql`: inventario por noche, fechas pasadas, endurecimiento.
3. `supabase/migrations/202611140002_system_hold_sweep.sql`: barrido sin sesión para un scheduler futuro.

Las tres pasan contra `postgres:17` local (`npm run test:shared-reservations`) y en GitHub Actions. **No** se probaron
contra InsForge: la compatibilidad de `auth.uid()`, de los roles `anon` y `authenticated` y del trigger sobre
`auth.users` hay que confirmarla allí.

## 3. Aprovisionar cuentas de ensayo y probar entre dispositivos

- Crear las cuentas de proveedor y de admin con correos controlados y asignar los roles con el script de PROVISIONING.
- Recorrido mínimo: el proveedor publica una oferta por noche con cupo para 3 noches; dos turistas en dispositivos
  distintos intentan estancias solapadas (una debe fallar con "No queda cupo suficiente"); pago simulado aprobado,
  rechazado y pendiente; cancelación; el admin revisa totales e historial.

## 4. Scheduler de expiración

- Confirmar si InsForge permite tareas programadas con un rol de confianza. Si lo permite, programar
  `select public.connectical_system_expire_holds();` cada 1–5 minutos. Mientras no exista, la expiración sigue siendo
  diferida: se reconcilia al listar reservas o al reservar la misma oferta.

## 5. Decisiones comerciales y financieras

- Comisión de Buggy (sigue pendiente).
- Política de cancelación y reembolso: hoy turista, proveedor y admin pueden cancelar una reserva confirmada sin
  penalización y sin registrar reembolso (`refund_cents` queda en 0). Hay que definir plazos, porcentajes y quién asume
  cada coste antes de cobrar.
- Tarifas reales de la pasarela (Pix y tarjeta), liquidación, FX, cuotas, impuestos y contracargos. Las tasas FX de la
  demo están fijas y etiquetadas como demostración.
- Validar proveedores y tarifas reales; todo el catálogo actual es ficticio.

## 6. GitHub

- `gh` no tiene sesión en este equipo, así que no se pudo abrir el PR desde la terminal. La rama
  `work/night-2026-11-14` está publicada y el CI corre en cada push.
- Valorar activar la protección de `main` exigiendo los dos checks de CI ("Jest, TypeScript y ESLint" e
  "Integración PostgreSQL local").

## 7. Dispositivos

- Build iOS y Android: no se ejecutaron esta noche. Sigue pendiente el acceso a CoreSimulator/Xcode documentado en el
  README.

## 8. Riesgos conocidos

- `zod < 4.6.6` (alto, agotamiento de memoria) llega vía `@insforge/sdk@1.5.2`, que es la última versión publicada.
  No hay corrección upstream; revisar cuando InsForge publique una actualización.
- `reservationBackend.ts` (en memoria) sigue el modelo antiguo de una sola fecha. Solo lo usan los tests; la app usa
  el servicio compartido.
