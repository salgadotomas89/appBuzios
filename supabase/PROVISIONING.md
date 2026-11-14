# Provisioning for the InsForge trial project

Apply this only in the verified InsForge **trial** project after both shared-reservation migrations (`202611110001_shared_reservations.sql`, then `202611140001_multi_night_inventory.sql`) have succeeded. Do not run it in production or against Connectical Logistica.

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

The current SQL does **not** install a scheduler. Holds expire at their `hold_expires_at` timestamp, but the row status and inventory counter are reconciled lazily when an authenticated session lists reservations (the app calls `connectical_expire_holds`) or when a traveler tries to reserve the same offer/date. Thus elapsed holds cannot block a subsequent hold on that slot, but an unused slot's displayed database counters may remain stale until a sweep-triggering request. To run a one-off sweep from an authenticated app session, call the RPC `connectical_expire_holds`; do not grant anonymous execution.

A periodic Supabase/InsForge scheduled function/cron can be configured later after confirming platform support and cadence. It is intentionally not assumed by this migration.
