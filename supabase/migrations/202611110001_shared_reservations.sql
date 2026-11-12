create extension if not exists pgcrypto;

create table if not exists public.connectical_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  country_code text not null,
  role text not null default 'traveler' check (role in ('traveler', 'provider', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.connectical_providers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id),
  name text not null,
  country_code text not null default 'BR',
  commission_rate_bps integer not null check (commission_rate_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connectical_offers (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.connectical_providers(id),
  category text not null check (category in ('pousadas', 'barcos', 'noche', 'buggy')),
  title text not null,
  base_price_cents integer not null check (base_price_cents > 0),
  price_mode text not null check (price_mode in ('night', 'person', 'ticket', 'group')),
  currency text not null default 'BRL' check (currency = 'BRL'),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connectical_inventory (
  offer_id uuid not null references public.connectical_offers(id) on delete cascade,
  service_date date not null,
  total_units integer not null check (total_units >= 0),
  held_units integer not null default 0 check (held_units >= 0),
  sold_units integer not null default 0 check (sold_units >= 0),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (offer_id, service_date),
  check (held_units + sold_units <= total_units)
);

create table if not exists public.connectical_quotes (
  id uuid primary key default gen_random_uuid(),
  traveler_user_id uuid not null references auth.users(id),
  offer_id uuid not null references public.connectical_offers(id),
  service_date date not null,
  quantity integer not null check (quantity > 0),
  nights integer not null default 1 check (nights > 0),
  subtotal_cents integer not null check (subtotal_cents > 0),
  service_fee_rate_bps integer not null check (service_fee_rate_bps between 0 and 10000),
  service_fee_cents integer not null check (service_fee_cents >= 0),
  traveler_total_cents integer not null check (traveler_total_cents = subtotal_cents + service_fee_cents),
  provider_commission_rate_bps integer not null check (provider_commission_rate_bps between 0 and 10000),
  provider_commission_cents integer not null check (provider_commission_cents >= 0),
  quote_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create table if not exists public.connectical_reservations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.connectical_quotes(id),
  idempotency_key uuid not null,
  offer_id uuid not null references public.connectical_offers(id),
  provider_id uuid not null references public.connectical_providers(id),
  traveler_user_id uuid not null references auth.users(id),
  service_date date not null,
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('held', 'pending_payment', 'confirmed', 'expired', 'cancelled', 'refunded')),
  hold_expires_at timestamptz,
  amount_cents integer not null check (amount_cents > 0),
  service_fee_cents integer not null check (service_fee_cents >= 0),
  provider_commission_rate_bps integer not null check (provider_commission_rate_bps between 0 and 10000),
  provider_commission_cents integer not null check (provider_commission_cents >= 0),
  connectical_margin_cents integer not null default 0,
  quote_version text not null,
  payment_status text check (payment_status in ('approved', 'rejected', 'pending', 'requires_action')),
  payment_method text check (payment_method in ('card', 'pix')),
  payment_reference text,
  refund_cents integer not null default 0 check (refund_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (traveler_user_id, idempotency_key)
);

create table if not exists public.connectical_reservation_events (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.connectical_reservations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.connectical_reservations
  add column if not exists connectical_margin_cents integer not null default 0;

create index if not exists connectical_reservations_traveler_idx
  on public.connectical_reservations (traveler_user_id, created_at desc);
create index if not exists connectical_reservations_provider_idx
  on public.connectical_reservations (provider_id, created_at desc);
create index if not exists connectical_reservations_expiry_idx
  on public.connectical_reservations (offer_id, service_date, hold_expires_at)
  where status in ('held', 'pending_payment');

create or replace function public.connectical_is_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.connectical_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.connectical_create_traveler_profile()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  insert into public.connectical_profiles (user_id, display_name, country_code, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), 'Traveler'),
    coalesce(nullif(new.raw_user_meta_data ->> 'country', ''), 'CL'),
    'traveler'
  ) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists connectical_auth_user_profile on auth.users;
create trigger connectical_auth_user_profile
  after insert on auth.users
  for each row execute function public.connectical_create_traveler_profile();

create or replace function public.connectical_create_quote(
  p_offer_id uuid,
  p_service_date date,
  p_quantity integer,
  p_nights integer,
  p_service_fee_rate_bps integer
)
returns public.connectical_quotes
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_offer public.connectical_offers;
  v_provider public.connectical_providers;
  v_quote public.connectical_quotes;
  v_subtotal numeric;
  v_fee numeric;
  v_commission numeric;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_quantity <= 0 or p_nights <= 0 or p_service_fee_rate_bps not in (400, 600, 800) then
    raise exception 'invalid_quote_input' using errcode = '22023';
  end if;
  select * into v_offer from public.connectical_offers
    where id = p_offer_id and published = true;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into v_provider from public.connectical_providers
    where id = v_offer.provider_id and active = true;
  if not found then raise exception 'provider_inactive' using errcode = 'P0002'; end if;

  v_subtotal := v_offer.base_price_cents::numeric * p_quantity::numeric * p_nights::numeric;
  v_fee := round(v_subtotal * p_service_fee_rate_bps::numeric / 10000);
  v_commission := round(v_subtotal * v_provider.commission_rate_bps::numeric / 10000);
  if v_subtotal > 2147483647
     or v_fee > 2147483647
     or v_commission > 2147483647
     or v_subtotal + v_fee > 2147483647 then
    raise exception 'quote_amount_out_of_range' using errcode = '22003';
  end if;
  insert into public.connectical_quotes (
    traveler_user_id, offer_id, service_date, quantity, nights,
    subtotal_cents, service_fee_rate_bps, service_fee_cents, traveler_total_cents,
    provider_commission_rate_bps, provider_commission_cents, quote_version
  ) values (
    auth.uid(), v_offer.id, p_service_date, p_quantity, p_nights,
    v_subtotal::integer, p_service_fee_rate_bps, v_fee::integer, (v_subtotal + v_fee)::integer,
    v_provider.commission_rate_bps,
    v_commission::integer,
    'connectical-brl-v1'
  ) returning * into v_quote;
  return v_quote;
end;
$$;

create or replace function public.connectical_create_reservation_hold(
  p_quote_id uuid,
  p_idempotency_key uuid
)
returns public.connectical_reservations
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_quote public.connectical_quotes;
  v_inventory public.connectical_inventory;
  v_existing public.connectical_reservations;
  v_expired_quantity integer;
  v_reservation public.connectical_reservations;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_quote from public.connectical_quotes
    where id = p_quote_id and traveler_user_id = auth.uid();
  if not found then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_quote.offer_id::text || ':' || v_quote.service_date::text, 0));

  select * into v_existing from public.connectical_reservations
    where traveler_user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.quote_id <> p_quote_id then
      raise exception 'idempotency_key_reused' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  if v_quote.expires_at <= now() then raise exception 'quote_expired' using errcode = 'P0001'; end if;
  if exists (select 1 from public.connectical_reservations where quote_id = p_quote_id) then
    raise exception 'quote_already_reserved' using errcode = '23505';
  end if;

  select * into v_inventory from public.connectical_inventory
    where offer_id = v_quote.offer_id and service_date = v_quote.service_date
    for update;
  if not found then raise exception 'inventory_not_found' using errcode = 'P0002'; end if;

  with expired as (
    update public.connectical_reservations
      set status = 'expired', updated_at = now()
      where offer_id = v_quote.offer_id and service_date = v_quote.service_date
        and status in ('held', 'pending_payment') and hold_expires_at <= now()
      returning id, quantity
  ), logged as (
    insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type)
      select id, auth.uid(), 'hold_expired' from expired
  )
  select coalesce(sum(quantity), 0) into v_expired_quantity from expired;
  if v_expired_quantity > 0 then
    update public.connectical_inventory
      set held_units = held_units - v_expired_quantity,
          version = version + 1, updated_at = now()
      where offer_id = v_quote.offer_id and service_date = v_quote.service_date
        and held_units >= v_expired_quantity;
    if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
  end if;

  select * into v_inventory from public.connectical_inventory
    where offer_id = v_quote.offer_id and service_date = v_quote.service_date;
  if v_inventory.total_units - v_inventory.held_units - v_inventory.sold_units < v_quote.quantity then
    raise exception 'inventory_unavailable' using errcode = 'P0001';
  end if;

  insert into public.connectical_reservations (
    quote_id, idempotency_key, offer_id, provider_id, traveler_user_id,
    service_date, quantity, status, hold_expires_at, amount_cents,
    service_fee_cents, provider_commission_rate_bps, provider_commission_cents,
    connectical_margin_cents, quote_version
  ) values (
    v_quote.id, p_idempotency_key, v_quote.offer_id,
    (select provider_id from public.connectical_offers where id = v_quote.offer_id),
    auth.uid(), v_quote.service_date, v_quote.quantity, 'held', now() + interval '10 minutes',
    v_quote.traveler_total_cents, v_quote.service_fee_cents,
    v_quote.provider_commission_rate_bps, v_quote.provider_commission_cents,
    v_quote.service_fee_cents, v_quote.quote_version
  ) returning * into v_reservation;

  update public.connectical_inventory
    set held_units = held_units + v_quote.quantity,
        version = version + 1, updated_at = now()
    where offer_id = v_quote.offer_id and service_date = v_quote.service_date;
  insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type)
    values (v_reservation.id, auth.uid(), 'reservation_held');
  return v_reservation;
end;
$$;

create or replace function public.connectical_provider_upsert_offer(
  p_offer_id uuid,
  p_category text,
  p_title text,
  p_base_price_cents integer,
  p_price_mode text,
  p_published boolean
)
returns public.connectical_offers
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_provider public.connectical_providers;
  v_offer public.connectical_offers;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_provider from public.connectical_providers
    where owner_user_id = auth.uid() and active = true;
  if not found and not public.connectical_is_admin() then
    raise exception 'provider_not_authorized' using errcode = '42501';
  end if;
  if p_category not in ('pousadas', 'barcos', 'noche', 'buggy')
     or p_price_mode not in ('night', 'person', 'ticket', 'group')
     or p_base_price_cents <= 0 or length(trim(p_title)) = 0 then
    raise exception 'invalid_offer' using errcode = '22023';
  end if;
  if p_offer_id is null then
    if v_provider.id is null then raise exception 'admin_offer_requires_provider' using errcode = '22023'; end if;
    insert into public.connectical_offers (
      provider_id, category, title, base_price_cents, price_mode, published
    ) values (
      v_provider.id, p_category, trim(p_title), p_base_price_cents, p_price_mode, p_published
    ) returning * into v_offer;
  else
    update public.connectical_offers set category = p_category, title = trim(p_title),
      base_price_cents = p_base_price_cents, price_mode = p_price_mode,
      published = p_published, updated_at = now()
      where id = p_offer_id and (public.connectical_is_admin() or provider_id = v_provider.id)
      returning * into v_offer;
    if not found then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  end if;
  return v_offer;
end;
$$;

create or replace function public.connectical_expire_holds()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_slot record;
  v_expired public.connectical_reservations;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  for v_slot in
    select distinct offer_id, service_date from public.connectical_reservations
    where status in ('held', 'pending_payment') and hold_expires_at <= now()
    order by offer_id, service_date
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_slot.offer_id::text || ':' || v_slot.service_date::text, 0));
    for v_expired in
      update public.connectical_reservations set status = 'expired', updated_at = now()
      where offer_id = v_slot.offer_id and service_date = v_slot.service_date
        and status in ('held', 'pending_payment') and hold_expires_at <= now()
      returning *
    loop
      update public.connectical_inventory set held_units = held_units - v_expired.quantity,
        version = version + 1, updated_at = now()
        where offer_id = v_expired.offer_id and service_date = v_expired.service_date
          and held_units >= v_expired.quantity;
      if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
      insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type)
        values (v_expired.id, auth.uid(), 'hold_expired');
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

create or replace function public.connectical_provider_publish_inventory(
  p_offer_id uuid,
  p_service_date date,
  p_total_units integer
)
returns public.connectical_inventory
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_inventory public.connectical_inventory;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_total_units < 0 then raise exception 'invalid_inventory' using errcode = '22023'; end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_offers o
    join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid()
  ) then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  insert into public.connectical_inventory (offer_id, service_date, total_units)
    values (p_offer_id, p_service_date, p_total_units)
  on conflict (offer_id, service_date) do update set
    total_units = excluded.total_units,
    version = public.connectical_inventory.version + 1,
    updated_at = now()
  where excluded.total_units >= public.connectical_inventory.held_units
    + public.connectical_inventory.sold_units
  returning * into v_inventory;
  if not found then raise exception 'inventory_below_committed_units' using errcode = '23514'; end if;
  return v_inventory;
end;
$$;

create or replace function public.connectical_simulate_payment(
  p_reservation_id uuid,
  p_outcome text,
  p_method text,
  p_reference text default null
)
returns public.connectical_reservations
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_reservation public.connectical_reservations;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_outcome not in ('approved', 'rejected', 'pending', 'requires_action') then
    raise exception 'invalid_payment_outcome' using errcode = '22023';
  end if;
  if p_method not in ('card', 'pix') then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id and traveler_user_id = auth.uid();
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reservation.offer_id::text || ':' || v_reservation.service_date::text, 0));
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id and traveler_user_id = auth.uid() for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  if v_reservation.status in ('confirmed', 'cancelled', 'expired', 'refunded') then return v_reservation; end if;
  if v_reservation.status not in ('held', 'pending_payment') or v_reservation.hold_expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;

  if p_outcome = 'approved' then
    update public.connectical_inventory
      set held_units = held_units - v_reservation.quantity,
          sold_units = sold_units + v_reservation.quantity,
          version = version + 1, updated_at = now()
      where offer_id = v_reservation.offer_id and service_date = v_reservation.service_date
        and held_units >= v_reservation.quantity;
    if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
    update public.connectical_reservations set status = 'confirmed', payment_status = p_outcome,
      payment_method = p_method,
      payment_reference = p_reference, hold_expires_at = null, updated_at = now()
      where id = p_reservation_id returning * into v_reservation;
  elsif p_outcome = 'rejected' then
    update public.connectical_inventory
      set held_units = held_units - v_reservation.quantity,
          version = version + 1, updated_at = now()
      where offer_id = v_reservation.offer_id and service_date = v_reservation.service_date
        and held_units >= v_reservation.quantity;
    if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
    update public.connectical_reservations set status = 'cancelled', payment_status = p_outcome,
      payment_method = p_method,
      payment_reference = p_reference, hold_expires_at = null, updated_at = now()
      where id = p_reservation_id returning * into v_reservation;
  else
    update public.connectical_reservations set status = 'pending_payment', payment_status = p_outcome,
      payment_method = p_method,
      payment_reference = p_reference, updated_at = now()
      where id = p_reservation_id returning * into v_reservation;
  end if;
  insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
    values (v_reservation.id, auth.uid(), 'payment_' || p_outcome,
      jsonb_build_object('provider', 'simulated', 'reference', p_reference));
  return v_reservation;
end;
$$;

create or replace function public.connectical_cancel_reservation(p_reservation_id uuid, p_reason text)
returns public.connectical_reservations
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_reservation public.connectical_reservations;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  if v_reservation.traveler_user_id <> auth.uid()
     and not exists (select 1 from public.connectical_providers p
       where p.id = v_reservation.provider_id and p.owner_user_id = auth.uid())
     and not public.connectical_is_admin() then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reservation.offer_id::text || ':' || v_reservation.service_date::text, 0));
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id for update;
  if v_reservation.status in ('held', 'pending_payment') then
    update public.connectical_inventory set held_units = held_units - v_reservation.quantity,
      version = version + 1, updated_at = now()
      where offer_id = v_reservation.offer_id and service_date = v_reservation.service_date
        and held_units >= v_reservation.quantity;
    if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
  elsif v_reservation.status = 'confirmed' then
    update public.connectical_inventory set sold_units = sold_units - v_reservation.quantity,
      version = version + 1, updated_at = now()
      where offer_id = v_reservation.offer_id and service_date = v_reservation.service_date
        and sold_units >= v_reservation.quantity;
    if not found then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
  else
    return v_reservation;
  end if;
  update public.connectical_reservations set status = 'cancelled', hold_expires_at = null,
    updated_at = now() where id = p_reservation_id returning * into v_reservation;
  insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
    values (v_reservation.id, auth.uid(), 'reservation_cancelled', jsonb_build_object('reason', p_reason));
  return v_reservation;
end;
$$;

alter table public.connectical_profiles enable row level security;
alter table public.connectical_providers enable row level security;
alter table public.connectical_offers enable row level security;
alter table public.connectical_inventory enable row level security;
alter table public.connectical_quotes enable row level security;
alter table public.connectical_reservations enable row level security;
alter table public.connectical_reservation_events enable row level security;

drop policy if exists connectical_profiles_read on public.connectical_profiles;
drop policy if exists connectical_profiles_insert on public.connectical_profiles;
drop policy if exists connectical_providers_read on public.connectical_providers;
drop policy if exists connectical_offers_read on public.connectical_offers;
drop policy if exists connectical_inventory_read on public.connectical_inventory;
drop policy if exists connectical_quotes_read on public.connectical_quotes;
drop policy if exists connectical_reservations_read on public.connectical_reservations;
drop policy if exists connectical_events_read on public.connectical_reservation_events;

create policy connectical_profiles_read on public.connectical_profiles for select to authenticated
  using (user_id = auth.uid() or public.connectical_is_admin());
create policy connectical_profiles_insert on public.connectical_profiles for insert to authenticated
  with check (user_id = auth.uid() and role = 'traveler');
create policy connectical_providers_read on public.connectical_providers for select to authenticated
  using (owner_user_id = auth.uid() or public.connectical_is_admin());
create policy connectical_offers_read on public.connectical_offers for select to anon, authenticated
  using (published or public.connectical_is_admin() or exists (
    select 1 from public.connectical_providers p where p.id = provider_id and p.owner_user_id = auth.uid()
  ));
create policy connectical_inventory_read on public.connectical_inventory for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o where o.id = offer_id and o.published)
    or public.connectical_is_admin() or exists (
      select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
      where o.id = offer_id and p.owner_user_id = auth.uid()
    ));
create policy connectical_quotes_read on public.connectical_quotes for select to authenticated
  using (traveler_user_id = auth.uid() or public.connectical_is_admin() or exists (
    select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    where o.id = offer_id and p.owner_user_id = auth.uid()
  ));
create policy connectical_reservations_read on public.connectical_reservations for select to authenticated
  using (traveler_user_id = auth.uid() or public.connectical_is_admin() or exists (
    select 1 from public.connectical_providers p where p.id = provider_id and p.owner_user_id = auth.uid()
  ));
create policy connectical_events_read on public.connectical_reservation_events for select to authenticated
  using (public.connectical_is_admin() or exists (
    select 1 from public.connectical_reservations r where r.id = reservation_id
      and (r.traveler_user_id = auth.uid() or exists (
        select 1 from public.connectical_providers p where p.id = r.provider_id and p.owner_user_id = auth.uid()
      ))
  ));

revoke all on public.connectical_profiles, public.connectical_providers,
  public.connectical_offers, public.connectical_inventory, public.connectical_quotes,
  public.connectical_reservations, public.connectical_reservation_events from anon, authenticated;
revoke all on function public.connectical_is_admin() from public;
revoke all on function public.connectical_create_quote(uuid, date, integer, integer, integer) from public, anon;
revoke all on function public.connectical_provider_upsert_offer(uuid, text, text, integer, text, boolean) from public, anon;
revoke all on function public.connectical_expire_holds() from public, anon;
revoke all on function public.connectical_provider_publish_inventory(uuid, date, integer) from public, anon;
revoke all on function public.connectical_create_reservation_hold(uuid, uuid) from public, anon;
revoke all on function public.connectical_simulate_payment(uuid, text, text, text) from public, anon;
revoke all on function public.connectical_cancel_reservation(uuid, text) from public, anon;
grant select on public.connectical_offers, public.connectical_inventory to anon, authenticated;
grant select on public.connectical_profiles, public.connectical_providers to authenticated;
grant select on public.connectical_quotes, public.connectical_reservations,
  public.connectical_reservation_events to authenticated;
grant usage, select on sequence public.connectical_reservation_events_id_seq to authenticated;

grant execute on function public.connectical_is_admin() to anon, authenticated;
grant execute on function public.connectical_create_quote(uuid, date, integer, integer, integer) to authenticated;
grant execute on function public.connectical_provider_upsert_offer(uuid, text, text, integer, text, boolean) to authenticated;
grant execute on function public.connectical_expire_holds() to authenticated;
grant execute on function public.connectical_provider_publish_inventory(uuid, date, integer) to authenticated;
grant execute on function public.connectical_create_reservation_hold(uuid, uuid) to authenticated;
grant execute on function public.connectical_simulate_payment(uuid, text, text, text) to authenticated;
grant execute on function public.connectical_cancel_reservation(uuid, text) to authenticated;

comment on table public.connectical_reservations is 'Shared BRL reservation ledger; payment methods remain simulated until commercial approval.';
comment on table public.connectical_reservation_events is 'Append-only reservation lifecycle history.';
comment on function public.connectical_create_reservation_hold(uuid, uuid) is 'Atomic inventory hold with row locking, idempotency, expiry cleanup and immutable quote amounts.';
