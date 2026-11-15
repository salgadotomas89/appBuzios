#!/bin/sh
# functions/offer-media.ts en Deno, como lo trata InsForge Functions (2.3.5):
#   1. El mismo `deno check` que el backend ejecuta antes de desplegar (deno-subhosting.provider.ts, checkCode): un
#      deno.json con nodeModulesDir "auto" y noImplicitAny false, y el código con la cabecera "// Function: <slug>".
#      Si falla aquí, `functions deploy` lo rechaza.
#   2. scripts/lab/deno-offer-media.mjs: el manejador detrás de una copia del router de InsForge y la entrada del
#      despliegue con el SDK real de npm contra un servidor simulado en 127.0.0.1.
#
#   sh scripts/lab/deno-check.sh            # usa `deno` del PATH, o DENO=/ruta/a/deno
set -eu

deno=${DENO:-deno}
command -v "$deno" >/dev/null 2>&1 || { echo "Deno not found: install it or set DENO=/path/to/deno" >&2; exit 2; }
repo="$PWD"
work="$(mktemp -d "${TMPDIR:-/tmp}/offer-media-deno.XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

printf '%s' '{"nodeModulesDir":"auto","compilerOptions":{"noImplicitAny":false}}' > "$work/deno.json"
{ printf '// Function: offer-media\n'; cat "$repo/functions/offer-media.ts"; } > "$work/func.ts"
if ! output=$(cd "$work" && NO_COLOR=1 "$deno" check --no-lock func.ts 2>&1); then
  printf '%s\n' "$output" | grep -v '^Initialize' >&2
  echo "FAIL deno check rejects functions/offer-media.ts: InsForge would refuse to deploy it" >&2
  exit 1
fi
echo "PASS deno check accepts functions/offer-media.ts as InsForge would deploy it ($("$deno" --version | head -1))"

# Con el deno.json de InsForge: si no, Deno tomaría el tsconfig de React Native del repositorio.
NO_COLOR=1 "$deno" test --no-lock --config "$work/deno.json" --allow-net=127.0.0.1,registry.npmjs.org --allow-env --allow-read \
  "$repo/scripts/lab/deno-offer-media.mjs"
