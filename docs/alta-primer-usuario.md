# Alta del primer usuario real y del primer administrador — buziosflow

Para la persona del equipo que lo ejecute en su Mac, con el repositorio en `main` y el CLI vinculado a buziosflow.
No se crean datos ficticios: la cuenta es real y de alguien del equipo. Nada de este procedimiento imprime ni guarda
contraseñas, códigos o tokens; no los copies en tickets ni en el chat.

## 0. Ensayo en el laboratorio (opcional, sin tocar buziosflow)

```sh
npm run lab:up && npm run lab:e2e && npm run lab:down
```

Levanta InsForge 2.3.5 en este Mac con Mailpit como correo y recorre con cuentas `@lab.buziosflow.test` lo mismo que
este procedimiento (alta, código, inicio de sesión, recuperación de contraseña y `promote-admin.sh`), además del
recorrido turístico. Debe terminar en `Lab end-to-end passed`. Necesita Docker y unos 2 GB libres.

## 1. Antes de empezar

- [ ] `npx -y @insforge/cli current` dice `buziosflow (bfab79dc-…)`.
- [ ] `.env` apunta a `ykfv5j3m` (el script lo comprueba).
- [ ] Decidir **quién** será el primer administrador y **quién confirma su identidad**: otra persona del equipo que lo
      conozca y vea, por un canal distinto del correo (en persona o videollamada), que la dirección de correo es suya.
- [ ] El correo es un buzón del equipo al que esa persona tiene acceso ahora mismo.

## 2. Registro y código de verificación

```sh
node scripts/verify-email-delivery.mjs correo@equipo.com
```

Pide la contraseña (no se muestra; mínimo 8 caracteres para que la app la acepte), un nombre, y el código de
6 dígitos que llega por correo. Por ahora el correo llega **en inglés**, asunto «Verify your email», remitente de
InsForge; revisar también spam.

| Resultado | Qué significa | Qué hacer |
| --- | --- | --- |
| `RESULT sign-in works; profile role=traveler` | Registro, código, verificación, inicio de sesión y perfil correctos | Seguir al paso 3 |
| `RESULT codes are generated but not delivered` | El servidor generó el código y no llegó | Esperar y revisar spam; si sigue sin llegar, SMTP propio (runbook, «Alternativa SMTP») |
| `RESULT no code generated` | El servidor no generó el código | Revisar `npx -y @insforge/cli logs insforge.logs` y la configuración de auth antes de SMTP |
| `RESULT code delivered but verification failed` | Código vencido o mal copiado | Repetir el script: el registro ya existe, así que usar «Reenviar código» en la app o pedir uno nuevo |
| `RESULT sign-up refused: …` | Correo ya registrado u otra regla | Si ya existe, iniciar sesión desde la app; si se olvidó la contraseña, «¿Olvidaste tu contraseña?» |
| `RESULT verified but sign-in failed` / `profile could not be created` | Fallo después de verificar | Guardar la salida y revisar el runbook antes de repetir |

Probar también, con la misma cuenta, «¿Olvidaste tu contraseña?» en la app: llega un código (asunto «Reset your
password»), se fija una contraseña nueva y se inicia sesión con ella.

## 3. Primer administrador (solo tras confirmar la identidad)

```sh
sh scripts/promote-admin.sh correo@equipo.com            # debe decir would_promote
sh scripts/promote-admin.sh correo@equipo.com --apply    # debe decir promoted
```

El script se niega (`email_not_verified`, `anonymous_user`, `profile_missing`, `not_a_traveler`, `admin_exists`) si
algo no cuadra; no forzarlo. Con `--apply` el trigger registra `role_changed` en la auditoría con actor nulo
(cambio hecho fuera de la app).

Comprobar después, con esa cuenta en la app (pestaña «Mi cuenta»): aparece la administración en seis áreas
(Proveedores, Catálogo, Reservas, Promociones y contenido, Finanzas y comisiones, Configuración) y en
Configuración → «Actividad» figura el cambio de rol con actor de sistema.

## 3b. Cuentas de proveedor y turista del equipo y verificación de fotos

Dos personas o buzones más del equipo, cada uno con el paso 2 hecho (`RESULT sign-in works; profile role=traveler`).
Todo se hace desde la app, como lo hará un proveedor real; no hace falta SQL.

1. **Proveedor.** Con su cuenta, «Mi cuenta» → «¿Tienes un negocio turístico en Búzios?» → enviar la solicitud con
   datos reales del negocio de prueba del equipo.
2. **Administrador.** Proveedores → «Solicitudes» → aprobar con la comisión acordada por escrito (es obligatoria).
3. **Proveedor.** Cerrar y abrir sesión: aparecen las pestañas Reservas, Mis ofertas y Mi negocio. En «Mis ofertas»,
   crear **una** oferta de prueba claramente marcada en el título («PRUEBA EQUIPO — no reservar») con cupo para una
   fecha.
4. **Fotos (paso 8 de [despliegue-fotos.md](despliegue-fotos.md)):**

   ```sh
   npm run verify:offer-media -- --traveler turista@equipo.com --provider pousada@equipo.com \
     --offer <uuid de esa oferta> --admin correo-admin@equipo.com
   ```

   Pide las contraseñas sin mostrarlas y debe terminar en `Offer photos verified`. Al final borra su foto de prueba.
5. **Al terminar:** en «Mis ofertas», despublicar la oferta de prueba (o el administrador la suspende en Catálogo →
   «Publicaciones»). No borrar cuentas: se quedan como cuentas reales del equipo.

Antes de invitar a proveedores de verdad, decidir si cada oferta nueva debe esperar aprobación
(`offer_moderation_required`, hoy `false`; la consulta preparada está en [piloto-cerrado.md](piloto-cerrado.md)).

## 4. Registro en la bitácora (sin datos sensibles)

Anotar en `docs/operacion-AAAA-MM-DD.md`: fecha y hora (UTC), resultado de cada paso (`RESULT …`, `promoted`), quién
ejecutó y quién confirmó la identidad (nombres, no correos), y el commit de `main`. **No** anotar el correo,
contraseñas, códigos, tokens ni identificadores de usuario.

## 5. Si hay que deshacerlo

Bajar el rol a turista lo registra igualmente la auditoría:

```sh
npx -y @insforge/cli db query "update public.connectical_profiles set role = 'traveler' where user_id = (select id from auth.users where lower(email) = lower('correo@equipo.com')) and role = 'admin'"
```
