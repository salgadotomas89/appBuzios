#!/bin/sh
# Ensayo de actualización: aplica las primeras N migraciones, crea reservas con los RPC de esa
# etapa, aplica el resto y comprueba que los datos siguen intactos, que el inventario concilia y
# que supabase/checks/verify_migrations.sql pasa. Uso: sh scripts/test-migration-upgrade.sh [N...]
# Sin argumentos ensaya desde N=1 (solo el esquema base) y N=4 (hasta el registro de reembolsos).
set -eu

stages="${*:-1 4}"
supabase_dir="$PWD/supabase"
for stage in $stages; do
  container="connectical-upgrade-it-$$-$stage"
  cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM
  docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=connectical_local_test_only \
    -v "$supabase_dir:/sb:ro" postgres:17 >/dev/null
  attempt=0
  until docker exec "$container" psql -qAt -h 127.0.0.1 -U postgres -c 'select 1' >/dev/null 2>&1; do
    attempt=$((attempt + 1)); [ "$attempt" -le 150 ] || { echo "PostgreSQL did not start" >&2; exit 1; }; sleep 0.2
  done
  sql() { docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
  sql >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role integration_session login;
grant authenticated to integration_session;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to anon, authenticated;
SQL
  migrations=$(docker exec "$container" sh -c 'ls /sb/migrations/*.sql' | sort)
  total=$(printf '%s\n' "$migrations" | wc -l | tr -d ' ')
  [ "$stage" -ge 1 ] && [ "$stage" -lt "$total" ] || { echo "Stage must be between 1 and $((total - 1))" >&2; exit 1; }
  apply() { sql -f "$1" >/dev/null 2>"/tmp/connectical-upgrade-$$.err" || { cat "/tmp/connectical-upgrade-$$.err" >&2; echo "Migration failed: $1" >&2; exit 1; }; }
  for file in $(printf '%s\n' "$migrations" | head -n "$stage"); do apply "$file"; done

  # Datos creados con los RPC disponibles en esa etapa: una reserva confirmada y una retenida.
  sql >/dev/null <<'SQL'
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000001'), ('30000000-0000-4000-8000-000000000001');
update public.connectical_profiles set role = 'provider' where user_id = '20000000-0000-4000-8000-000000000001';
update public.connectical_profiles set role = 'admin' where user_id = '30000000-0000-4000-8000-000000000001';
insert into public.connectical_providers (id, owner_user_id, name, country_code, commission_rate_bps)
  values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Upgrade lab', 'BR', 1000);
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
  values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'pousadas', 'Upgrade room', 32000, 'night', true);
insert into public.connectical_inventory (offer_id, service_date, total_units)
  values ('50000000-0000-4000-8000-000000000001', current_date + 30, 2);
SQL
  as_user() {
    sql -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$1',false);" -c "$2" | tail -1
  }
  for traveler in 10000000-0000-4000-8000-000000000001 10000000-0000-4000-8000-000000000002; do
    quote=$(as_user "$traveler" "select (public.connectical_create_quote('50000000-0000-4000-8000-000000000001', current_date + 30, 1, 1, 600)).id;")
    as_user "$traveler" "select (public.connectical_create_reservation_hold('$quote', gen_random_uuid())).id;" >/dev/null
  done
  first=$(sql -c "select id from public.connectical_reservations order by created_at limit 1;" | tail -1)
  as_user 10000000-0000-4000-8000-000000000001 "select public.connectical_simulate_payment('$first','approved','card','UPGRADE');" >/dev/null
  before=$(sql -c "select string_agg(status || ':' || amount_cents || ':' || service_fee_cents || ':' || provider_commission_cents, ',' order by created_at) from public.connectical_reservations;" | tail -1)

  for file in $(printf '%s\n' "$migrations" | tail -n "+$((stage + 1))"); do apply "$file"; done

  after=$(sql -c "select string_agg(status || ':' || amount_cents || ':' || service_fee_cents || ':' || provider_commission_cents, ',' order by created_at) from public.connectical_reservations;" | tail -1)
  [ "$after" = "$before" ] || { echo "Stage $stage: reservations changed during upgrade: $before -> $after" >&2; exit 1; }
  nights=$(sql -c "select string_agg(nights::text, ',') from public.connectical_reservations;" | tail -1)
  [ "$nights" = '1,1' ] || { echo "Stage $stage: pre-existing reservations did not default to one night: $nights" >&2; exit 1; }
  reconcile=$(sql < "$supabase_dir/checks/reconcile_inventory.sql")
  [ -z "$reconcile" ] || { echo "Stage $stage: inventory does not reconcile after upgrade: $reconcile" >&2; exit 1; }
  failed=$(sql < "$supabase_dir/checks/verify_migrations.sql" | grep -v '|t$' || true)
  [ -z "$failed" ] || { echo "Stage $stage: verify_migrations.sql failed: $failed" >&2; exit 1; }
  # Las reservas anteriores siguen operando con las funciones nuevas.
  held=$(sql -c "select id from public.connectical_reservations where status = 'held' limit 1;" | tail -1)
  cancelled=$(as_user 10000000-0000-4000-8000-000000000002 "select (public.connectical_cancel_reservation('$held', 'upgrade check')).status;")
  [ "$cancelled" = 'cancelled' ] || { echo "Stage $stage: pre-existing hold could not be cancelled: $cancelled" >&2; exit 1; }
  reconcile=$(sql < "$supabase_dir/checks/reconcile_inventory.sql")
  [ -z "$reconcile" ] || { echo "Stage $stage: inventory does not reconcile after cancelling: $reconcile" >&2; exit 1; }
  echo "PASS upgrade from the first $stage of $total migrations keeps data, reconciles and verifies"
  cleanup
  trap - EXIT INT TERM
done
rm -f "/tmp/connectical-upgrade-$$.err"
