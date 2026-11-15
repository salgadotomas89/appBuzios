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
-- de auth.users pero tiene SELECT, INSERT, UPDATE, DELETE, REFERENCES y TRIGGER sobre ella. Tiene BYPASSRLS y
-- SELECT en storage.objects (leído el 15-11-2026).
create role project_admin login password 'local' nosuperuser nocreaterole bypassrls;
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
\i /sb/harness/insforge_storage.sql
grant usage on schema storage to project_admin;
grant select on storage.objects to project_admin;
grant create, usage on schema public to project_admin;
SQL
version=$(su -c 'show server_version')
echo "PostgreSQL $version, migrations run as project_admin (not superuser, not owner of auth.users)"

failures=0
for file in $(docker exec "$container" sh -c 'ls /sb/migrations/*.sql' | sort); do
  # storage.objects es de postgres también en buziosflow. Allí project_admin crea sus políticas gracias a
  # insforge_pg_utils (insforge.policy_grant_tables), que este postgres:15 no trae: aquí van como postgres. El paso
  # real como project_admin lo ensaya scripts/lab/insforge-lab.sh con la imagen oficial de InsForge.
  migration_user=project_admin; migration_password=local
  grep -q 'on storage.objects' "$PWD/supabase/migrations/$(basename "$file")" && { migration_user=postgres; migration_password=connectical_local_test_only; }
  if docker exec -e PGPASSWORD="$migration_password" "$container" psql -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$migration_user" -d postgres -f "$file" >/dev/null 2>/tmp/connectical-compat-$$.err; then
    echo "OK    $(basename "$file")$( [ "$migration_user" = postgres ] && echo ' (as postgres: InsForge grants storage policies via insforge_pg_utils)')"
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

# Alta de administradores con scripts/promote-admin.sh, ejecutando su SQL como project_admin.
su >/dev/null <<'SQL'
insert into auth.users (id, email, email_verified, profile) values
  ('d0000000-0000-4000-8000-000000000003', 'sin-verificar@compat.test', false, '{"name":"Sin verificar"}'),
  ('d0000000-0000-4000-8000-000000000004', 'nunca-entro@compat.test', true, '{"name":"Nunca entró"}'),
  ('d0000000-0000-4000-8000-000000000005', 'segunda@compat.test', true, '{"name":"Segunda"}');
SQL
as_user d0000000-0000-4000-8000-000000000003 'select public.connectical_ensure_profile();' >/dev/null
as_user d0000000-0000-4000-8000-000000000005 'select public.connectical_ensure_profile();' >/dev/null
promote() {
  sh scripts/promote-admin.sh "$@" --print-sql | docker exec -i -e PGPASSWORD=local "$container" \
    psql -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U project_admin -d postgres
}
check_promote() {
  want="$1"; shift
  got=$(promote "$@" | tail -1)
  [ "$got" = "$want" ] || { echo "promote-admin $*: expected $want, got $got" >&2; exit 1; }
}
check_promote user_not_found nadie@compat.test --apply
check_promote email_not_verified sin-verificar@compat.test --apply
check_promote profile_missing nunca-entro@compat.test --apply
check_promote would_promote ANA@compat.test
[ "$(su -c "select count(*) from public.connectical_profiles where role = 'admin';")" = 0 ] || { echo "Dry run promoted someone" >&2; exit 1; }
check_promote promoted ana@compat.test --apply
check_promote already_admin ana@compat.test --apply
check_promote admin_exists segunda@compat.test --apply
check_promote promoted segunda@compat.test --apply --additional
audit=$(su -c "select string_agg(coalesce(actor_user_id::text, 'sql') || ':' || action || ':' || (details->>'to'), ',' order by id) from public.connectical_admin_audit_log;")
[ "$audit" = 'sql:role_changed:admin,sql:role_changed:admin' ] || { echo "Admin promotion not audited: $audit" >&2; exit 1; }
if sh scripts/promote-admin.sh "x'or'1'='1@a.com" --print-sql >/dev/null 2>&1; then echo "promote-admin accepted a quote" >&2; exit 1; fi
echo "PASS promote-admin.sh only promotes verified travelers that signed in, refuses a second admin without --additional and is audited"

# Bucket de fotos: las políticas RESTRICTIVE (202611160004) cierran 'offer-media' a toda sesión de usuario; solo escribe
# la función con la clave de API. Los demás buckets siguen con las reglas de InsForge.
owner_id='d0000000-0000-4000-8000-000000000010'
own_offer='e0000000-0000-4000-8000-000000000001'
other_offer='e0000000-0000-4000-8000-000000000002'
su >/dev/null <<SQL
insert into auth.users (id, email, email_verified, profile) values ('$owner_id', 'pousada@compat.test', true, '{"name":"Pousada"}');
insert into public.connectical_profiles (user_id, display_name, country_code, role) values ('$owner_id', 'Pousada', 'BR', 'provider');
insert into public.connectical_providers (id, owner_user_id, name, country_code, commission_rate_bps, active) values
  ('f0000000-0000-4000-8000-000000000001', '$owner_id', 'Pousada', 'BR', 1000, true),
  ('f0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'Otra', 'BR', 1000, true);
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published) values
  ('$own_offer', 'f0000000-0000-4000-8000-000000000001', 'pousadas', 'Quarto', 30000, 'night', true),
  ('$other_offer', 'f0000000-0000-4000-8000-000000000002', 'pousadas', 'Outro quarto', 30000, 'night', true);
insert into storage.buckets (name, public) values ('offer-media', false), ('avatars', false);
insert into public.connectical_settings (key, value) values ('media_public_base_url', '"https://media.compat.test/"');
SQL
# d…001 es admin desde el bloque anterior; d…002 sigue siendo turista.
admin_id='d0000000-0000-4000-8000-000000000001'
traveler_id='d0000000-0000-4000-8000-000000000002'
photo() { printf "offers/%s/%s.%s" "$1" "$(su -c 'select gen_random_uuid();')" "${2:-jpg}"; }
put() { as_user "$1" "insert into storage.objects (bucket, key, size, mime_type, uploaded_by) values ('$2', '$3', ${5:-350000}, '${4:-image/jpeg}', '$1') returning key;"; }
denied() { if put "$@" >/dev/null 2>&1; then echo "Storage write should be denied: $*" >&2; exit 1; fi; }
denied "$owner_id" offer-media "$(photo "$own_offer")"
denied "$admin_id" offer-media "$(photo "$own_offer")"
denied "$traveler_id" offer-media "notes/readme.html" text/html
[ -n "$(put "$traveler_id" avatars "$traveler_id/avatar.png" image/png)" ] || { echo "Other buckets changed behavior" >&2; exit 1; }
gateway_key=$(photo "$own_offer")
su -c "insert into storage.objects (bucket, key, size, mime_type) values ('offer-media', '$gateway_key', 350000, 'image/jpeg');"
# Un objeto de offer-media a nombre del usuario (anterior a la migración) tampoco se ve, cambia ni borra.
legacy_key=$(photo "$own_offer")
su -c "insert into storage.objects (bucket, key, size, mime_type, uploaded_by) values ('offer-media', '$legacy_key', 350000, 'image/jpeg', '$owner_id');"
[ "$(as_user "$owner_id" "select count(*) from storage.objects where bucket = 'offer-media';")" = 0 ] || { echo "A session can read offer-media objects" >&2; exit 1; }
[ "$(as_user "$owner_id" "with u as (update storage.objects set size = 1 where key = '$legacy_key' returning 1) select count(*) from u;")" = 0 ] || { echo "A session updated an offer-media object" >&2; exit 1; }
[ "$(as_user "$owner_id" "with d as (delete from storage.objects where bucket = 'offer-media' returning 1) select count(*) from d;")" = 0 ] || { echo "A session deleted offer-media objects" >&2; exit 1; }
if su -c "set role anon; insert into storage.objects (bucket, key, size, mime_type) values ('offer-media', 'x', 1, 'image/jpeg');" >/dev/null 2>&1; then
  echo "anon could write to storage" >&2; exit 1
fi
echo "PASS offer-media is closed to every user session (read, write, delete); other buckets keep InsForge's owner rules"

# Registro de fotos solo por la función (202611160003): connectical_add_offer_media es de project_admin, como en
# buziosflow, y aun así ve el archivo que dejó la clave de API; el que quedó a nombre del proveedor no se registra.
register() { as_user "$owner_id" "select public.connectical_add_offer_media('$own_offer', '$1', 'image/jpeg', 350000, 1600, 1066, 'Varanda');"; }
if register "$legacy_key" >/dev/null 2>&1; then echo "A photo uploaded by the provider's session was registered" >&2; exit 1; fi
if register "$(photo "$own_offer")" >/dev/null 2>&1; then echo "A photo without a stored file was registered" >&2; exit 1; fi
[ -n "$(register "$gateway_key")" ] || { echo "A photo written by the gateway was not registered" >&2; exit 1; }
[ "$(su -c "select pg_get_userbyid(proowner) from pg_proc where proname = 'connectical_add_offer_media';")" = project_admin ] || {
  echo "connectical_add_offer_media is not owned by project_admin" >&2; exit 1; }
echo "PASS only photos written by the offer-media function (API key) are registered, with the function owned by project_admin"
