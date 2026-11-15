#!/bin/sh
# Ensayo fiel al tenant buziosflow (leído en modo solo lectura el 14-11-2026): PostgreSQL 15, auth.users con
# las columnas de InsForge (profile/metadata, sin raw_user_meta_data) y migraciones ejecutadas como
# project_admin, un rol sin superusuario que no es dueño de auth.users. Aplica todas las migraciones,
# ejecuta verify_migrations.sql y prueba el alta de perfil. No se conecta a ningún tenant.
set -eu

container="connectical-insforge-compat-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=connectical_local_test_only \
  -v "$PWD/supabase:/sb:ro" postgres:15 >/dev/null
attempt=0
until docker exec "$container" psql -qAt -h 127.0.0.1 -U postgres -c 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -le 150 ] || { echo "PostgreSQL did not start" >&2; exit 1; }; sleep 0.2
done
su() { docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
admin() { docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U project_admin -d postgres "$@"; }
su >/dev/null <<'SQL'
-- Como en buziosflow: pgcrypto ya instalada por la plataforma (installed_version 1.3).
create extension pgcrypto;
create role anon nologin;
create role authenticated nologin;
-- Privilegios leídos de buziosflow: no es superusuario, no es miembro de anon ni authenticated, no es dueño
-- de auth.users pero tiene SELECT, INSERT, UPDATE, DELETE, REFERENCES y TRIGGER sobre ella.
create role project_admin login password 'local' nosuperuser nocreaterole;
create role pilot_session login;
grant authenticated to pilot_session;
create schema auth;
create table auth.users (
  id uuid primary key, email text, password text, email_verified boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  profile jsonb, metadata jsonb, is_project_admin boolean not null default false, is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to project_admin, anon, authenticated;
grant select, insert, update, delete, references, trigger on auth.users to project_admin;
grant execute on function auth.uid() to project_admin, anon, authenticated;
grant create, usage on schema public to project_admin;
SQL
version=$(su -c 'show server_version')
echo "PostgreSQL $version, migrations run as project_admin (not superuser, not owner of auth.users)"

failures=0
for file in $(docker exec "$container" sh -c 'ls /sb/migrations/*.sql' | sort); do
  if docker exec -e PGPASSWORD=local "$container" psql -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U project_admin -d postgres -f "$file" >/dev/null 2>/tmp/connectical-compat-$$.err; then
    echo "OK    $(basename "$file")"
  else
    echo "FAIL  $(basename "$file"): $(grep -m1 ERROR /tmp/connectical-compat-$$.err)"
    failures=$((failures + 1))
    break
  fi
done
rm -f /tmp/connectical-compat-$$.err
[ "$failures" -eq 0 ] || exit 1
failed=$(docker exec -e PGPASSWORD=local "$container" psql -qAt -h 127.0.0.1 -U project_admin -d postgres -f /sb/checks/verify_migrations.sql | grep -v '|t$' || true)
[ -z "$failed" ] || { echo "verify_migrations.sql failed as project_admin: $failed" >&2; exit 1; }
echo "PASS all migrations apply as project_admin on PostgreSQL $version and verify_migrations.sql is ok"

# Alta de perfil sin trigger en auth.users: el nombre sale de auth.users.profile y el rol es siempre traveler.
su >/dev/null <<'SQL'
insert into auth.users (id, email, email_verified, profile) values
  ('d0000000-0000-4000-8000-000000000001', 'ana@compat.test', true, '{"name":"Ana Souza"}'),
  ('d0000000-0000-4000-8000-000000000002', 'sem@compat.test', true, null);
SQL
# Conserva el código de salida de psql (con `| tail -1` directo, un error pasaría por éxito).
as_user() {
  as_user_out=$(su -c "set session authorization pilot_session; set role authenticated; select set_config('request.jwt.claim.sub','$1',false);" -c "$2") || return 1
  printf '%s\n' "$as_user_out" | tail -1
}
[ "$(as_user d0000000-0000-4000-8000-000000000001 'select public.connectical_ensure_profile();')" = 'traveler' ] || { echo "ensure_profile did not create a traveler" >&2; exit 1; }
[ "$(as_user d0000000-0000-4000-8000-000000000001 'select public.connectical_ensure_profile();')" = 'traveler' ] || { echo "ensure_profile is not idempotent" >&2; exit 1; }
as_user d0000000-0000-4000-8000-000000000002 'select public.connectical_ensure_profile();' >/dev/null
names=$(su -c "select string_agg(display_name || ':' || role, ',' order by display_name) from public.connectical_profiles;")
[ "$names" = 'Ana Souza:traveler,Traveler:traveler' ] || { echo "Profile names mismatch: $names" >&2; exit 1; }
if as_user d0000000-0000-4000-8000-000000000001 "update public.connectical_profiles set role = 'admin';" >/dev/null 2>&1; then
  echo "A traveler could promote itself" >&2; exit 1
fi
if su -c "set role anon; select public.connectical_ensure_profile();" >/dev/null 2>&1; then
  echo "anon could call ensure_profile" >&2; exit 1
fi
echo "PASS profiles are created from auth.users.profile on demand, only as traveler, without touching the auth schema"
