# Autenticación y OAuth — estado y preparación

Para quien decida e implemente el inicio de sesión móvil. Nada de esto se configuró en InsForge ni se crearon
credenciales: OAuth productivo requiere aprobación humana.

## Estado actual (verificado en el código de `@insforge/sdk@1.5.2`)

- La app usa correo y contraseña, con verificación del correo por código de 6 dígitos (el tenant la exige:
  `requireEmailVerification: true`, `verifyEmailMethod: code`, leído de su configuración pública). No se probó
  contra el tenant: depende de confirmarlo y de aplicar las migraciones.
- **Persistencia de sesión implementada y probada con dobles, no en dispositivo** (15-11-2026):
  - `src/lib/insforge.ts` crea el cliente con `isServerMode: true`, que activa el flujo móvil documentado del SDK
    (`client_type=mobile`): el inicio de sesión devuelve `refreshToken` y `auth.refreshSession({ refreshToken })`
    lo acepta en el cuerpo. **Riesgo:** el SDK marca `isServerMode` como obsoleto pensando en SSR y no ofrece un
    modo específico para React Native; revisar antes de actualizar el SDK.
  - En ese modo el SDK guarda el token solo en el cliente HTTP, **no renueva solo** y `getCurrentUser` devuelve
    `null`. `src/auth/sessionManager.ts` lo compensa sin tocar el SDK: renueva antes de que caduque el token de
    acceso (leyendo `exp` del JWT, una sola renovación a la vez) y toma el usuario de la respuesta.
  - `src/auth/secureSessionStore.ts` guarda **solo** `{ userId, refreshToken }` con `react-native-keychain@10.0.0`
    (MIT, fijada): Keychain de iOS con `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` y sin iCloud; en Android, AES-GCM con
    clave del Keystore. El token de acceso vive en memoria. Nada va a AsyncStorage, archivos ni logs.
  - Al abrir el portal se restaura la sesión. Rechazo del servidor (4xx) = sesión expirada: se borra y se pide
    iniciar sesión. Sin conexión (sin respuesta, 408, 429 o 5xx) = se conserva y se avisa. Cerrar sesión borra el
    almacén aunque el servidor no responda. Si el almacén falla, la sesión sigue en memoria y se avisa de que no se
    guardó.
  - **Pendiente de verificar:** que el tenant devuelva `refreshToken` en el flujo móvil y si lo rota; la duración
    real de cada token; y el comportamiento en iPhone y Android reales (Keychain tras reinicio del teléfono,
    desinstalación, bloqueo). No declarar la persistencia operativa hasta probar en dispositivo.
- Para OAuth el SDK usa PKCE: `signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: true })` devuelve `url` y
  `codeVerifier`; `exchangeOAuthCode(code, codeVerifier)` completa el inicio de sesión. El SDK guarda el verificador en
  `sessionStorage`, que no existe en React Native: la app debe conservarlo y pasarlo explícitamente.
- Existe `signInWithIdToken` para Google con SDK nativo (según los tipos del SDK, solo Google por ahora).

## Riesgo de `isServerMode` (revisado el 14-11-2026, noche)

- **Estado del SDK:** `@insforge/sdk` 1.5.2 (31-07-2026) sigue siendo la última versión publicada. Su README y su
  `SDK-REFERENCE.md` no documentan React Native ni un modo móvil; el flujo `client_type=mobile` solo se activa con
  `isServerMode`, marcado `@deprecated` en favor de los ayudantes SSR, que dependen de cookies.
- **Qué cambia ese modo** (leído en `dist/index.js`): el inicio de sesión, la verificación de correo, la renovación
  y el cierre usan `?client_type=mobile`; el refresh token viaja en el cuerpo (`refresh_token`); el SDK no renueva
  solo ni rellena `getCurrentUser`; no hay detección automática de callbacks OAuth. El gestor de sesión cubre cada
  punto.
- **Mitigaciones aplicadas:** el SDK queda fijado en `1.5.2` exacto (antes `^1.5.2`, que admitía una 1.6 que podría
  retirar el modo) y `__tests__/sdkSessionContract.test.ts` ejecuta el SDK real con la red simulada: inicio de sesión,
  restauración con refresh en el cuerpo y token rotado, revocación (401) que borra la sesión y vuelta a la clave
  anónima tras cerrar sesión, y verificación de correo por código. Una actualización que cambie el contrato falla ahí.
- **Pendiente con InsForge:** preguntar si el flujo móvil seguirá soportado y si existe un adaptador de almacenamiento
  oficial para React Native; confirmar en el tenant de ensayo que el endpoint móvil emite y rota el refresh token y
  que el logout lo revoca (el SDK no lo envía al cerrar sesión).

## Prueba en dispositivo (cuando haya simulador o teléfono)

1. Iniciar sesión, cerrar la app por completo y reabrirla: debe entrar sin pedir contraseña.
2. Reiniciar el teléfono, desbloquearlo y abrir la app: igual.
3. Cerrar sesión, reabrir: debe pedir inicio de sesión.
4. Revocar la sesión en el panel de InsForge (o esperar a que caduque el refresh token) y reabrir: debe mostrar
   "Tu sesión expiró" y el formulario.
5. Modo avión al reabrir: debe avisar de falta de conexión sin borrar la sesión; al recuperar red, entrar.

## Decisiones pendientes

1. **Persistencia segura de la sesión:** implementada (ver arriba); falta la prueba en dispositivo y confirmar con el
   tenant la emisión y rotación del refresh token móvil.
2. **Proveedores OAuth** a ofrecer (Google, Apple; Apple es obligatorio en iOS si se ofrece otro inicio de sesión de
   terceros, según las normas de la App Store vigentes: verificarlo al decidir).
3. **URI de retorno.** Propuesta: esquema propio `buziosflow://auth/callback`, que debe registrarse en
   `ios/OfertasApp/Info.plist` (`CFBundleURLTypes`), en un `intent-filter` de
   `android/app/src/main/AndroidManifest.xml` y como URL permitida en el panel de InsForge. Alternativa más robusta:
   Universal Links / App Links con un dominio propio.

## Flujo previsto en la app (cuando se apruebe)

1. `const { data } = await insforge.auth.signInWithOAuth('google', { redirectTo: 'buziosflow://auth/callback', skipBrowserRedirect: true })`.
2. Guardar `data.codeVerifier` en memoria (o en almacenamiento seguro si el sistema puede cerrar la app durante el login).
3. Abrir `data.url` en un navegador del sistema (no un WebView embebido).
4. Recibir el deep link con `insforge_code`, llamar a `exchangeOAuthCode(code, codeVerifier)` y descartar el verificador.
5. Tras iniciar sesión, `getSharedRole()` como hoy; el trigger de Auth crea solo perfiles de turista.

Pruebas a escribir entonces: deep link con código válido, código repetido, verificador ausente, cancelación en el
navegador y reapertura de la app con sesión persistida.
