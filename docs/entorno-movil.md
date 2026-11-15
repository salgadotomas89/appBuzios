# Entorno móvil: qué falta en este equipo y cómo completarlo

Estado verificado el 14-11-2026 en el Mac de desarrollo. Los pasos de instalación modifican el sistema y requieren
la aprobación de quien administra el equipo: no se ejecutaron de forma autónoma.

## iOS

| Elemento | Estado |
| --- | --- |
| Xcode | 27.2 (build 27B52) instalado |
| Bundle JS de producción | `react-native bundle` para iOS y Android correcto (también en CI) |
| CocoaPods | 1.17.0; `pod install` correcto |
| Build Debug para simulador genérico | **Compila** (`BUILD SUCCEEDED`) tras subir el mínimo de los pods a iOS 15 en el `Podfile` |
| Ejecución en simulador | **Funciona** desde el 14-11-2026 a las 22:00: CoreSimulator ya está en 1174.21 (antes 1174.9.2) y `xcrun simctl` responde. La app se instaló y arrancó en un iPhone 17 Pro (iOS 26.5) con Metro: pantalla de inicio correcta ([captura](img/simulador-ios-inicio-2026-11-14.png)), sin errores de JavaScript ni del módulo nativo de Keychain en los logs |

El paso siguiente ya no necesita administrador. Queda pendiente **recorrer** la app en el simulador o en un teléfono
(este equipo no tiene herramientas de automatización de la interfaz ni permisos de accesibilidad para pulsar en el
simulador) y probar la sesión contra el tenant cuando esté confirmado.

Si en otro equipo vuelve a aparecer `CoreSimulator is out of date`, habilitarlo requiere contraseña de administrador:

```sh
sudo xcodebuild -runFirstLaunch      # instala los componentes del sistema que espera Xcode 27.2
xcrun simctl list devices available  # debe responder en segundos y listar iPhones
```

Si tras `-runFirstLaunch` el mensaje persiste, abrir Xcode → Settings → Components e instalar el runtime de iOS
que ofrezca; no se pudo comprobar desde aquí cuál de los dos pasos resuelve el aviso en este equipo.

Después, desde la raíz del repositorio: `npm start` y, en otra terminal, `npm run ios -- --simulator "iPhone 17"`
(o el modelo que liste `simctl`). Comando de compilación usado para verificar sin simulador:

```sh
xcodebuild -workspace ios/OfertasApp.xcworkspace -scheme OfertasApp -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build/dd CODE_SIGNING_ALLOWED=NO build
```

## Android

| Elemento | Requerido por el proyecto | En este equipo |
| --- | --- | --- |
| JDK | 17 (`jvmToolchain(17)` del plugin de React Native) | No instalado |
| Android SDK | compileSdk 37, targetSdk 36, minSdk 24, build-tools 37.0.0 | No instalado |
| NDK | 27.1.12297006 | No instalado |
| Gradle / AGP | Gradle 9.4.1 (wrapper incluido), AGP 9.2.1 | Se descargan solos al compilar |

Instalación reproducible (requiere aprobación de quien administra el equipo):

```sh
sh scripts/setup-android-env.sh            # solo comprueba y lista lo que falta
sh scripts/setup-android-env.sh --install  # instala JDK 17 (zulu@17), command-line tools, SDK 37,
                                           # build-tools 37.0.0, NDK 27.1.12297006 y platform-tools
```

El script no edita `~/.zshrc`: imprime las líneas `JAVA_HOME` y `ANDROID_HOME` a añadir. Después:
`npx react-native doctor`, `cd android && ./gradlew assembleDebug` y `npm run android`.

**Firma de release:** desde el 15-11-2026 `android/app/build.gradle` **ya no firma el release con la clave de
depuración**. Sin clave de subida, cualquier tarea `assemble`/`bundle`/`package` de release falla con un mensaje
claro. Para firmar:

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore ~/claves/buzios-upload.keystore \
  -alias buzios-upload -keyalg RSA -keysize 2048 -validity 10000
```

y en `~/.gradle/gradle.properties` (fuera del repositorio; nunca en git):

```properties
BUZIOS_UPLOAD_STORE_FILE=/Users/<usuario>/claves/buzios-upload.keystore
BUZIOS_UPLOAD_STORE_PASSWORD=...
BUZIOS_UPLOAD_KEY_ALIAS=buzios-upload
BUZIOS_UPLOAD_KEY_PASSWORD=...
```

Este cambio de Gradle **no se pudo compilar en este equipo** (no hay JDK): verificarlo con `./gradlew assembleDebug`
y `./gradlew assembleRelease` (este último debe fallar sin las propiedades y firmar con ellas).

## Lo que sí se valida sin dispositivos

Jest (componentes y lógica), TypeScript, ESLint, la integración PostgreSQL y el ensayo de migraciones corren en CI en
cada push. Las pruebas en dispositivo (gestos, teclado, tamaños de pantalla, rendimiento) siguen pendientes.
