# Entorno móvil: qué falta en este equipo y cómo completarlo

Estado verificado el 14-11-2026 en el Mac de desarrollo. Los pasos de instalación modifican el sistema y requieren
la aprobación de quien administra el equipo: no se ejecutaron de forma autónoma.

## iOS

| Elemento | Estado |
| --- | --- |
| Xcode | 27.2 (build 27B52) instalado |
| CocoaPods | 1.17.0; `pod install` correcto |
| Build Debug para simulador genérico | **Compila** (`BUILD SUCCEEDED`) tras subir el mínimo de los pods a iOS 15 en el `Podfile` |
| Ejecución en simulador | **No probada**: `CoreSimulator is out of date. Current version (1174.9.2) is older than build version (1174.21.0)`; `xcrun simctl` se cuelga |

Para habilitar el simulador (requiere contraseña de administrador):

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

Instalación sugerida (requiere aprobación; elegir la distribución de JDK que la organización prefiera):

1. JDK 17, por ejemplo `brew install --cask zulu@17`.
2. Android Studio desde developer.android.com; en SDK Manager instalar Android SDK Platform 37, Build-Tools 37.0.0,
   NDK 27.1.12297006, Platform-Tools y una imagen de emulador.
3. En `~/.zshrc`:
   ```sh
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
   ```
4. Comprobar: `npx react-native doctor`, luego `cd android && ./gradlew assembleDebug` y `npm run android`.

**Antes de publicar en Google Play:** `android/app/build.gradle` firma el build `release` con `debug.keystore`
(valor por defecto de la plantilla). Hay que crear una clave de subida propia, guardarla fuera del repositorio y
configurar la firma de release; nunca subir la clave ni sus contraseñas a git.

## Lo que sí se valida sin dispositivos

Jest (componentes y lógica), TypeScript, ESLint, la integración PostgreSQL y el ensayo de migraciones corren en CI en
cada push. Las pruebas en dispositivo (gestos, teclado, tamaños de pantalla, rendimiento) siguen pendientes.
