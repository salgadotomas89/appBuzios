#!/bin/sh
# Genera migrations/ en el formato que exige el CLI de InsForge (<14 dígitos>_<nombre-con-guiones>.sql) a partir
# de supabase/migrations, que sigue siendo la fuente que usan todas las pruebas locales. El contenido es idéntico
# byte a byte; solo cambia el nombre: 202611140005_hide_internal_ids.sql -> 20261114000005_hide-internal-ids.sql.
# Con --check no escribe nada y falla si migrations/ no coincide (lo usa CI).
set -eu

src="$PWD/supabase/migrations"
dst="$PWD/migrations"
check=0
[ "${1:-}" = '--check' ] && check=1
expected="$(mktemp -d "${TMPDIR:-/tmp}/connectical-insforge-migrations.XXXXXX")"
trap 'rm -rf "$expected"' EXIT INT TERM

for file in "$src"/*.sql; do
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}
  case "$version" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) echo "Unexpected migration version: $base" >&2; exit 1 ;;
  esac
  day=$(printf '%s' "$version" | cut -c1-8)
  seq=$(printf '%s' "$version" | cut -c9-12)
  cp "$file" "$expected/${day}00${seq}_$(printf '%s' "$name" | tr '_' '-').sql"
done

# Regla del CLI (references/database/migrations.md): <14 dígitos>_<minúsculas, números y guiones>.sql
for file in "$expected"/*.sql; do
  basename "$file" | grep -Eq '^[0-9]{14}_[a-z0-9]+(-[a-z0-9]+)*\.sql$' || { echo "Invalid InsForge migration name: $(basename "$file")" >&2; exit 1; }
done

if [ "$check" -eq 1 ]; then
  diff -r "$expected" "$dst" >/dev/null 2>&1 || {
    diff -r "$expected" "$dst" >&2 || true
    echo "migrations/ is out of sync: run sh scripts/sync-insforge-migrations.sh" >&2
    exit 1
  }
  echo "PASS migrations/ matches supabase/migrations ($(ls "$dst" | wc -l | tr -d ' ') files, InsForge naming)"
  exit 0
fi
rm -rf "$dst"
mkdir -p "$dst"
cp "$expected"/*.sql "$dst"/
ls "$dst"
