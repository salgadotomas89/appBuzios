# Provisioning for the InsForge trial project

Step-by-step operator checklist (Spanish): [`docs/runbook-insforge-ensayo.md`](../docs/runbook-insforge-ensayo.md). It covers the read-only [`checks/preflight.sql`](checks/preflight.sql), all seven migrations in order, verification, reconciliation and the scheduler decision.

Apply this only in the verified InsForge **trial** project after the shared-reservation migrations (`202611110001_shared_reservations.sql`, `202611140001_multi_night_inventory.sql`, `202611140002_system_hold_sweep.sql`, then `202611140003_refund_ledger.sql`) have succeeded. Do not run it in production or against Connectical Logistica.

## Preflight (read-only, before applying the migrations)

Run these in the SQL Editor of the candidate project. They change nothing. Stop if any answer is unexpected.

1. Confirm in the InsForge dashboard that the project is the **trial** OfertasApp project for host `8ntv6m27.us-east.insforge.app`, not production and not Connectical Logistica.
2. Confirm the schema is still empty for this feature and that the Auth schema matches what the migrations reference:

```sql
select current_database(), current_user, version();
select table_name from information_schema.tables
  where table_schema = 'public' and table_name like 'connectical_%';      -- expect 0 rows
select count(*) as auth_users from auth.users;                             -- note the number; do not export rows
select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'auth' and p.proname = 'uid') as has_auth_uid;           -- expect true
select rolname from pg_roles where rolname in ('anon', 'authenticated');     -- expect both
select exists (select 1 from information_schema.columns where table_schema = 'auth'
  and table_name = 'users' and column_name = 'raw_user_meta_data') as has_user_metadata; -- expect true
```

3. If `connectical_%` tables already exist, do not re-run blindly: compare with the migrations first.
4. Apply `202611110001_shared_reservations.sql`, `202611140001_multi_night_inventory.sql`, `202611140002_system_hold_sweep.sql` and `202611140003_refund_ledger.sql` in that order, each in its own run. Then verify:

```sql
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'connectical_reservations' and column_name = 'nights'; -- expect 1 row
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'connectical_%' order by 1;
-- Expect false for connectical_adjust_stay_inventory, connectical_expire_offer_holds, connectical_lock_offer
-- connectical_create_traveler_profile and connectical_system_expire_holds; true for the RPCs the app calls
-- (connectical_admin_record_refund is true: it checks the admin role itself).
select has_table_privilege('authenticated', 'public.connectical_refunds', 'insert') as can_insert_refunds; -- expect false
select relrowsecurity from pg_class where oid = 'public.connectical_refunds'::regclass;                -- expect true
```

For a single read-only pass/fail table, paste [`checks/verify_migrations.sql`](checks/verify_migrations.sql) into the SQL Editor after the migrations: every row must show `ok = true`. It only runs `SELECT`, and it accepts either missing write privileges or RLS without write policies, so it does not raise false alarms if the platform grants broad table privileges by default.

The same checks run against a disposable `postgres:17` container with `npm run test:shared-reservations`.

## Accounts and roles

1. In the app, create two test accounts using inboxes controlled by the test operator: one provider account and one administrator account. Verify both email addresses if InsForge Auth requires it. Do not put account passwords or API keys in this file, the repository, or chat.
2. In the InsForge SQL Editor, replace both email placeholders in the script below with those exact verified addresses, then run it. The script refuses missing accounts, the same account for both roles, and incompatible pre-existing roles. It gives the provider a 10% reference commission (1000 basis points) and creates a single lab provider row if one does not already exist.
3. Keep the administrator account under the project owner's control. No role-assignment RPC is exposed to app users; the SQL Editor/DB owner is the trusted provisioning authority.
4. Log in independently as the provider and administrator in separate app sessions. The traveler self-signup trigger creates only `traveler` profiles.

```sql
begin;

do $provision$
declare
  v_provider_user_id uuid;
  v_admin_user_id uuid;
begin
  select id into v_provider_user_id
  from auth.users
  where lower(email) = lower('REPLACE_WITH_VERIFIED_PROVIDER_EMAIL');

  select id into v_admin_user_id
  from auth.users
  where lower(email) = lower('REPLACE_WITH_VERIFIED_ADMIN_EMAIL');

  if v_provider_user_id is null or v_admin_user_id is null then
    raise exception 'Both verified Auth users must exist before provisioning';
  end if;
  if v_provider_user_id = v_admin_user_id then
    raise exception 'Provider and administrator must be different Auth users';
  end if;

  update public.connectical_profiles
  set role = 'provider'
  where user_id = v_provider_user_id and role in ('traveler', 'provider');
  if not found and not exists (
    select 1 from public.connectical_profiles
    where user_id = v_provider_user_id and role = 'provider'
  ) then
    raise exception 'Provider profile is missing or has an incompatible role';
  end if;

  insert into public.connectical_providers (
    owner_user_id, name, country_code, commission_rate_bps, active
  ) values (
    v_provider_user_id, 'Pousada laboratorio', 'BR', 1000, true
  ) on conflict (owner_user_id) do update set
    name = excluded.name,
    country_code = excluded.country_code,
    commission_rate_bps = excluded.commission_rate_bps,
    active = true,
    updated_at = now();

  if not exists (
    select 1 from public.connectical_providers
    where owner_user_id = v_provider_user_id and active = true
  ) then
    raise exception 'Provider account does not have an active provider record';
  end if;

  update public.connectical_profiles
  set role = 'admin'
  where user_id = v_admin_user_id and role in ('traveler', 'admin');
  if not found and not exists (
    select 1 from public.connectical_profiles
    where user_id = v_admin_user_id and role = 'admin'
  ) then
    raise exception 'Administrator profile is missing or has an incompatible role';
  end if;
end;
$provision$;

commit;
```

Verify the records without exposing credentials:

```sql
select p.display_name, p.country_code, p.role, pr.name as provider_name,
       pr.commission_rate_bps, pr.active
from public.connectical_profiles p
left join public.connectical_providers pr on pr.owner_user_id = p.user_id
where p.user_id in (
  select id from auth.users
  where lower(email) in (
    lower('REPLACE_WITH_VERIFIED_PROVIDER_EMAIL'),
    lower('REPLACE_WITH_VERIFIED_ADMIN_EMAIL')
  )
)
order by p.role;
```

## Hold expiration behavior

The current SQL does **not** install a scheduler. Holds expire at their `hold_expires_at` timestamp, but the row status and inventory counter are reconciled lazily when an authenticated session lists reservations (the app calls `connectical_expire_holds`) or when a traveler tries to reserve the same offer (any date, since migration `202611140001`). Thus elapsed holds cannot block a subsequent hold on that slot, but an unused slot's displayed database counters may remain stale until a sweep-triggering request. To run a one-off sweep from an authenticated app session, call the RPC `connectical_expire_holds`; do not grant anonymous execution.

A periodic scheduler is still **not installed**. Migration `202611140002` adds `public.connectical_system_expire_holds()`, which needs no user session and is not executable by `anon` or `authenticated`. Once InsForge scheduling support and cadence are confirmed, a trusted job can run:

```sql
select public.connectical_system_expire_holds();  -- returns the number of holds expired
```

Suggested cadence: every 1–5 minutes (holds last 10 minutes). Until that job exists, expiry stays lazy as described above.

## Refunds (simulated)

Migration `202611140003` adds `public.connectical_refunds` and `public.connectical_admin_record_refund(reservation, amount_cents, reason, idempotency_key)`. Only an administrator session can record a refund, and the function applies no commercial policy: it does not compute deadlines or percentages. It only enforces that the payment was approved, that refunds never exceed `amount_cents`, that a full refund requires the reservation to be cancelled first, and that a retried key with another amount is rejected. No payment gateway is called; every `refund_recorded` event carries `"simulated": true`. Define the cancellation and refund policy before connecting a real gateway.
