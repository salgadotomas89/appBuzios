#!/bin/sh
set -eu

container="${CONNECTICAL_TEST_CONTAINER:-connectical-reservation-it-$$}"
owns_container=1
if [ -n "${CONNECTICAL_TEST_CONTAINER:-}" ]; then owns_container=0; fi
migrations="$PWD/supabase/migrations"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/connectical-reservation-it.XXXXXX")"
container_pid=''
cleanup() {
  if [ "$owns_container" -eq 1 ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  if [ -n "$container_pid" ]; then wait "$container_pid" >/dev/null 2>&1 || true; fi
  rm -rf "$workdir"
}
trap cleanup EXIT INT TERM

if [ "$owns_container" -eq 1 ] && docker container inspect "$container" >/dev/null 2>&1; then
  echo "Refusing to reuse existing container: $container" >&2
  exit 1
fi

if [ "$owns_container" -eq 1 ]; then
  docker run --name "$container" \
    -e POSTGRES_PASSWORD=connectical_local_test_only \
    -v "$migrations:/tmp/connectical-migrations:ro" \
    postgres:17 >"$workdir/postgres.log" 2>&1 &
  container_pid=$!
fi

# The image's init phase runs a temporary socket-only server and then restarts it.
# Probing over TCP waits for the final server instead of that temporary one.
wait_for_postgres() {
  attempt=0
  until docker exec "$container" psql -qAt -h 127.0.0.1 -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -gt 150 ]; then return 1; fi
    sleep 0.2
  done
}

wait_for_postgres || { echo "Disposable PostgreSQL did not become ready" >&2; exit 1; }

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role integration_session login;
grant authenticated to integration_session;
create schema auth;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to anon, authenticated;
SQL

# Apply every migration in filename order, exactly as an operator would.
for migration_file in $(docker exec "$container" sh -c 'ls /tmp/connectical-migrations/*.sql' | sort); do
  docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$migration_file" >/dev/null 2>"$workdir/migration.err" || {
    cat "$workdir/migration.err" >&2
    echo "Migration failed: $migration_file" >&2
    exit 1
  }
done

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into auth.users (id, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', '{"name":"Traveler A","country":"CL"}'),
  ('10000000-0000-4000-8000-000000000002', '{"name":"Traveler B","country":"BR"}'),
  ('20000000-0000-4000-8000-000000000001', '{"name":"Lab Provider","country":"BR"}'),
  ('30000000-0000-4000-8000-000000000001', '{"name":"Lab Admin","country":"CL"}');
SQL

traveler_profiles=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select count(*) from public.connectical_profiles where role='traveler';" | tail -1)
[ "$traveler_profiles" = '4' ] || { echo "New Auth users were not provisioned as travelers" >&2; exit 1; }
echo "PASS Auth signup trigger creates traveler-only profiles"

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
update public.connectical_profiles set role = 'provider'
  where user_id = '20000000-0000-4000-8000-000000000001';
update public.connectical_profiles set role = 'admin'
  where user_id = '30000000-0000-4000-8000-000000000001';
insert into public.connectical_providers (id, owner_user_id, name, country_code, commission_rate_bps)
values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Pousada laboratorio', 'BR', 1000);
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'pousadas', 'Quarto laboratorio', 32000, 'night', true);
insert into public.connectical_inventory (offer_id, service_date, total_units)
values ('50000000-0000-4000-8000-000000000001', current_date + 30, 1);
SQL

if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); update public.connectical_profiles set role='admin' where user_id='10000000-0000-4000-8000-000000000001';" >/dev/null 2>&1; then
  echo "Traveler self-promotion was not rejected" >&2
  exit 1
fi
echo "PASS authenticated traveler cannot promote their own role"

large_quote=$(docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('51000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'pousadas', 'Large lab price', 4000000, 'night', true);
set session authorization integration_session;
set role authenticated;
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select subtotal_cents||'|'||service_fee_cents||'|'||provider_commission_cents
from public.connectical_create_quote('51000000-0000-4000-8000-000000000001', current_date + 35, 1, 1, 600);
SQL
)
[ "$large_quote" = '4000000|240000|400000' ] || { echo "Large quote arithmetic mismatch: $large_quote" >&2; exit 1; }
echo "PASS numeric quote arithmetic avoids intermediate integer overflow"

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('51000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'pousadas', 'Overflow lab price', 2147483647, 'night', true);
SQL
if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); select public.connectical_create_quote('51000000-0000-4000-8000-000000000002',current_date + 35,2,1,600);" >/dev/null 2>&1; then
  echo "Out-of-range quote amount was not rejected" >&2
  exit 1
fi
echo "PASS quote amount above integer storage range is rejected"

provider_offer=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false); select (public.connectical_provider_upsert_offer(null,'pousadas','Provider managed lab offer',12000,'night',true)).id;" | tail -1)
docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false); select (public.connectical_provider_publish_inventory('$provider_offer',current_date + 31,1)).offer_id;" >/dev/null
updated_offer=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false); select (public.connectical_provider_upsert_offer('$provider_offer','pousadas','Edited provider lab offer',14500,'night',true)).base_price_cents;" | tail -1)
[ "$updated_offer" = '14500' ] || { echo "Provider could not update owned offer price: $updated_offer" >&2; exit 1; }
if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); select public.connectical_provider_upsert_offer('50000000-0000-4000-8000-000000000001','pousadas','Unauthorized',1,'night',true);" >/dev/null 2>&1; then
  echo "Unauthorized traveler offer mutation was not rejected" >&2
  exit 1
fi
echo "PASS provider can manage owned offer/inventory; traveler cannot mutate offers"

if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); select public.connectical_create_quote('50000000-0000-4000-8000-000000000001',current_date + 30,1,1,0);" >/dev/null 2>&1; then
  echo "Unsupported service fee bypass was not rejected" >&2
  exit 1
fi
echo "PASS database enforces supported service fee rates"

quote_4pct=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'; select q.service_fee_rate_bps||'|'||q.service_fee_cents||'|'||q.traveler_total_cents from public.connectical_create_quote('50000000-0000-4000-8000-000000000001',current_date + 30,1,1,400) q;" | tail -1)
quote_8pct=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'; select q.service_fee_rate_bps||'|'||q.service_fee_cents||'|'||q.traveler_total_cents from public.connectical_create_quote('50000000-0000-4000-8000-000000000001',current_date + 30,1,1,800) q;" | tail -1)
[ "$quote_4pct" = '400|1280|33280' ] || { echo "4% BRL quote mismatch: $quote_4pct" >&2; exit 1; }
[ "$quote_8pct" = '800|2560|34560' ] || { echo "8% BRL quote mismatch: $quote_8pct" >&2; exit 1; }
echo "PASS 4% and 8% rates produce the expected frozen BRL quote values"

quote_a=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false); select (public.connectical_create_quote('50000000-0000-4000-8000-000000000001', current_date + 30, 1, 1, 600)).id;" | tail -1)
quote_b=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false); select (public.connectical_create_quote('50000000-0000-4000-8000-000000000001', current_date + 30, 1, 1, 600)).id;" | tail -1)

hold() {
  user_id="$1"
  quote_id="$2"
  output="$3"
  key="$4"
  docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$user_id',false); select (public.connectical_create_reservation_hold('$quote_id','$key')).id;" >"$output" 2>&1
}

hold '10000000-0000-4000-8000-000000000001' "$quote_a" "$workdir/hold-a" '60000000-0000-4000-8000-000000000001' &
pid_a=$!
hold '10000000-0000-4000-8000-000000000002' "$quote_b" "$workdir/hold-b" '60000000-0000-4000-8000-000000000002' &
pid_b=$!
result_a=0
result_b=0
wait "$pid_a" || result_a=$?
wait "$pid_b" || result_b=$?

if [ "$result_a" -eq 0 ] && [ "$result_b" -ne 0 ]; then
  winner='10000000-0000-4000-8000-000000000001'
  other_traveler='10000000-0000-4000-8000-000000000002'
  quote_winner="$quote_a"
  winner_key='60000000-0000-4000-8000-000000000001'
  reservation_id=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$workdir/hold-a" | tail -1)
elif [ "$result_b" -eq 0 ] && [ "$result_a" -ne 0 ]; then
  winner='10000000-0000-4000-8000-000000000002'
  other_traveler='10000000-0000-4000-8000-000000000001'
  quote_winner="$quote_b"
  winner_key='60000000-0000-4000-8000-000000000002'
  reservation_id=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$workdir/hold-b" | tail -1)
else
  echo "Expected exactly one hold to win; postgres outcomes were unexpected" >&2
  exit 1
fi

[ -n "$reservation_id" ] || { echo "Winning hold did not return a reservation id" >&2; exit 1; }
echo "PASS concurrent shared inventory: one hold accepted, one rejected"

payment_result=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select (public.connectical_simulate_payment('$reservation_id','approved','card','LAB-CARD')).status;" | tail -1)
[ "$payment_result" = 'confirmed' ] || { echo "Payment did not confirm reservation" >&2; exit 1; }
echo "PASS simulated card payment and frozen BRL quote"

docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.connectical_quotes set expires_at = now() - interval '1 minute' where id = '$quote_winner';" >/dev/null
retry_id=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select (public.connectical_create_reservation_hold('$quote_winner','$winner_key')).id;" | tail -1)
[ "$retry_id" = "$reservation_id" ] || { echo "Idempotent retry did not return the existing reservation" >&2; exit 1; }
echo "PASS idempotent retry recovers an existing hold after quote expiry"

provider_view=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false); select count(*) from public.connectical_reservations where id='$reservation_id';" | tail -1)
provider_inventory=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false); select held_units||'|'||sold_units from public.connectical_inventory where offer_id='50000000-0000-4000-8000-000000000001' and service_date=current_date + 30;" | tail -1)
traveler_owner_view=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select count(*) from public.connectical_reservations where id='$reservation_id';" | tail -1)
admin_view=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false); select amount_cents||'|'||service_fee_rate_bps||'|'||service_fee_cents||'|'||provider_commission_cents from public.connectical_reservations where id='$reservation_id';" | tail -1)
admin_event_view=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false); select count(*) from public.connectical_reservation_events where reservation_id='$reservation_id';" | tail -1)
traveler_b_view=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$other_traveler',false); select count(*) from public.connectical_reservations where id='$reservation_id';" | tail -1)
[ "$provider_view" = '1' ] || { echo "Provider could not see its reservation from a separate session" >&2; exit 1; }
[ "$provider_inventory" = '0|1' ] || { echo "Provider could not verify shared inventory counters: $provider_inventory" >&2; exit 1; }
[ "$traveler_owner_view" = '1' ] || { echo "Traveler could not see their own reservation" >&2; exit 1; }
[ "$traveler_b_view" = '0' ] || { echo "Reservation leaked to another traveler" >&2; exit 1; }
[ "$admin_view" = '33920|600|1920|3200' ] || { echo "Admin BRL fee/commission snapshot mismatch: $admin_view" >&2; exit 1; }
[ "$admin_event_view" -ge 2 ] || { echo "Admin could not read reservation history: $admin_event_view" >&2; exit 1; }
echo "PASS traveler own-row visibility, provider/inventory visibility, isolation, admin totals, commissions and history"

docker restart "$container" >/dev/null
wait_for_postgres || { echo "PostgreSQL restart failed" >&2; exit 1; }
persisted=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select status||'|'||amount_cents from public.connectical_reservations where id='$reservation_id';" | tail -1)
[ "$persisted" = 'confirmed|33920' ] || { echo "Reservation was not recovered after database restart" >&2; exit 1; }
echo "PASS persistence after PostgreSQL service restart"

cancelled=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select (public.connectical_cancel_reservation('$reservation_id','integration_test')).status;" | tail -1)
inventory=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select held_units||'|'||sold_units from public.connectical_inventory where offer_id='50000000-0000-4000-8000-000000000001';" | tail -1)
events=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select count(*) from public.connectical_reservation_events where reservation_id='$reservation_id';" | tail -1)
[ "$cancelled" = 'cancelled' ] || { echo "Reservation cancellation failed" >&2; exit 1; }
[ "$inventory" = '0|0' ] || { echo "Inventory was not released after cancellation: $inventory" >&2; exit 1; }
[ "$events" -ge 3 ] || { echo "Reservation event history was incomplete" >&2; exit 1; }
echo "PASS cancellation, inventory release and lifecycle audit"

if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$other_traveler',false); select public.connectical_cancel_reservation('$reservation_id','unauthorized');" >/dev/null 2>&1; then
  echo "Unauthorized traveler cancellation was not rejected" >&2
  exit 1
fi
echo "PASS unauthorized traveler cannot cancel another user's reservation"

quote_expiring=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select (public.connectical_create_quote('50000000-0000-4000-8000-000000000001', current_date + 30, 1, 1, 600)).id;" | tail -1)
expired_hold=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$winner',false); select (public.connectical_create_reservation_hold('$quote_expiring','60000000-0000-4000-8000-000000000003')).id;" | tail -1)
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.connectical_reservations set hold_expires_at = now() - interval '1 second' where id = '$expired_hold';" >/dev/null
expired_count=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$other_traveler',false); select public.connectical_expire_holds();" | tail -1)
 [ "$expired_count" = '1' ] || { echo "Expiration sweep did not expire exactly one hold: $expired_count" >&2; exit 1; }
quote_after_expiry=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$other_traveler',false); select (public.connectical_create_quote('50000000-0000-4000-8000-000000000001', current_date + 30, 1, 1, 600)).id;" | tail -1)
replacement_hold=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$other_traveler',false); select (public.connectical_create_reservation_hold('$quote_after_expiry','60000000-0000-4000-8000-000000000004')).id;" | tail -1)
expiry_state=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select (select status from public.connectical_reservations where id='$expired_hold')||'|'||(select held_units from public.connectical_inventory where offer_id='50000000-0000-4000-8000-000000000001')||'|'||(select status from public.connectical_reservations where id='$replacement_hold');" | tail -1)
[ "$expiry_state" = 'expired|1|held' ] || { echo "Expired hold did not release and reassign inventory: $expiry_state" >&2; exit 1; }
echo "PASS hold expiration reclaims inventory for the next traveler"

# Runs SQL as an authenticated user and prints the last row; fails when psql fails.
as_user() {
  as_user_out=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$1',false);" -c "$2") || return 1
  printf '%s\n' "$as_user_out" | tail -1
}
traveler_a='10000000-0000-4000-8000-000000000001'
traveler_b='10000000-0000-4000-8000-000000000002'
pousada='50000000-0000-4000-8000-000000000001'
docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
insert into public.connectical_inventory (offer_id, service_date, total_units) values
  ('$pousada', current_date + 40, 1), ('$pousada', current_date + 41, 1), ('$pousada', current_date + 42, 1);"

stay_quote=$(as_user "$traveler_a" "select (public.connectical_create_quote('$pousada', current_date + 40, 1, 2, 600)).id;")
stay_id=$(as_user "$traveler_a" "select (public.connectical_create_reservation_hold('$stay_quote','70000000-0000-4000-8000-000000000001')).id;")
stay_nights=$(as_user "$traveler_a" "select nights from public.connectical_reservations where id='$stay_id';")
[ "$stay_nights" = '2' ] || { echo "Multi-night hold did not persist its nights: $stay_nights" >&2; exit 1; }
overlap_quote=$(as_user "$traveler_b" "select (public.connectical_create_quote('$pousada', current_date + 41, 1, 1, 600)).id;")
if as_user "$traveler_b" "select public.connectical_create_reservation_hold('$overlap_quote','70000000-0000-4000-8000-000000000002');" >/dev/null 2>&1; then
  echo "Overlapping stay on the second night was not rejected" >&2
  exit 1
fi
after_quote=$(as_user "$traveler_b" "select (public.connectical_create_quote('$pousada', current_date + 42, 1, 1, 600)).id;")
as_user "$traveler_b" "select (public.connectical_create_reservation_hold('$after_quote','70000000-0000-4000-8000-000000000003')).id;" >/dev/null
stay_counters() {
  docker exec "$container" psql -qAt -U postgres -d postgres -c "
    select string_agg(held_units||'/'||sold_units, ',' order by service_date) from public.connectical_inventory
    where offer_id='$pousada' and service_date between current_date + 40 and current_date + 42;" | tail -1
}
[ "$(stay_counters)" = '1/0,1/0,1/0' ] || { echo "Multi-night hold counters mismatch: $(stay_counters)" >&2; exit 1; }
echo "PASS multi-night hold reserves every night and blocks overlapping stays"

as_user "$traveler_a" "select (public.connectical_simulate_payment('$stay_id','approved','pix','LAB-PIX')).status;" >/dev/null
[ "$(stay_counters)" = '0/1,0/1,1/0' ] || { echo "Multi-night payment counters mismatch: $(stay_counters)" >&2; exit 1; }
as_user "$traveler_a" "select (public.connectical_cancel_reservation('$stay_id','integration_test')).status;" >/dev/null
[ "$(stay_counters)" = '0/0,0/0,1/0' ] || { echo "Multi-night cancellation counters mismatch: $(stay_counters)" >&2; exit 1; }
echo "PASS multi-night payment and cancellation move every night together"

gap_quote=$(as_user "$traveler_a" "select (public.connectical_create_quote('$pousada', current_date + 41, 1, 3, 600)).id;")
if as_user "$traveler_a" "select public.connectical_create_reservation_hold('$gap_quote','70000000-0000-4000-8000-000000000004');" >/dev/null 2>"$workdir/gap.err"; then
  echo "Stay with unpublished nights was not rejected" >&2
  exit 1
fi
grep -q 'inventory_not_found' "$workdir/gap.err" || { echo "Unexpected error for unpublished nights" >&2; cat "$workdir/gap.err" >&2; exit 1; }
echo "PASS stay with unpublished nights is rejected"

if as_user "$traveler_a" "select public.connectical_create_quote('$pousada', current_date - 2, 1, 1, 600);" >/dev/null 2>&1; then
  echo "Quote for a past service date was not rejected" >&2
  exit 1
fi
if as_user '20000000-0000-4000-8000-000000000001' "select public.connectical_provider_publish_inventory('$pousada', current_date - 2, 3);" >/dev/null 2>&1; then
  echo "Inventory for a past service date was not rejected" >&2
  exit 1
fi
echo "PASS past service dates are rejected for quotes and inventory"

docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('52000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'barcos', 'Boat lab ticket', 15000, 'person', true);"
if as_user "$traveler_a" "select public.connectical_create_quote('52000000-0000-4000-8000-000000000001', current_date + 40, 2, 2, 600);" >/dev/null 2>&1; then
  echo "Multi-night quote for a per-person offer was not rejected" >&2
  exit 1
fi
echo "PASS non-night offers only accept a single service date"

for helper in "connectical_adjust_stay_inventory('$pousada', current_date + 42, 1, -1, 0)" \
  "connectical_expire_offer_holds('$pousada')" "connectical_lock_offer('$pousada')"; do
  if as_user "$traveler_a" "select public.$helper;" >/dev/null 2>&1; then
    echo "Internal helper is executable by authenticated users: $helper" >&2
    exit 1
  fi
done
echo "PASS internal inventory helpers are not executable by authenticated users"
if as_user '20000000-0000-4000-8000-000000000001' "select public.connectical_provider_upsert_offer(null,'pousadas',repeat('x',121),1000,'night',true);" >/dev/null 2>&1; then
  echo "Offer title longer than 120 characters was not rejected" >&2
  exit 1
fi
echo "PASS offer titles are limited to 120 characters"

docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.connectical_providers set active = false where id = '40000000-0000-4000-8000-000000000001';"
if as_user '20000000-0000-4000-8000-000000000001' "select public.connectical_provider_publish_inventory('$pousada', current_date + 50, 2);" >/dev/null 2>&1; then
  echo "Paused provider could still publish inventory" >&2
  exit 1
fi
echo "PASS paused provider cannot publish inventory"
privileges=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
  select string_agg(p.proname || '=' || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('connectical_adjust_stay_inventory', 'connectical_expire_offer_holds',
    'connectical_lock_offer', 'connectical_create_traveler_profile', 'connectical_create_quote');" | tail -1)
expected='connectical_adjust_stay_inventory=false,connectical_create_quote=true,connectical_create_traveler_profile=false,connectical_expire_offer_holds=false,connectical_lock_offer=false'
[ "$privileges" = "$expected" ] || { echo "Unexpected EXECUTE privileges: $privileges" >&2; exit 1; }
echo "PASS EXECUTE privileges match the provisioning checklist"
# Traveler B still holds the night at current_date + 42 from the multi-night checks.
if as_user "$traveler_a" "select public.connectical_system_expire_holds();" >/dev/null 2>&1; then
  echo "System hold sweep is executable by authenticated users" >&2
  exit 1
fi
docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.connectical_reservations set hold_expires_at = now() - interval '1 second' where status = 'held' and offer_id = '$pousada' and service_date = current_date + 42;"
swept=$(docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select public.connectical_system_expire_holds();" | tail -1)
[ "$swept" -ge 1 ] || { echo "System sweep expired nothing: $swept" >&2; exit 1; }
null_actor=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select count(*) from public.connectical_reservation_events where event_type = 'hold_expired' and actor_user_id is null;" | tail -1)
[ "$null_actor" -ge 1 ] || { echo "System sweep did not log hold_expired events" >&2; exit 1; }
[ "$(stay_counters)" = '0/0,0/0,0/0' ] || { echo "System sweep left held units: $(stay_counters)" >&2; exit 1; }
echo "PASS system hold sweep releases inventory and is not executable by app users"

# Concurrency: parallel sessions race for the last unit. Each session sleeps until the
# same instant before calling the hold RPC, so the calls genuinely overlap.
race_offer='53000000-0000-4000-8000-000000000001'
docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
update public.connectical_providers set active = true where id = '40000000-0000-4000-8000-000000000001';
insert into auth.users (id) select ('11000000-0000-4000-8000-00000000000' || g)::uuid from generate_series(1, 8) g;
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('$race_offer', '40000000-0000-4000-8000-000000000001', 'pousadas', 'Race lab room', 20000, 'night', true);
insert into public.connectical_inventory (offer_id, service_date, total_units)
select '$race_offer', current_date + d, 1 from generate_series(60, 62) d;
SQL
race_start=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select extract(epoch from clock_timestamp() + interval '4 seconds');" | tail -1)
race_pids=''
for g in 1 2 3 4 5 6 7 8; do
  racer="11000000-0000-4000-8000-00000000000$g"
  # Odd racers want nights 60-61, even racers 61-62: every pair overlaps on night 61.
  start_day=$((60 + (g + 1) % 2))
  race_quote=$(as_user "$racer" "select (public.connectical_create_quote('$race_offer', current_date + $start_day, 1, 2, 600)).id;")
  (
    if docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$racer',false);" \
      -c "select pg_sleep(greatest(0, $race_start - extract(epoch from clock_timestamp())));" \
      -c "select 'started=' || extract(epoch from clock_timestamp());" \
      -c "select (public.connectical_create_reservation_hold('$race_quote', gen_random_uuid())).id;" >"$workdir/race-log.$g" 2>&1; then
      echo ok >"$workdir/race.$g"
    else
      echo fail >"$workdir/race.$g"
    fi
  ) &
  race_pids="$race_pids $!"
done
for pid in $race_pids; do wait "$pid"; done
race_spread=$(cat "$workdir"/race-log.* | sed -n 's/^started=//p' | sort -n | awk 'NR==1{min=$1} {max=$1} END{print (NR==8 && max-min < 1) ? "ok" : NR " " max-min}')
[ "$race_spread" = 'ok' ] || { echo "Racers did not overlap in time: $race_spread" >&2; exit 1; }
race_wins=$(cat "$workdir"/race.* | grep -c '^ok$' || true)
[ "$race_wins" = '1' ] || { echo "Expected exactly one concurrent hold to win, got $race_wins" >&2; exit 1; }
race_counters=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "
  select string_agg(held_units || '/' || sold_units, ',' order by service_date)
  from public.connectical_inventory where offer_id = '$race_offer';" | tail -1)
case "$race_counters" in
  '1/0,1/0,0/0'|'0/0,1/0,1/0') ;;
  *) echo "Concurrent holds left inconsistent counters: $race_counters" >&2; exit 1 ;;
esac
race_rows=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select count(*) from public.connectical_reservations where offer_id = '$race_offer';" | tail -1)
[ "$race_rows" = '1' ] || { echo "Concurrent holds created $race_rows reservations" >&2; exit 1; }
echo "PASS 8 concurrent overlapping holds produce exactly one reservation and no oversell"

# Double submit: the same quote and idempotency key sent twice at once returns one reservation.
dup_user='11000000-0000-4000-8000-000000000001'
docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
insert into public.connectical_inventory (offer_id, service_date, total_units)
select '$race_offer', current_date + d, 5 from generate_series(70, 71) d;"
dup_quote=$(as_user "$dup_user" "select (public.connectical_create_quote('$race_offer', current_date + 70, 1, 2, 600)).id;")
dup_key=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select gen_random_uuid();" | tail -1)
dup_start=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select extract(epoch from clock_timestamp() + interval '3 seconds');" | tail -1)
dup_pids=''
for n in 1 2 3; do
  (
    docker exec "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "set session authorization integration_session; set role authenticated; select set_config('request.jwt.claim.sub','$dup_user',false);" \
      -c "select pg_sleep(greatest(0, $dup_start - extract(epoch from clock_timestamp())));" \
      -c "select (public.connectical_create_reservation_hold('$dup_quote', '$dup_key')).id;" 2>/dev/null | tail -1 >"$workdir/dup.$n"
  ) &
  dup_pids="$dup_pids $!"
done
for pid in $dup_pids; do wait "$pid"; done
# Every one of the three calls must return the reservation: a failed call leaves its file empty.
dup_returned=$(cat "$workdir"/dup.* | grep -Ec '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || true)
[ "$dup_returned" = '3' ] || { echo "Only $dup_returned of 3 duplicate submits returned the reservation" >&2; exit 1; }
dup_ids=$(sort -u "$workdir"/dup.* | grep -c . || true)
dup_rows=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select count(*) from public.connectical_reservations where quote_id = '$dup_quote';" | tail -1)
dup_held=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "
  select string_agg(held_units::text, ',' order by service_date) from public.connectical_inventory
  where offer_id = '$race_offer' and service_date >= current_date + 70;" | tail -1)
[ "$dup_ids" = '1' ] && [ "$dup_rows" = '1' ] && [ "$dup_held" = '1,1' ] || {
  echo "Double submit was not idempotent: ids=$dup_ids rows=$dup_rows held=$dup_held" >&2; exit 1; }
echo "PASS simultaneous double submit with one idempotency key holds inventory once"

# Refund ledger: admin-only, bounded by what was charged, idempotent, and a full refund
# requires cancelling first. No commercial policy is computed by the database.
admin_user='30000000-0000-4000-8000-000000000001'
refund_id=$(sort -u "$workdir"/dup.* | grep . | head -1)
refund_amount=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select amount_cents from public.connectical_reservations where id = '$refund_id';" | tail -1)
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', 100, 'before payment', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Refund before an approved payment was not rejected" >&2; exit 1
fi
as_user "$dup_user" "select (public.connectical_simulate_payment('$refund_id','approved','card','LAB-REFUND')).status;" >/dev/null
if as_user "$dup_user" "select public.connectical_admin_record_refund('$refund_id', 100, 'self refund', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Traveler could record their own refund" >&2; exit 1
fi
if as_user '20000000-0000-4000-8000-000000000001' "select public.connectical_admin_record_refund('$refund_id', 100, 'provider refund', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Provider could record a refund" >&2; exit 1
fi
if as_user "$traveler_a" "insert into public.connectical_refunds (reservation_id, idempotency_key, amount_cents, reason) values ('$refund_id', gen_random_uuid(), 1, 'direct');" >/dev/null 2>&1; then
  echo "Authenticated user could insert refunds directly" >&2; exit 1
fi
partial_key=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select gen_random_uuid();" | tail -1)
partial=$(as_user "$admin_user" "select r.status || '|' || r.refund_cents from public.connectical_admin_record_refund('$refund_id', 5000, 'Goodwill partial', '$partial_key') r;")
[ "$partial" = 'confirmed|5000' ] || { echo "Partial refund mismatch: $partial" >&2; exit 1; }
retry=$(as_user "$admin_user" "select r.refund_cents from public.connectical_admin_record_refund('$refund_id', 5000, 'Goodwill partial', '$partial_key') r;")
[ "$retry" = '5000' ] || { echo "Refund retry was not idempotent: $retry" >&2; exit 1; }
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', 4000, 'Changed amount', '$partial_key');" >/dev/null 2>&1; then
  echo "Reused refund key with a different amount was not rejected" >&2; exit 1
fi
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', 5000, 'Changed reason', '$partial_key');" >/dev/null 2>&1; then
  echo "Reused refund key with a different reason was not rejected" >&2; exit 1
fi
remaining=$((refund_amount - 5000))
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', $remaining, 'Full while confirmed', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Full refund of a confirmed reservation was not rejected" >&2; exit 1
fi
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', $((remaining + 1)), 'Too much', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Refund above the charged amount was not rejected" >&2; exit 1
fi
as_user "$dup_user" "select (public.connectical_cancel_reservation('$refund_id', 'Traveler cancelled')).status;" >/dev/null
full=$(as_user "$admin_user" "select r.status || '|' || r.refund_cents from public.connectical_admin_record_refund('$refund_id', $remaining, 'Remaining balance', gen_random_uuid()) r;")
[ "$full" = "refunded|$refund_amount" ] || { echo "Full refund after cancellation mismatch: $full" >&2; exit 1; }
if as_user "$admin_user" "select public.connectical_admin_record_refund('$refund_id', 1, 'After full refund', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Refund after a full refund was not rejected" >&2; exit 1
fi
ledger=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "
  select count(*) || '|' || sum(amount_cents) from public.connectical_refunds where reservation_id = '$refund_id';" | tail -1)
[ "$ledger" = "2|$refund_amount" ] || { echo "Refund ledger mismatch: $ledger" >&2; exit 1; }
traveler_view=$(as_user "$dup_user" "select count(*) from public.connectical_refunds where reservation_id = '$refund_id';")
other_view=$(as_user "$traveler_b" "select count(*) from public.connectical_refunds where reservation_id = '$refund_id';")
[ "$traveler_view" = '2' ] && [ "$other_view" = '0' ] || {
  echo "Refund visibility mismatch: owner=$traveler_view other=$other_view" >&2; exit 1; }
refund_anon=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "
  select has_function_privilege('anon', 'public.connectical_admin_record_refund(uuid,integer,text,uuid)', 'execute')
    || '|' || has_table_privilege('authenticated', 'public.connectical_refunds', 'insert');" | tail -1)
[ "$refund_anon" = 'false|false' ] || { echo "Refund privileges too broad: $refund_anon" >&2; exit 1; }
echo "PASS admin refunds are bounded, idempotent, need cancellation for the full amount and are private"

# BRL rounding parity: __tests__/pricingParity.test.ts checks the app against the same fixture.
parity_cases=$(tr -d '\n' < "$PWD/__tests__/fixtures/quote-parity.json")
docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -v cases="$parity_cases" <<'SQL'
create table public.lab_quote_parity as
  select row_number() over () as n, c.*
  from jsonb_to_recordset(:'cases'::jsonb) as c(
    "basePriceCents" integer, quantity integer, nights integer, "serviceFeeRateBps" integer,
    "commissionRateBps" integer, "subtotalCents" integer, "serviceFeeCents" integer,
    "travelerTotalCents" integer, "providerCommissionCents" integer);
insert into auth.users (id)
  select ('12000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from public.lab_quote_parity;
insert into public.connectical_providers (id, owner_user_id, name, country_code, commission_rate_bps)
  select ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         ('12000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         'Parity provider ' || n, 'BR', "commissionRateBps"
  from public.lab_quote_parity;
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
  select ('54000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         ('41000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         'pousadas', 'Parity offer ' || n, "basePriceCents", 'night', true
  from public.lab_quote_parity;
grant select on public.lab_quote_parity to authenticated;
SQL
parity=$(as_user "$traveler_a" "
  select count(*) || '|' || coalesce(string_agg(c.n::text, ',') filter (where
    (q.subtotal_cents, q.service_fee_cents, q.traveler_total_cents, q.provider_commission_cents)
    is distinct from (c.\"subtotalCents\", c.\"serviceFeeCents\", c.\"travelerTotalCents\", c.\"providerCommissionCents\")), '')
  from public.lab_quote_parity c
  cross join lateral public.connectical_create_quote(
    ('54000000-0000-4000-8000-' || lpad(c.n::text, 12, '0'))::uuid, current_date + 35,
    c.quantity, c.nights, c.\"serviceFeeRateBps\") q;")
expected_parity="$(grep -c '"basePriceCents"' "$PWD/__tests__/fixtures/quote-parity.json")|"
[ "$parity" = "$expected_parity" ] || { echo "SQL quotes diverge from the parity fixture (count|mismatched cases): $parity" >&2; exit 1; }
echo "PASS SQL quotes match the shared BRL rounding fixture used by the app tests"

# Búzios calendar day: the app's fixed UTC-3 (buziosIsoDate) must agree with PostgreSQL tzdata.
date_cases=$(tr -d '\n' < "$PWD/__tests__/fixtures/buzios-dates.json")
date_sql="select count(*) || '|' || coalesce(string_agg(c.instant, ',') filter (
    where (c.instant::timestamptz at time zone 'America/Sao_Paulo')::date <> c.\"buziosDate\"::date), '')
  || '|' || (public.connectical_today() = (now() at time zone 'America/Sao_Paulo')::date)
  from jsonb_to_recordset(:'cases'::jsonb) as c(instant text, \"buziosDate\" text);"
date_mismatch=$(printf '%s\n' "$date_sql" | docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -v cases="$date_cases" | tail -1)
expected_dates="$(grep -c '"instant"' "$PWD/__tests__/fixtures/buzios-dates.json")||true"
[ "$date_mismatch" = "$expected_dates" ] || { echo "Búzios date mismatch (count|instants|today): $date_mismatch" >&2; exit 1; }
echo "PASS app and PostgreSQL agree on the Búzios calendar day around midnight"

# Simulated payment outcomes: pending keeps the hold, a retry can approve or reject it, other
# travelers cannot pay it, and an elapsed hold cannot be paid.
pay_offer='55000000-0000-4000-8000-000000000001'
docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('$pay_offer', '40000000-0000-4000-8000-000000000001', 'barcos', 'Payment lab boat', 9000, 'person', true);
insert into public.connectical_inventory (offer_id, service_date, total_units) values ('$pay_offer', current_date + 80, 3);"
pay_counters() {
  docker exec "$container" psql -qAt -U postgres -d postgres -c "select held_units || '/' || sold_units from public.connectical_inventory where offer_id = '$pay_offer';" | tail -1
}
pay_hold() {
  pay_quote=$(as_user "$traveler_a" "select (public.connectical_create_quote('$pay_offer', current_date + 80, 1, 1, 600)).id;")
  as_user "$traveler_a" "select (public.connectical_create_reservation_hold('$pay_quote', gen_random_uuid())).id;"
}
pending_id=$(pay_hold)
pending=$(as_user "$traveler_a" "select r.status || '|' || r.payment_status from public.connectical_simulate_payment('$pending_id','pending','pix','LAB-P') r;")
[ "$pending" = 'pending_payment|pending' ] && [ "$(pay_counters)" = '1/0' ] || { echo "Pending payment mismatch: $pending $(pay_counters)" >&2; exit 1; }
if as_user "$traveler_b" "select public.connectical_simulate_payment('$pending_id','approved','card','LAB-X');" >/dev/null 2>&1; then
  echo "Another traveler could pay the reservation" >&2; exit 1
fi
approved=$(as_user "$traveler_a" "select r.status from public.connectical_simulate_payment('$pending_id','approved','pix','LAB-P2') r;")
[ "$approved" = 'confirmed' ] && [ "$(pay_counters)" = '0/1' ] || { echo "Approve after pending mismatch: $approved $(pay_counters)" >&2; exit 1; }
rejected_id=$(pay_hold)
as_user "$traveler_a" "select public.connectical_simulate_payment('$rejected_id','pending','card','LAB-R');" >/dev/null
rejected=$(as_user "$traveler_a" "select r.status || '|' || r.payment_status from public.connectical_simulate_payment('$rejected_id','rejected','card','LAB-R2') r;")
[ "$rejected" = 'cancelled|rejected' ] && [ "$(pay_counters)" = '0/1' ] || { echo "Reject after pending mismatch: $rejected $(pay_counters)" >&2; exit 1; }
if as_user "$admin_user" "select public.connectical_admin_record_refund('$rejected_id', 100, 'Rejected payment', gen_random_uuid());" >/dev/null 2>&1; then
  echo "Refund of a rejected payment was not rejected" >&2; exit 1
fi
late_id=$(pay_hold)
docker exec "$container" psql -q -U postgres -d postgres -c "update public.connectical_reservations set hold_expires_at = now() - interval '1 second' where id = '$late_id';"
if as_user "$traveler_a" "select public.connectical_simulate_payment('$late_id','approved','card','LAB-L');" >/dev/null 2>&1; then
  echo "Elapsed hold could still be paid" >&2; exit 1
fi
if as_user "$traveler_a" "select public.connectical_simulate_payment('$late_id','refund_now','card','LAB-L');" >/dev/null 2>&1; then
  echo "Unknown payment outcome was accepted" >&2; exit 1
fi
echo "PASS simulated payment outcomes: pending, approve or reject after pending, ownership and expiry"

# Operations tools: atomic range publishing and admin pause/resume of a provider.
provider_user='20000000-0000-4000-8000-000000000001'
lab_provider='40000000-0000-4000-8000-000000000001'
range_offer='56000000-0000-4000-8000-000000000001'
docker exec "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
insert into public.connectical_offers (id, provider_id, category, title, base_price_cents, price_mode, published)
values ('$range_offer', '$lab_provider', 'pousadas', 'Range lab room', 25000, 'night', true);"
range_count=$(as_user "$provider_user" "select public.connectical_provider_publish_inventory_range('$range_offer', current_date + 90, 5, 2);")
range_rows=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select count(*) || '|' || min(total_units) || '|' || max(total_units) from public.connectical_inventory where offer_id = '$range_offer';" | tail -1)
[ "$range_count" = '5' ] && [ "$range_rows" = '5|2|2' ] || { echo "Range publish mismatch: $range_count $range_rows" >&2; exit 1; }
# The payment-lab boat has one unit sold at current_date + 80: a range lowering it to 0 must fail whole.
if as_user "$provider_user" "select public.connectical_provider_publish_inventory_range('$pay_offer', current_date + 78, 5, 0);" >/dev/null 2>&1; then
  echo "Range publish below committed units was not rejected" >&2; exit 1
fi
partial_rows=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select count(*) from public.connectical_inventory where offer_id = '$pay_offer' and service_date in (current_date + 78, current_date + 79);" | tail -1)
[ "$partial_rows" = '0' ] || { echo "Failed range publish left $partial_rows partial rows" >&2; exit 1; }
for bad in "'$range_offer', current_date + 90, 91, 1" "'$range_offer', current_date + 90, 0, 1" "'$range_offer', current_date - 1, 3, 1"; do
  if as_user "$provider_user" "select public.connectical_provider_publish_inventory_range($bad);" >/dev/null 2>&1; then
    echo "Invalid range publish was accepted: $bad" >&2; exit 1
  fi
done
if as_user "$traveler_a" "select public.connectical_provider_publish_inventory_range('$range_offer', current_date + 90, 2, 9);" >/dev/null 2>&1; then
  echo "Traveler could publish a range" >&2; exit 1
fi
echo "PASS providers publish a date range atomically with the single-date rules"

for actor in "$traveler_a" "$provider_user"; do
  if as_user "$actor" "select public.connectical_admin_set_provider_active('$lab_provider', false);" >/dev/null 2>&1; then
    echo "Non-admin could pause a provider" >&2; exit 1
  fi
done
paused=$(as_user "$admin_user" "select (public.connectical_admin_set_provider_active('$lab_provider', false)).active;")
[ "$paused" = 'f' ] || { echo "Admin pause failed: $paused" >&2; exit 1; }
if as_user "$provider_user" "select public.connectical_provider_publish_inventory_range('$range_offer', current_date + 100, 2, 1);" >/dev/null 2>&1; then
  echo "Paused provider could publish a range" >&2; exit 1
fi
if as_user "$traveler_a" "select public.connectical_create_quote('$range_offer', current_date + 90, 1, 2, 600);" >/dev/null 2>&1; then
  echo "Traveler could quote a paused provider" >&2; exit 1
fi
if as_user "$admin_user" "select public.connectical_admin_set_provider_active(gen_random_uuid(), true);" >/dev/null 2>&1; then
  echo "Unknown provider was not rejected" >&2; exit 1
fi
resumed=$(as_user "$admin_user" "select (public.connectical_admin_set_provider_active('$lab_provider', true)).active;")
quote_ok=$(as_user "$traveler_a" "select (public.connectical_create_quote('$range_offer', current_date + 90, 1, 2, 600)).subtotal_cents;")
[ "$resumed" = 't' ] && [ "$quote_ok" = '50000' ] || { echo "Admin resume mismatch: $resumed $quote_ok" >&2; exit 1; }
echo "PASS only admins pause or resume providers, and pausing blocks quotes and publishing"

# Internal Auth ids: travelers and providers never read who acted, nor the provider the traveler's id.
leak_reservation=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "
  select id from public.connectical_reservations where provider_id = '$lab_provider' and status = 'confirmed' order by created_at limit 1;" | tail -1)
leak_traveler=$(docker exec "$container" psql -qAt -U postgres -d postgres -c "select traveler_user_id from public.connectical_reservations where id = '$leak_reservation';" | tail -1)
for probe in \
  "$leak_traveler|select actor_user_id from public.connectical_reservation_events limit 1" \
  "$provider_user|select actor_user_id from public.connectical_reservation_events limit 1" \
  "$provider_user|select traveler_user_id from public.connectical_reservations limit 1" \
  "$provider_user|select * from public.connectical_reservations limit 1" \
  "$leak_traveler|select actor_user_id from public.connectical_refunds limit 1" \
  "$leak_traveler|select idempotency_key from public.connectical_refunds limit 1" \
  "$admin_user|select actor_user_id from public.connectical_reservation_events limit 1"; do
  probe_user=${probe%%|*}; probe_sql=${probe#*|}
  if as_user "$probe_user" "$probe_sql" >/dev/null 2>&1; then
    echo "Internal id readable by $probe_user: $probe_sql" >&2; exit 1
  fi
done
owner_events=$(as_user "$leak_traveler" "select count(id) from public.connectical_reservation_events where reservation_id = '$leak_reservation';")
provider_events=$(as_user "$provider_user" "select count(id) from public.connectical_reservation_events where reservation_id = '$leak_reservation';")
stranger_events=$(as_user "$traveler_b" "select count(id) from public.connectical_reservation_events where reservation_id = '$leak_reservation';")
[ "$owner_events" -ge 2 ] && [ "$provider_events" = "$owner_events" ] && [ "$stranger_events" = '0' ] || {
  echo "Event visibility changed: owner=$owner_events provider=$provider_events stranger=$stranger_events" >&2; exit 1; }
audit_actors=$(as_user "$admin_user" "select count(*) filter (where actor_user_id is not null) from public.connectical_admin_list_reservation_events('$leak_reservation');")
[ "$audit_actors" -ge 1 ] || { echo "Admin audit lost the actor ids: $audit_actors" >&2; exit 1; }
for actor in "$leak_traveler" "$provider_user"; do
  if as_user "$actor" "select public.connectical_admin_list_reservation_events(null, 10);" >/dev/null 2>&1; then
    echo "Non-admin could read the audit with actor ids" >&2; exit 1
  fi
done
cancel_as_provider=$(as_user "$provider_user" "select coalesce(r.traveler_user_id::text, 'hidden') || '|' || coalesce(r.idempotency_key::text, 'hidden') || '|' || r.status from public.connectical_cancel_reservation('$leak_reservation', 'provider_cancelled') r;")
[ "$cancel_as_provider" = 'hidden|hidden|cancelled' ] || { echo "Provider cancel returned traveler ids: $cancel_as_provider" >&2; exit 1; }
echo "PASS internal Auth ids stay out of traveler and provider reads; admins audit them through an RPC"

# The read-only checklist operators paste into the trial tenant must pass here too.
verify_failed=$(docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$PWD/supabase/checks/verify_migrations.sql" | grep -v '|t$' || true)
verify_rows=$(docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$PWD/supabase/checks/verify_migrations.sql" | grep -c '|t$' || true)
[ -z "$verify_failed" ] && [ "$verify_rows" -ge 10 ] || { echo "verify_migrations.sql failed: $verify_failed ($verify_rows ok)" >&2; exit 1; }
echo "PASS supabase/checks/verify_migrations.sql reports every invariant as ok"
echo "Shared PostgreSQL integration test passed"
