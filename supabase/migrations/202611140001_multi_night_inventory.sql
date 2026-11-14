-- Connectical shared reservations: multi-night inventory and service-date guards.
--
-- 202611110001 only held/sold inventory on the check-in date, so two travelers could
-- book overlapping multi-night stays for the same room. Every inventory mutation now
-- covers each night in [service_date, service_date + nights). Apply after 202611110001.
--
-- Rules introduced here:
--   * price_mode 'night' accepts 1..30 nights; other price modes require nights = 1.
--   * Quotes and inventory cannot target dates before "today" in America/Sao_Paulo.
--   * Every function that touches an offer's inventory takes the same per-offer
--     advisory lock, replacing the previous per-date lock keys.
--   * Paused providers cannot publish inventory; offer titles are 1..120 characters.

alter table public.connectical_reservations
  add column if not exists nights integer not null default 1 check (nights between 1 and 30);

create or replace function public.connectical_today()
returns date
language sql stable
set search_path = pg_catalog
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

create or replace function public.connectical_lock_offer(p_offer_id uuid)
returns void
language sql volatile
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('connectical-offer:' || p_offer_id::text, 0))
$$;

-- Applies held/sold deltas to every night of a stay or raises without changing anything.
create or replace function public.connectical_adjust_stay_inventory(
  p_offer_id uuid,
  p_service_date date,
  p_nights integer,
  p_held_delta integer,
  p_sold_delta integer
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_updated integer;
begin
  update public.connectical_inventory
    set held_units = held_units + p_held_delta,
        sold_units = sold_units + p_sold_delta,
        version = version + 1, updated_at = now()
    where offer_id = p_offer_id
      and service_date >= p_service_date and service_date < p_service_date + p_nights
      and held_units + p_held_delta >= 0
      and sold_units + p_sold_delta >= 0
      and held_units + p_held_delta + sold_units + p_sold_delta <= total_units;
  get diagnostics v_updated = row_count;
  if v_updated <> p_nights then raise exception 'inventory_state_conflict' using errcode = '40001'; end if;
end;
$$;

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
  if p_quantity <= 0 or p_nights <= 0 or p_nights > 30 or p_service_fee_rate_bps not in (400, 600, 800) then
    raise exception 'invalid_quote_input' using errcode = '22023';
  end if;
  if p_service_date is null or p_service_date < public.connectical_today() then
    raise exception 'service_date_in_past' using errcode = '22023';
  end if;
  select * into v_offer from public.connectical_offers
    where id = p_offer_id and published = true;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  if v_offer.price_mode <> 'night' and p_nights <> 1 then
    raise exception 'invalid_quote_input' using errcode = '22023';
  end if;
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
  if p_category is null or p_category not in ('pousadas', 'barcos', 'noche', 'buggy')
     or p_price_mode is null or p_price_mode not in ('night', 'person', 'ticket', 'group')
     or p_base_price_cents is null or p_base_price_cents <= 0
     or p_title is null or length(trim(p_title)) not between 1 and 120
     or p_published is null then
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

-- Expires overdue holds of one offer; the caller must hold that offer's lock.
create or replace function public.connectical_expire_offer_holds(p_offer_id uuid)
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_expired public.connectical_reservations;
  v_count integer := 0;
begin
  for v_expired in
    update public.connectical_reservations set status = 'expired', updated_at = now()
    where offer_id = p_offer_id
      and status in ('held', 'pending_payment') and hold_expires_at <= now()
    returning *
  loop
    perform public.connectical_adjust_stay_inventory(
      v_expired.offer_id, v_expired.service_date, v_expired.nights, -v_expired.quantity, 0);
    insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type)
      values (v_expired.id, auth.uid(), 'hold_expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
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
  v_existing public.connectical_reservations;
  v_reservation public.connectical_reservations;
  v_nights_found integer;
  v_nights_available integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_quote from public.connectical_quotes
    where id = p_quote_id and traveler_user_id = auth.uid();
  if not found then raise exception 'quote_not_found' using errcode = 'P0002'; end if;
  perform public.connectical_lock_offer(v_quote.offer_id);

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

  perform public.connectical_expire_offer_holds(v_quote.offer_id);

  select count(*),
         count(*) filter (where total_units - held_units - sold_units >= v_quote.quantity)
    into v_nights_found, v_nights_available
    from public.connectical_inventory
    where offer_id = v_quote.offer_id
      and service_date >= v_quote.service_date
      and service_date < v_quote.service_date + v_quote.nights;
  if v_nights_found < v_quote.nights then
    raise exception 'inventory_not_found' using errcode = 'P0002';
  end if;
  if v_nights_available < v_quote.nights then
    raise exception 'inventory_unavailable' using errcode = 'P0001';
  end if;

  insert into public.connectical_reservations (
    quote_id, idempotency_key, offer_id, provider_id, traveler_user_id,
    service_date, nights, quantity, status, hold_expires_at, amount_cents,
    service_fee_rate_bps, service_fee_cents, provider_commission_rate_bps, provider_commission_cents,
    connectical_margin_cents, quote_version
  ) values (
    v_quote.id, p_idempotency_key, v_quote.offer_id,
    (select provider_id from public.connectical_offers where id = v_quote.offer_id),
    auth.uid(), v_quote.service_date, v_quote.nights, v_quote.quantity, 'held', now() + interval '10 minutes',
    v_quote.traveler_total_cents, v_quote.service_fee_rate_bps, v_quote.service_fee_cents,
    v_quote.provider_commission_rate_bps, v_quote.provider_commission_cents,
    v_quote.service_fee_cents, v_quote.quote_version
  ) returning * into v_reservation;

  perform public.connectical_adjust_stay_inventory(
    v_quote.offer_id, v_quote.service_date, v_quote.nights, v_quote.quantity, 0);
  insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type)
    values (v_reservation.id, auth.uid(), 'reservation_held');
  return v_reservation;
end;
$$;

create or replace function public.connectical_expire_holds()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_offer_id uuid;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  for v_offer_id in
    select distinct offer_id from public.connectical_reservations
    where status in ('held', 'pending_payment') and hold_expires_at <= now()
    order by offer_id
  loop
    perform public.connectical_lock_offer(v_offer_id);
    v_count := v_count + public.connectical_expire_offer_holds(v_offer_id);
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
  if p_service_date is null or p_service_date < public.connectical_today() then
    raise exception 'service_date_in_past' using errcode = '22023';
  end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_offers o
    join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid()
  ) then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_providers
    where owner_user_id = auth.uid() and active = true
  ) then raise exception 'provider_not_authorized' using errcode = '42501'; end if;
  perform public.connectical_lock_offer(p_offer_id);
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
  perform public.connectical_lock_offer(v_reservation.offer_id);
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id and traveler_user_id = auth.uid() for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  if v_reservation.status in ('confirmed', 'cancelled', 'expired', 'refunded') then return v_reservation; end if;
  if v_reservation.status not in ('held', 'pending_payment') or v_reservation.hold_expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;

  if p_outcome = 'approved' then
    perform public.connectical_adjust_stay_inventory(
      v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
      -v_reservation.quantity, v_reservation.quantity);
    update public.connectical_reservations set status = 'confirmed', payment_status = p_outcome,
      payment_method = p_method,
      payment_reference = p_reference, hold_expires_at = null, updated_at = now()
      where id = p_reservation_id returning * into v_reservation;
  elsif p_outcome = 'rejected' then
    perform public.connectical_adjust_stay_inventory(
      v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
      -v_reservation.quantity, 0);
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
  perform public.connectical_lock_offer(v_reservation.offer_id);
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id for update;
  if v_reservation.status in ('held', 'pending_payment') then
    perform public.connectical_adjust_stay_inventory(
      v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
      -v_reservation.quantity, 0);
  elsif v_reservation.status = 'confirmed' then
    perform public.connectical_adjust_stay_inventory(
      v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
      0, -v_reservation.quantity);
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

-- Internal helpers are only reachable through the security definer entry points.
revoke all on function public.connectical_lock_offer(uuid) from public, anon, authenticated;
revoke all on function public.connectical_adjust_stay_inventory(uuid, date, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.connectical_expire_offer_holds(uuid) from public, anon, authenticated;
-- Trigger functions run with the trigger's privileges; nobody needs to call this one directly.
revoke all on function public.connectical_create_traveler_profile() from public, anon, authenticated;
revoke all on function public.connectical_today() from public;
grant execute on function public.connectical_today() to anon, authenticated;

comment on column public.connectical_reservations.nights is 'Nights covered by the hold/sale; inventory is reserved for each date in [service_date, service_date + nights).';
