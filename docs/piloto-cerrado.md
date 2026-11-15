# Primer piloto cerrado — preparación y criterios

Para el equipo que ejecute el piloto. **El piloto no está listo**: falta aplicar las migraciones en el tenant de ensayo,
probar el backend remoto y hacer al menos un recorrido real en un iPhone o Android. Reservas comerciales y pagos reales
siguen apagados; todo cobro es simulado.

## Evidencia sobre el tenant (14-11-2026, 21:51, solo lectura)

Con la clave anónima pública que ya lleva la app (`.env`), sin crear ni modificar nada:

| Comprobación | Resultado |
| --- | --- |
| Host configurado en la app | `8ntv6m27.us-east.insforge.app` |
| `GET /api/auth/public-config` | 200: registro abierto, verificación de correo **obligatoria por código**, contraseña mínima 6, OAuth Google y GitHub ya configurados |
| Lectura de `connectical_offers` (`limit=0`) | 404 `42P01 relation does not exist`: **ninguna migración aplicada** |

Esto **no prueba** que el proyecto sea OfertasApp, que sea de ensayo ni que esté aislado de Connectical Logística: eso
solo se confirma en el panel de InsForge. No hay `.insforge/project.json` ni sesión del CLI en este equipo.

## Antes del piloto (intervención humana)

1. Confirmar en el panel de InsForge proyecto, entorno de ensayo y aislamiento; crear un snapshot.
2. Seguir [runbook-insforge-ensayo.md](runbook-insforge-ensayo.md): preflight, quince migraciones, verificación,
   conciliación e inventario del esquema (debe coincidir con `supabase/checks/expected_schema_inventory.txt`).
3. Configuración preparada para el piloto (**no aplicada en ningún entorno real**):

   ```sql
   -- Cada oferta nueva espera la aprobación de la administración.
   update public.connectical_settings set value = 'true', updated_at = now() where key = 'offer_moderation_required';
   -- Pagos simulados encendidos solo en ensayo (apagarlos antes de cualquier pasarela real).
   select value from public.connectical_settings where key = 'simulated_payments_enabled';  -- true
   -- URL pública del bucket, cuando esté confirmado (sin ella no se registran fotos).
   insert into public.connectical_settings (key, value) values ('media_public_base_url', '"https://<bucket>/"')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

4. Asignar el rol de administración a una cuenta controlada por el equipo (PROVISIONING). Las demás cuentas se
   registran desde la app y verifican el correo con el código.
5. Compilar un build de ensayo con `SHARED_CATALOG_ENABLED = true` en una rama aparte (no en `main`).
6. Entorno de dispositivos: [entorno-movil.md](entorno-movil.md) (CoreSimulator y Android requieren administrador).

## Recorrido del piloto

`npm run test:pilot-e2e` ejecuta este mismo recorrido con datos sintéticos sobre PostgreSQL local, y corre en CI.
En el piloto se repite a mano, en dispositivos, contra el tenant de ensayo:

| Paso | Quién | Qué comprobar |
| --- | --- | --- |
| 0 | Turistas | Registro, código de verificación por correo, sesión que sobrevive a cerrar y reabrir la app |
| 1 | Proveedor | Solicitud de alta; el admin la aprueba indicando la comisión del contrato |
| 2 | Proveedor | Oferta con detalle, cupo por rango y foto; queda oculta hasta que el admin la aprueba |
| 3 | Dos turistas | Intentan a la vez la última habitación en noches solapadas: solo uno la retiene |
| 4 | Turista | Pago simulado pendiente y después aprobado; el turista no ve la comisión, el proveedor sí |
| 5 | Turista y admin | Cancelación de la reserva pagada; el admin registra el reembolso simulado |
| 6 | Turista y admin | Incidencia reportada y respondida |
| 7 | Admin | Indicadores, registro de actividad, `reconcile_inventory.sql` sin filas |

Además, en dispositivo: modo avión al reabrir (la sesión se conserva y se avisa), cierre de sesión y reapertura (pide
iniciar sesión), cambio de idioma ES/PT/EN y lector de pantalla en el detalle de oferta y las fotos.

## Criterios para declarar el piloto listo

- Migraciones aplicadas en el tenant de ensayo con verificación, conciliación e inventario sin diferencias.
- Recorrido completo de la tabla anterior en el tenant, con al menos un iPhone o un Android reales.
- Sesión persistente comprobada en dispositivo (lista en [autenticacion-oauth.md](autenticacion-oauth.md)).
- Decisiones registradas: moderación previa, comisiones de los proveedores del piloto, bucket de fotos.
- Pagos reales apagados y pagos simulados identificados como tales en todas las pantallas.
