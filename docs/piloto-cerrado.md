# Primer piloto cerrado — preparación y criterios

Para el equipo que ejecute el piloto. **El piloto no está listo**: las migraciones ya están aplicadas y verificadas
en buziosflow, pero falta comprobar que llegan los códigos de verificación por correo y hacer al menos un recorrido
real en un iPhone o Android. Reservas comerciales y pagos reales siguen apagados; todo cobro es simulado.

## Estado del tenant buziosflow (15-11-2026)

| Comprobación | Resultado |
| --- | --- |
| Proyecto | buziosflow, `ykfv5j3m.us-east.insforge.app`, vinculado con el CLI; la app apunta a él |
| Respaldo | plataforma: `post-migraciones-15` (`e134bb27-…`, sustituye a `pre-reservas`); local: volcado completo tras la migración 17, restaurado y comparado sin diferencias (`npm run backup:verified`) |
| Migraciones | 17 de 18 aplicadas (retención del registro del barrido e índices el 15-11 por la tarde); verificación y conciliación correctas. La 18, reglas del bucket de fotos, no se puede aplicar con el CLI en InsForge 2.3.5 (ver runbook) |
| App con clave anónima | catálogo, inventario y fotos legibles; RPC privadas rechazadas |
| Barrido de retenciones | schedule `connectical-hold-sweep` cada 2 minutos, primera ejecución 200 y `succeeded` |
| Datos | ninguno: 0 usuarios, 0 ofertas |
| Correo | SMTP propio desactivado: envía el proveedor gestionado de InsForge con su plantilla en inglés. Entrega **sin comprobar**; plantillas en portugués preparadas para cuando haya SMTP |
| Fotos | **sin bucket**: las reglas que lo protegen no están aplicadas |

El detalle y los comandos están en [runbook-insforge-ensayo.md](runbook-insforge-ensayo.md).

## Antes del piloto (intervención humana)

1. ~~Respaldo, quince migraciones, verificación, conciliación e inventario~~: hecho el 15-11-2026.
2. Registrarse con un correo del equipo y comprobar que llega el código: `node scripts/verify-email-delivery.mjs
   correo@equipo.com` lo hace como la app y distingue «no generado» de «no entregado». El correo llega en inglés
   («Verify your email») y la app lo avisa. Si no llega, configurar SMTP (`[auth.smtp]` con
   `npx -y @insforge/cli config apply`, ver runbook), lo que requiere una cuenta de correo del equipo, y cargar las
   plantillas de `config/email-templates/pt-BR/`. Probar también «¿Olvidaste tu contraseña?» con esa cuenta.
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

4. Asignar el rol de administración a una cuenta del equipo ya verificada y que haya iniciado sesión una vez:
   `sh scripts/promote-admin.sh correo@equipo.com --apply` (rechaza cuentas sin verificar). Las demás cuentas se
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

- ~~Migraciones aplicadas con verificación, conciliación e inventario sin diferencias~~ (15-11-2026).
- Código de verificación recibido por correo en un registro real.
- Recorrido completo de la tabla anterior en el tenant, con al menos un iPhone o un Android reales.
- Sesión persistente comprobada en dispositivo (lista en [autenticacion-oauth.md](autenticacion-oauth.md)).
- Decisiones registradas: moderación previa, comisiones de los proveedores del piloto, bucket de fotos.
- Pagos reales apagados y pagos simulados identificados como tales en todas las pantallas.
