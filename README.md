This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Búzios Flow: MVP Brief

Búzios Flow ayuda a viajeros de Chile, Argentina y Brasil a organizar un viaje a Búzios antes de llegar: combinar una pousada con experiencias, consultar el coste total y reunir las reservas en un itinerario. La interfaz se prepara en español y portugués de Brasil; los precios se muestran en reales brasileños (BRL).

### Decisiones comerciales conversadas

- Categorías iniciales: Pousadas, Barcos, Noche y Buggy.
- Comisión de proveedor de referencia: pousadas 10%, fiestas en barco 18%, discotecas 15% y experiencias privadas/VIP 18–20%. Buggy sigue pendiente.
- La comisión al proveedor es un coste comercial interno y no se suma al cargo al turista.
- La pousada cercana a Porto da Barra que evalúa la hermana de Christopher es una candidata; operador y tarifa de Buggy todavía no están cerrados.

### Hipótesis de esta demo

- Catálogo, disponibilidad, horarios y tarifas son ficticios y no representan inventario confirmado.
- El cargo de servicio al turista es configurable en 4%, 6% o 8%; 6% es el escenario base. Subtotal, cargo y total se calculan y persisten en centavos de BRL.
- Comisiones de ensayo al proveedor: pousadas 10%, barco 18%, noche 15%, VIP 18–20%; Buggy sigue pendiente. La comisión al proveedor no se suma al cargo al turista.
- El panel interno usa supuestos no confirmados: pasarela 3,99% + R$0,39 por transacción, conversión 0% al cobrar en BRL y provisión operativa 2% del subtotal. No son tarifas comerciales ni cotización de una pasarela.
- El paquete de R$2.520 produce totales de R$2.620,80 (4%), R$2.671,20 (6%) y R$2.721,60 (8%). Con pousada al 10% y los costos de ensayo anteriores, el margen de contribución estimado es R$197,44, R$245,83 y R$294,22, respectivamente.
- Itinerario y reservas se guardan en AsyncStorage local. La confirmación conserva una cotización snapshot (versión, subtotal, cargo, total, comisiones y costos), así que cambiar el escenario solo afecta cotizaciones nuevas.
- No hay pago, bloqueo de disponibilidad ni reserva real en el flujo local `app-demo`; no contacta servicios externos.

La regla comercial del piloto es: `400`, `600` y `800` puntos base equivalen a 4%, 6% y 8% del subtotal contractual BRL. Los paga el turista como cargo de servicio. No son comisión del proveedor. La comisión del proveedor se calcula aparte sobre el subtotal y no se suma de nuevo al cargo del turista.

### Web futura

El repositorio actual es React Native y no contiene soporte web. La app y una futura web deben consumir un único catálogo/servicio de ofertas con IDs estables, precio y moneda, disponibilidad y versión de política; la web puede abrir `/ofertas/:offerId` como enlace directo y reutilizar un botón de aliado que añada `channel`, `partnerId` y `campaignId` a la cotización. Las claves de atribución deben validarse en el backend. No mantener dos catálogos ni calcular disponibilidad en cliente.

### Próximas fases

Catálogo y disponibilidad de aliados; administración para proveedores; persistencia y reservas reales; cobros con Pix o tarjeta, reparto de pagos y comprobantes/QR; políticas de cancelación y Plan B por clima. No activar cobros ni publicar sin decisión comercial y revisión de seguridad.

### Checkpoints de implementación

- Referencia inicial: pantalla actual abierta en iPhone 17; captura temporal en `/tmp/buzios-flow-baseline.png`.
- Brief de producto y supuestos demo: completado.
- Catálogo, cuatro filtros, búsqueda, detalle y estados incompletos/agotados: completado con datos ficticios.
- Mi viaje, edición de fechas/cantidades, eliminación, política configurable, resumen interno y confirmación consultable: completado con persistencia AsyncStorage local.
- Snapshot de precio: guarda versión de política, cargo y total confirmados, líneas y costos; cambiar la tarifa no cambia una reserva existente.
- Validación de interacciones por Jest: completada; se cubren cuatro filtros, ES/PT, fecha, cantidad, noches, eliminación, comparación de R$2.520, snapshot y remount con estado restaurado.
- TypeScript y ESLint: completados sin errores tras el cambio de modelo.
- Build y recorrido visual en iPhone: parcial/bloqueado por permisos de CoreSimulator y Xcode. `xcrun` informa `couldn't create cache file ... (errno=Operation not permitted)` y `CoreSimulatorService connection became invalid`; `xcodebuild` tampoco pudo leer `SDKToSimulatorIndexMapping.plist` ni escribir `DerivedData` incluso en `.build`.
- Web: pendiente; el repo no incluye frontend web. Compartir catálogo y cálculo mediante un servicio común antes de abrir enlaces directos o atribuir reservas de aliados.
- Confirmación de tarifas reales de pasarela pendiente: porcentaje y fijo por Pix/tarjeta, moneda de liquidación, FX, cuotas, impuestos, reembolsos, contracargos y plazos de payout.

## Reservas compartidas Connectical

El backend local anterior sigue separado: `src/lib/reservationBackend.ts` conserva usuarios, proveedores, ofertas, inventario, cotizaciones y reservas en `Map` de memoria; `src/lib/demoStorage.ts` guarda itinerarios y confirmaciones de demostración en AsyncStorage del dispositivo. Ninguno de esos dos medios comparte reservas entre dispositivos.

La ruta compartida nueva usa InsForge Auth y PostgreSQL. `src/lib/reservationService.ts` invoca funciones SQL transaccionales y consulta las filas autorizadas por RLS. El esquema está en `supabase/migrations/` (`202611110001_shared_reservations.sql`, `202611140001_multi_night_inventory.sql` y `202611140002_system_hold_sweep.sql`, en ese orden); el bloqueo de cupos por cada noche de la estancia, el rechazo de fechas pasadas (hora de São Paulo), la idempotencia, expiración a 10 minutos, snapshot BRL, historial, cancelación y autorización viven en PostgreSQL, no en el cliente.

El portal compartido está en español y portugués de Brasil. Valida en el dispositivo fechas (AAAA-MM-DD, desde hoy en Búzios), cantidades, noches (1–30, solo en ofertas por noche) y precios en formato BRL (`1.234,56`) antes de llamar al backend, que repite todas las validaciones. Los códigos de error de PostgreSQL se muestran como mensajes legibles. El turista ve las fechas con cupo publicado y puede elegir el resultado del pago simulado (aprobado, rechazado o pendiente) y reintentar el pago mientras dura la retención. El proveedor publica ofertas de las cuatro categorías y modalidades de precio. El admin filtra reservas por estado. El neto del proveedor es subtotal − comisión: el cargo del turista no forma parte de él.

En el portal compartido, el turista puede seleccionar 4%, 6% u 8%. La cotización muestra subtotal, porcentaje, cargo y total BRL. La reserva conserva el porcentaje elegido (`service_fee_rate_bps`), los centavos del cargo, el total y la comisión del proveedor como valores separados para que el panel de administración los pueda revisar.

### Estado de despliegue

- La configuración local apunta a `8ntv6m27.us-east.insforge.app` y su endpoint público de autenticación responde. `AGENTS.md` identifica el proyecto como OfertasApp; no se pudo verificar desde el cliente si ese tenant corresponde al entorno de ensayo o producción.
- La consulta de preflight de `connectical_reservations` respondió PostgreSQL `42P01`: estas tablas aún no están desplegadas en el proyecto configurado.
- No se ejecutó ni se aplicó ningún cambio remoto. El portal muestra error de esquema hasta que un operador aplique la migración en el SQL Editor de InsForge.
- El registro público crea solo perfiles `traveler`. Una persona operadora debe asignar `provider` o `admin` después de verificar la identidad y debe crear la fila del proveedor desde el SQL Editor confiable. No asignes esos roles desde la app.
- Las reservas remotas y la experiencia por rol no están activas end-to-end hasta desplegar la migración y aprovisionar las cuentas.

### Despliegue/provisionamiento manual

1. Revisa y aplica las migraciones en orden de nombre (`202611110001`, `202611140001`, `202611140002`) en el SQL Editor del proyecto InsForge; no ejecutes el seed de laboratorio contra producción.
2. Registra cuentas mediante Auth. Para usuarios operativos, cambia su perfil solo desde el SQL Editor confiable, después de validar identidad y autorización.
3. Usa el flujo exacto con placeholders y validaciones de [supabase/PROVISIONING.md](supabase/PROVISIONING.md) para asignar el perfil `provider`, crear su fila y asignar `admin` únicamente a una cuenta verificada. La tabla `connectical_providers` almacena comisión en puntos base.
4. Inicia la app, abre “Reservas compartidas · acceso de operaciones” e inicia sesión. Turistas pueden registrarse; proveedores publican oferta/cupo, turistas cotizan y hacen el hold, y admin ve totales snapshots.

La expiración no tiene cron instalado (la función `connectical_system_expire_holds` queda lista para un scheduler confiable, pero no hay ninguno configurado): los holds vencen tras 10 minutos y el estado/inventario se reconcilian de forma diferida al listar reservas (`connectical_expire_holds`) o reservar el mismo cupo. No se afirma limpieza automática en periodos sin solicitudes. El procedimiento, la llamada RPC y la opción futura de un scheduler validado están descritos en [supabase/PROVISIONING.md](supabase/PROVISIONING.md).

No se incluye una clave `service_role` en la app ni en este repositorio. La migración no activa cobros reales; tarjeta y Pix pasan solo por el simulador. La liquidación continúa en conciliación B2B y requiere revisión comercial/legal/bancaria antes de habilitar una pasarela.

### Integración continua

`.github/workflows/ci.yml` ejecuta en cada push y PR: tsc, ESLint y Jest (con `.env.example`, sin claves reales) y la integración con `postgres:17` desechable. No usa secretos ni contacta InsForge.

### Ensayo local verificable

Requiere Docker activo. El comando usa un contenedor PostgreSQL `postgres:17` temporal, una base aislada y roles Auth simulados; nunca contacta InsForge ni toca contenedores preexistentes. En runners que detengan contenedores creados por un proceso síncrono, inicia el servidor en una terminal y ejecuta la prueba desde otra:

```sh
docker run --name connectical-reservation-it \
	-e POSTGRES_PASSWORD=connectical_local_test_only \
	-v "$PWD/supabase/migrations:/tmp/connectical-migrations:ro" \
	postgres:17
```

En una segunda terminal:

```sh
CONNECTICAL_TEST_CONTAINER=connectical-reservation-it npm run test:shared-reservations
```

Al terminar, detén solo ese contenedor de prueba con `docker rm -f connectical-reservation-it`. En una terminal local sin esa política del runner, `npm run test:shared-reservations` crea y limpia su propio contenedor.

El ensayo cubre una posada, dos turistas concurrentes, un único cuarto, una aceptación y un rechazo por inventario, pago tarjeta simulado, lectura del proveedor/admin con aislamiento RLS, reinicio de PostgreSQL, ledger persistido, auditoría y liberación al cancelar. También cubre estancias de varias noches (bloqueo de cada noche, rechazo de estancias solapadas y de noches sin cupo publicado), rechazo de fechas pasadas, ofertas no nocturnas limitadas a una fecha y que los helpers internos de inventario no sean ejecutables por usuarios autenticados. Esta prueba demuestra la lógica compartida real en PostgreSQL local; la visibilidad multi-dispositivo del proyecto InsForge seguirá pendiente hasta aplicar allí la migración y probar cuentas remotas.

El simulador iOS queda separado de la validación del backend. La última evidencia del proyecto documenta bloqueo del entorno Xcode/CoreSimulator al crear cache/DerivedData; no se modificaron permisos globales ni se usó `sudo`.

Para retomar la prueba en iPhone, verificar que Xcode/Simulator pueda acceder a CoreSimulator y a `~/Library/Developer/Xcode`; luego, desde la raíz, ejecutar `npm start` y en otra terminal `npm run ios -- --simulator "iPhone 17"`. La app usa AsyncStorage para itinerario, escenario tarifario y reservas demo; las confirmaciones guardan una cotización inmutable. No capturan pagos ni crean reservas externas.

Antes de habilitar reservas reales, confirmar por escrito con la pasarela: porcentaje y fijo por método (Pix, crédito/débito), si la tarifa se calcula sobre el total con cargo, costo de cuotas, impuestos, moneda/fee de liquidación, reglas y costo de conversión CLP/ARS/BRL, plazos de payout, reembolsos, cancelaciones y contracargos. También confirmar reparto de fondos y quién asume cada fee. Los valores actuales de pasarela y provisión son supuestos de ensayo, no cotización real.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
