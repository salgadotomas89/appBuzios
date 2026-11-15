#!/bin/sh
# Aplica las migraciones en un PostgreSQL 17 desechable, ejecuta supabase/checks/schema_inventory.sql y
# lo compara con supabase/checks/expected_schema_inventory.txt. Con --update regenera el archivo
# esperado (hacerlo al añadir o cambiar una migración y revisar el diff).
set -eu

expected="$PWD/supabase/checks/expected_schema_inventory.txt"
container="connectical-schema-inventory-$$"
actual="$(mktemp "${TMPDIR:-/tmp}/connectical-inventory.XXXXXX")"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -f "$actual"; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=connectical_local_test_only \
  -v "$PWD/supabase:/sb:ro" postgres:17 >/dev/null
attempt=0
until docker exec "$container" psql -qAt -h 127.0.0.1 -U postgres -c 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -le 150 ] || { echo "PostgreSQL did not start" >&2; exit 1; }; sleep 0.2
done
docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
-- Columnas de auth.users en InsForge (leídas de buziosflow).
create table auth.users (id uuid primary key, email text, password text, email_verified boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), profile jsonb, metadata jsonb, is_project_admin boolean not null default false, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to anon, authenticated;
\i /sb/harness/insforge_storage.sql
SQL
for file in $(docker exec "$container" sh -c 'ls /sb/migrations/*.sql' | sort); do
  docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -f "$file" >/dev/null 2>&1 || {
    echo "Migration failed: $file" >&2; exit 1; }
done
docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres < "$PWD/supabase/checks/schema_inventory.sql" > "$actual"

if [ "${1:-}" = '--update' ]; then
  cp "$actual" "$expected"
  echo "Updated $(wc -l < "$expected" | tr -d ' ') lines in supabase/checks/expected_schema_inventory.txt"
  exit 0
fi
if ! diff -u "$expected" "$actual"; then
  echo "Schema inventory differs from the migrations: run sh scripts/check-schema-inventory.sh --update and review" >&2
  exit 1
fi
echo "PASS schema inventory matches supabase/checks/expected_schema_inventory.txt ($(wc -l < "$actual" | tr -d ' ') objects)"
