#!/bin/sh
# Compara el esquema de buziosflow con el repositorio, solo con lecturas: migraciones aplicadas frente a migrations/,
# supabase/checks/verify_migrations.sql, reconcile_inventory.sql y el inventario frente a
# expected_schema_inventory.txt. Si hay migraciones del repositorio sin aplicar, el inventario esperado incluye sus
# cambios: la diferencia se muestra pero no cuenta como fallo.
set -eu

project=$(npx -y @insforge/cli current 2>&1 | sed -n 's/^ *Project: *\([^ ]*\).*/\1/p')
[ "$project" = 'buziosflow' ] || { echo "Linked project is '$project', expected buziosflow" >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/buzios-remote-schema.XXXXXX")"
trap 'rm -rf "$work"' EXIT INT TERM

query() { npx -y @insforge/cli db query "$(grep -v '^[[:space:]]*--' "$1" | tr '\n' ' ' | sed 's/;[[:space:]]*$//')" --json; }
rows() { python3 -c 'import json, sys; [print("|".join(str(v) for v in r.values())) for r in json.load(sys.stdin)["rows"]]'; }

npx -y @insforge/cli db migrations list --json |
  python3 -c 'import json, sys; [print(m["version"]) for m in json.load(sys.stdin)["migrations"]]' | sort > "$work/applied"
ls migrations | cut -c1-14 | sort > "$work/local"
pending=$(comm -13 "$work/applied" "$work/local")
unknown=$(comm -23 "$work/applied" "$work/local")
failures=0
echo "Applied: $(wc -l < "$work/applied" | tr -d ' ') of $(wc -l < "$work/local" | tr -d ' ') migrations"
[ -z "$pending" ] || echo "Pending (not applied): $(echo "$pending" | tr '\n' ' ')"
[ -z "$unknown" ] || { echo "FAIL applied remotely but not in the repository: $(echo "$unknown" | tr '\n' ' ')"; failures=1; }

failed=$(query supabase/checks/verify_migrations.sql | rows | grep -iv '|true$' || true)
if [ -z "$failed" ]; then echo "PASS verify_migrations.sql"; else echo "FAIL verify_migrations.sql: $failed"; failures=1; fi
drift=$(query supabase/checks/reconcile_inventory.sql | rows)
if [ -z "$drift" ]; then echo "PASS reconcile_inventory.sql: no drift"; else echo "FAIL inventory drift: $drift"; failures=1; fi

query supabase/checks/schema_inventory.sql | rows > "$work/inventory"
if diff supabase/checks/expected_schema_inventory.txt "$work/inventory" > "$work/diff"; then
  echo "PASS schema inventory matches ($(wc -l < "$work/inventory" | tr -d ' ') lines)"
else
  sed -n 's/^\([<>]\)/  \1/p' "$work/diff"
  if [ -n "$pending" ]; then echo "Schema differs as expected while migrations are pending (< repository, > tenant)"
  else echo "FAIL schema differs with no pending migrations (< repository, > tenant)"; failures=1; fi
fi
exit "$failures"
