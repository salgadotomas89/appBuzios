#!/bin/sh
# Prepara el entorno Android de este proyecto en macOS. Comprueba qué falta y, solo con --install,
# instala lo necesario con Homebrew y sdkmanager. No modifica ~/.zshrc: imprime las líneas a añadir.
# Requisitos del proyecto: JDK 17, Android SDK 37, build-tools 37.0.0, NDK 27.1.12297006.
set -eu

install=0
[ "${1:-}" = '--install' ] && install=1
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
missing=0

check() {
  if eval "$2" >/dev/null 2>&1; then echo "OK      $1"; else echo "FALTA   $1"; missing=1; fi
}

check 'Homebrew' 'command -v brew'
check 'JDK 17' '/usr/libexec/java_home -v 17'
check 'Android command-line tools (sdkmanager)' "[ -x \"$sdk/cmdline-tools/latest/bin/sdkmanager\" ] || command -v sdkmanager"
check 'Android SDK Platform 37' "[ -d \"$sdk/platforms/android-37\" ]"
check 'Build-Tools 37.0.0' "[ -d \"$sdk/build-tools/37.0.0\" ]"
check 'NDK 27.1.12297006' "[ -d \"$sdk/ndk/27.1.12297006\" ]"
check 'Platform-Tools (adb)' "[ -x \"$sdk/platform-tools/adb\" ]"

if [ "$missing" -eq 0 ]; then
  echo 'Entorno Android completo. Siguiente paso: cd android && ./gradlew assembleDebug'
  exit 0
fi
if [ "$install" -eq 0 ]; then
  echo
  echo 'Para instalar lo que falta (requiere aprobación de quien administra el equipo):'
  echo '  sh scripts/setup-android-env.sh --install'
  exit 1
fi

command -v brew >/dev/null 2>&1 || { echo 'Instala Homebrew primero: https://brew.sh' >&2; exit 1; }
/usr/libexec/java_home -v 17 >/dev/null 2>&1 || brew install --cask zulu@17
if ! [ -x "$sdk/cmdline-tools/latest/bin/sdkmanager" ] && ! command -v sdkmanager >/dev/null 2>&1; then
  brew install --cask android-commandlinetools
fi
manager="$sdk/cmdline-tools/latest/bin/sdkmanager"
command -v "$manager" >/dev/null 2>&1 || manager=$(command -v sdkmanager)
JAVA_HOME=$(/usr/libexec/java_home -v 17)
export JAVA_HOME
yes | "$manager" --sdk_root="$sdk" --licenses >/dev/null
"$manager" --sdk_root="$sdk" 'platforms;android-37' 'build-tools;37.0.0' 'ndk;27.1.12297006' 'platform-tools'

cat <<EOT

Instalado. Añade a ~/.zshrc y abre una terminal nueva:
  export JAVA_HOME=\$(/usr/libexec/java_home -v 17)
  export ANDROID_HOME=$sdk
  export PATH=\$PATH:\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools
Luego: npx react-native doctor && (cd android && ./gradlew assembleDebug)
EOT
