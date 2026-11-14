# Autenticación y OAuth — estado y preparación

Para quien decida e implemente el inicio de sesión móvil. Nada de esto se configuró en InsForge ni se crearon
credenciales: OAuth productivo requiere aprobación humana.

## Estado actual (verificado en el código de `@insforge/sdk@1.5.2`)

- La app usa correo y contraseña (`signInSharedAccount`, `signUpTravelerAccount` en `src/lib/reservationService.ts`).
  No se probó contra el tenant: depende de confirmarlo y de aplicar las migraciones.
- **La sesión vive solo en memoria.** El `TokenManager` del SDK guarda el token en variables; en el navegador lo renueva
  con cookies, pero en React Native no hay cookies de navegador ni `localStorage`. Consecuencia: **al cerrar y reabrir
  la app, el usuario debe volver a iniciar sesión.** Aceptable para el ensayo; no para el piloto.
- Para OAuth el SDK usa PKCE. `signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: true })` devuelve `url` y
  `codeVerifier`; `exchangeOAuthCode(code, codeVerifier)` completa el inicio de sesión. El SDK guarda el verificador en
  `sessionStorage`, que **no existe en React Native**: la app debe conservar el `codeVerifier` devuelto y pasarlo
  explícitamente al intercambio.
- Existe `signInWithIdToken` para Google con SDK nativo (según los tipos del SDK, solo Google por ahora).

## Decisiones pendientes

1. **Persistencia segura de la sesión.** Guardar el token en Keychain (iOS) / Keystore (Android), por ejemplo con
   `react-native-keychain`. Implica una dependencia nativa nueva, `pod install` y pruebas en dispositivo. **No usar
   AsyncStorage para tokens**: no está cifrado. Confirmar también con InsForge si emite un refresh token usable fuera
   del navegador y su duración.
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
