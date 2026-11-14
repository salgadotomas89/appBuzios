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
echo "Shared PostgreSQL integration test passed"
