#!/bin/sh
# Recorrido de extremo a extremo del piloto cerrado, con datos sintéticos, sobre un PostgreSQL 17 desechable
# con las quince migraciones. Sigue el orden en que lo viviría el equipo del piloto: alta de proveedor,
# moderación previa (la configuración preparada para el piloto), publicación, reservas concurrentes, pagos
# simulados, cancelación, reembolso, incidencia, conciliación e indicadores. Cada paso imprime PASS.
# No se conecta a ningún tenant remoto.
set -eu

container="connectical-pilot-e2e-$$"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/connectical-pilot.XXXXXX")"
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; rm -rf "$workdir"; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=connectical_local_test_only \
  -v "$PWD/supabase:/sb:ro" postgres:17 >/dev/null
attempt=0
until docker exec "$container" psql -qAt -h 127.0.0.1 -U postgres -c 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -le 150 ] || { echo "PostgreSQL did not start" >&2; exit 1; }; sleep 0.2
done
sql() { docker exec -i "$container" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
sql >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role pilot_session login;
grant authenticated to pilot_session;
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
  sql -f "$file" >/dev/null 2>"$workdir/migration.err" || { cat "$workdir/migration.err" >&2; echo "Migration failed: $file" >&2; exit 1; }
done

# Conserva el código de salida de psql: con `| tail -1` directo, un error pasaría por éxito.
as_user() {
  as_user_out=$(sql -c "set session authorization pilot_session; set role authenticated; select set_config('request.jwt.claim.sub','$1',false);" -c "$2") || return 1
  printf '%s\n' "$as_user_out" | tail -1
}
fails() { if as_user "$1" "$2" >/dev/null 2>&1; then echo "Expected a refusal: $2" >&2; exit 1; fi; }
expect() { [ "$1" = "$2" ] || { echo "$3: expected '$2', got '$1'" >&2; exit 1; }; }

admin='a0000000-0000-4000-8000-000000000001'
owner='b0000000-0000-4000-8000-000000000001'
ana='c0000000-0000-4000-8000-000000000001'
bruno='c0000000-0000-4000-8000-000000000002'

# 0. Cuentas sintéticas (en el tenant las crea el registro con verificación de correo) y el admin por SQL.
sql >/dev/null <<SQL
insert into auth.users (id, email, email_verified, profile) values
  ('$admin', 'admin@pilot.test', true, '{"name":"Admin piloto","country":"BR"}'),
  ('$owner', 'pousada@pilot.test', true, '{"name":"Dona Marta","country":"BR"}'),
  ('$ana', 'ana@pilot.test', true, '{"name":"Ana","country":"CL"}'),
  ('$bruno', 'bruno@pilot.test', true, '{"name":"Bruno","country":"AR"}');
-- Cada cuenta crea su perfil al iniciar sesión, como la app; el rol de admin se asigna por SQL.
set session authorization pilot_session;
set role authenticated;
select set_config('request.jwt.claim.sub', id::text, false), public.connectical_ensure_profile()
from (values ('$admin'::uuid), ('$owner'::uuid), ('$ana'::uuid), ('$bruno'::uuid)) as u(id);
reset role;
reset session authorization;
update public.connectical_profiles set role = 'admin' where user_id = '$admin';
-- Configuración preparada para el piloto: cada oferta nueva espera aprobación.
update public.connectical_settings set value = 'true' where key = 'offer_moderation_required';
insert into public.connectical_settings (key, value) values ('media_public_base_url', '"https://media.pilot.test/"');
SQL
expect "$(sql -c "select string_agg(display_name || ':' || role, ',' order by display_name) from public.connectical_profiles;")" 'Admin piloto:admin,Ana:traveler,Bruno:traveler,Dona Marta:traveler' 'Profiles from sign-in'
echo "PASS 0. synthetic accounts: profiles created on sign-in from auth.users.profile, one admin by SQL"

# 1. Alta de proveedor.
app=$(as_user "$owner" "select public.connectical_submit_provider_application('Pousada Maré Alta', 'pousadas', 'Marta Lima', '+55 22 98888-1111', 'pousada@pilot.test', 'Geribá', 'Cinco quartos a 100 m da praia');")
fails "$owner" "select public.connectical_provider_upsert_offer(null, 'pousadas', 'Antes de aprovar', 30000, 'night', true);"
as_user "$admin" "select public.connectical_admin_review_provider_application('$app', 'approved', 'Alvará conferido', 1000);" >/dev/null
expect "$(as_user "$owner" "select status from public.connectical_my_provider_application();")" 'approved' 'Application status'
echo "PASS 1. provider application approved by the admin with an explicit 10% commission"

# 2. Publicación con moderación previa.
offer=$(as_user "$owner" "select (public.connectical_provider_upsert_offer(null, 'pousadas', 'Quarto vista mar', 40000, 'night', true)).id;")
as_user "$owner" "select public.connectical_provider_set_offer_details('$offer', 'Quarto duplo com varanda', 'Geribá', 'Recepção da pousada', 'Check-in 14h', 1, 2);" >/dev/null
as_user "$owner" "select public.connectical_provider_publish_inventory_range('$offer', current_date + 20, 3, 1);" >/dev/null
photo_key="offers/$offer/$(sql -c 'select gen_random_uuid();').jpg"
# Como la deja la función offer-media: escrita con la clave de API (uploaded_by nulo) en el bucket privado.
sql -c "insert into storage.buckets (name, public) values ('offer-media', false); insert into storage.objects (bucket, key, size, mime_type) values ('offer-media', '$photo_key', 350000, 'image/jpeg');" >/dev/null
photo=$(as_user "$owner" "select public.connectical_add_offer_media('$offer', '$photo_key', 'image/jpeg', 350000, 1600, 1066, 'Varanda com vista para o mar');")
expect "$(as_user "$ana" "select count(*) from public.connectical_offers where id = '$offer';")" '0' 'Pending offer visible to travelers'
fails "$ana" "select public.connectical_create_quote('$offer', current_date + 20, 1, 2, 600);"
as_user "$admin" "select public.connectical_admin_set_offer_moderation('$offer', 'approved', '');" >/dev/null
# La oferta aprobada ya se ve; su foto, solo cuando la administración la revisa (202611160005).
expect "$(sql -c "set role anon; select count(*) from public.connectical_offers where id = '$offer';")" '1' 'Offer visible after approval'
expect "$(sql -c "set role anon; select count(*) from public.connectical_offer_media where offer_id = '$offer';")" '0' 'Photo hidden until reviewed'
as_user "$admin" "select public.connectical_admin_set_media_moderation('$photo', 'approved', '');" >/dev/null
expect "$(sql -c "set role anon; select count(*) from public.connectical_offer_media where offer_id = '$offer';")" '1' 'Photo visible after approval'
echo "PASS 2. offer with details, 3 nights of inventory and a photo stay hidden until the admin approves the offer and then the photo"

# 3. Reservas concurrentes por la última habitación de dos noches.
qa=$(as_user "$ana" "select (public.connectical_create_quote('$offer', current_date + 20, 1, 2, 600)).id;")
qb=$(as_user "$bruno" "select (public.connectical_create_quote('$offer', current_date + 21, 1, 2, 600)).id;")
start=$(sql -c "select extract(epoch from clock_timestamp() + interval '3 seconds');")
hold_in_background() {
  sql -c "set session authorization pilot_session; set role authenticated; select set_config('request.jwt.claim.sub','$1',false);" \
      -c "select pg_sleep(greatest(0, $start - extract(epoch from clock_timestamp())));" \
      -c "select (public.connectical_create_reservation_hold('$2', gen_random_uuid())).id;" >"$workdir/$3" 2>&1 \
    && echo ok >>"$workdir/$3" || echo fail >>"$workdir/$3"
}
hold_in_background "$ana" "$qa" ana & pid_a=$!
hold_in_background "$bruno" "$qb" bruno & pid_b=$!
wait "$pid_a"; wait "$pid_b"
winners=$(tail -qn1 "$workdir/ana" "$workdir/bruno" | grep -c '^ok$' || true)
expect "$winners" '1' 'Concurrent winners'
if [ "$(tail -n1 "$workdir/ana")" = 'ok' ]; then winner="$ana"; else winner="$bruno"; fi
reservation=$(sql -c "select id from public.connectical_reservations where traveler_user_id = '$winner';")
echo "PASS 3. two travelers race for overlapping stays on the last room: exactly one holds it"

# 4. Pago simulado: pendiente y después aprobado.
expect "$(as_user "$winner" "select (public.connectical_simulate_payment('$reservation', 'pending', 'pix', 'PILOT-1')).status;")" 'pending_payment' 'Pending payment'
expect "$(as_user "$winner" "select (public.connectical_simulate_payment('$reservation', 'approved', 'pix', 'PILOT-2')).status;")" 'confirmed' 'Approved payment'
expect "$(as_user "$owner" "select coalesce(provider_commission_cents::text, 'hidden') from public.connectical_list_reservations() where id = '$reservation';")" '8000' 'Provider sees its commission'
expect "$(as_user "$winner" "select coalesce(provider_commission_cents::text, 'hidden') from public.connectical_list_reservations() where id = '$reservation';")" 'hidden' 'Traveler never sees the commission'
echo "PASS 4. simulated Pix payment goes pending then approved; commission visible to the provider only"

# 5. Cancelación y reembolso decidido por la administración.
amount=$(sql -c "select amount_cents from public.connectical_reservations where id = '$reservation';")
fails "$admin" "select public.connectical_admin_record_refund('$reservation', $amount, 'Antes de cancelar', gen_random_uuid());"
as_user "$winner" "select public.connectical_cancel_reservation('$reservation', 'traveler_request');" >/dev/null
expect "$(as_user "$admin" "select (public.connectical_admin_record_refund('$reservation', $amount, 'Cancelamento com 30 dias', gen_random_uuid())).status;")" 'refunded' 'Full refund'
echo "PASS 5. traveler cancels the paid stay and the admin records the full simulated refund"

# 6. Incidencia reportada y resuelta.
incident=$(as_user "$winner" "select public.connectical_report_incident('$reservation', 'payment', 'Quero confirmar o prazo do estorno.');")
as_user "$admin" "select public.connectical_admin_update_incident('$incident', 'resolved', 'Estorno simulado registrado.');" >/dev/null
expect "$(as_user "$winner" "select status from public.connectical_my_incidents();")" 'resolved' 'Incident status'
echo "PASS 6. incident reported on the reservation and resolved with a reply"

# 7. Conciliación, indicadores, verificación y registro de actividad.
reconcile=$(sql -f /sb/checks/reconcile_inventory.sql)
expect "$reconcile" '' 'Inventory reconciliation'
expect "$(as_user "$admin" "select concat_ws('|', k.confirmed, k.refunded, k.refunded_cents) from public.connectical_admin_kpis(current_date - 1, current_date + 1) k;")" "0|1|$amount" 'KPIs'
failed=$(sql -f /sb/checks/verify_migrations.sql | grep -v '|t$' || true)
expect "$failed" '' 'verify_migrations.sql'
audit=$(as_user "$admin" "select string_agg(distinct action, ',' order by action) from public.connectical_admin_list_audit_log(200);")
case "$audit" in
  *application_approved*incident_resolved*media_approved*offer_terms_changed*provider_created*refund_recorded*role_changed*) ;;
  *) echo "Audit log incomplete: $audit" >&2; exit 1 ;;
esac
echo "PASS 7. inventory reconciles, KPIs match, every invariant verifies and the audit log has each admin step"
echo "Pilot end-to-end rehearsal passed"
