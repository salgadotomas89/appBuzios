-- Privacidad del turista y control de pagos simulados en la base de datos.
--
-- Corrige lo que una revisión encontró después de 202611140005 y 202611140007:
--   * los proveedores leían el uuid de los turistas en connectical_quotes (la 0005 no la cubría);
--   * los turistas veían la comisión B2B en la cotización devuelta y en sus reservas. La comisión es
--     un acuerdo entre proveedor y plataforma: la ven el proveedor dueño (es su contrato) y la
--     administración, nunca el turista;
--   * connectical_simulate_payment estaba abierto a cualquier usuario autenticado sin interruptor en
--     el servidor: ahora depende de connectical_settings.simulated_payments_enabled (sin fila = apagado);
--   * un webhook de rechazo de un intento anterior podía cancelar un intento posterior.

create table if not exists public.connectical_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.connectical_settings enable row level security;
revoke all on table public.connectical_settings from public, anon, authenticated;

-- Encendido para el laboratorio y el tenant de ensayo. Apagarlo antes de conectar una pasarela real:
--   update public.connectical_settings set value = 'false', updated_at = now()
--   where key = 'simulated_payments_enabled';
insert into public.connectical_settings (key, value) values ('simulated_payments_enabled', 'true')
on conflict (key) do nothing;

-- Quita a cada lector lo que no le corresponde de una fila de reserva.
create or replace function public.connectical_redact_reservation(p_reservation public.connectical_reservations)
returns public.connectical_reservations
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_result public.connectical_reservations := p_reservation;
begin
  if public.connectical_is_admin() then return v_result; end if;
  if v_result.traveler_user_id is distinct from auth.uid() then
    v_result.traveler_user_id := null;
    v_result.idempotency_key := null;
  end if;
  if not exists (select 1 from public.connectical_providers p
                 where p.id = v_result.provider_id and p.owner_user_id = auth.uid()) then
    v_result.provider_commission_rate_bps := null;
    v_result.provider_commission_cents := null;
  end if;
  return v_result;
end;
$$;
revoke all on function public.connectical_redact_reservation(public.connectical_reservations) from public, anon, authenticated;

-- Cotizaciones: ni el uuid del turista ni la comisión en lecturas directas.
revoke select on table public.connectical_quotes from anon, authenticated;
grant select (id, offer_id, service_date, quantity, nights, subtotal_cents, service_fee_rate_bps,
              service_fee_cents, traveler_total_cents, quote_version, created_at, expires_at)
  on public.connectical_quotes to authenticated;

-- Reservas: la comisión sale de la lectura directa y se sirve redactada por este RPC.
revoke select (provider_commission_rate_bps, provider_commission_cents)
  on public.connectical_reservations from authenticated;

create or replace function public.connectical_list_reservations()
returns setof public.connectical_reservations
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query
    select (public.connectical_redact_reservation(r)).*
    from public.connectical_reservations r
    where public.connectical_can_read_reservation(r.id)
    order by r.created_at desc;
end;
$$;
revoke all on function public.connectical_list_reservations() from public, anon;
grant execute on function public.connectical_list_reservations() to authenticated;

-- Igual que en 202611140009, sin devolver la comisión a quien cotiza.
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
  v_rate integer;
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
  if p_quantity < v_offer.min_quantity or p_quantity > coalesce(v_offer.max_quantity, p_quantity) then
    raise exception 'quantity_out_of_range' using errcode = '22023';
  end if;
  select * into v_provider from public.connectical_providers
    where id = v_offer.provider_id and active = true;
  if not found then raise exception 'provider_inactive' using errcode = 'P0002'; end if;

  v_rate := coalesce(v_offer.commission_rate_bps, v_provider.commission_rate_bps);
  v_subtotal := v_offer.base_price_cents::numeric * p_quantity::numeric * p_nights::numeric;
  v_fee := round(v_subtotal * p_service_fee_rate_bps::numeric / 10000);
  v_commission := round(v_subtotal * v_rate::numeric / 10000);
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
    v_rate,
    v_commission::integer,
    'connectical-brl-v1'
  ) returning * into v_quote;
  -- Quien cotiza es el turista: la comisión es un acuerdo entre proveedor y plataforma.
  if not public.connectical_is_admin() then
    v_quote.provider_commission_rate_bps := null;
    v_quote.provider_commission_cents := null;
  end if;
  return v_quote;
end;
$$;

-- Igual que en 202611140001, con la fila redactada.
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
    return public.connectical_redact_reservation(v_existing);
  end if;
  if v_quote.expires_at <= now() then raise exception 'quote_expired' using errcode = 'P0001'; end if;
  if exists (select 1 from public.connectical_reservations where quote_id = p_quote_id) then
    raise exception 'quote_already_reserved' using errcode = '23505';
  end if;
  -- Quotes created by the previous create_quote may still be open while this migration lands.
  if v_quote.nights > 30 or (v_quote.nights <> 1 and not exists (
    select 1 from public.connectical_offers where id = v_quote.offer_id and price_mode = 'night'
  )) then
    raise exception 'invalid_quote_input' using errcode = '22023';
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
  return public.connectical_redact_reservation(v_reservation);
end;
$$;

-- Igual que en 202611140001, con interruptor en la base de datos y fila redactada.
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
  -- Interruptor en la base de datos: sin la fila o con false no hay pagos simulados.
  if not coalesce((select (value #>> '{}')::boolean from public.connectical_settings
                   where key = 'simulated_payments_enabled'), false) then
    raise exception 'simulated_payments_disabled' using errcode = '42501';
  end if;
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id and traveler_user_id = auth.uid();
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  perform public.connectical_lock_offer(v_reservation.offer_id);
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id and traveler_user_id = auth.uid() for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  if v_reservation.status in ('confirmed', 'cancelled', 'expired', 'refunded') then return public.connectical_redact_reservation(v_reservation); end if;
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
  return public.connectical_redact_reservation(v_reservation);
end;
$$;

-- Igual que en 202611140005, con la fila redactada.
create or replace function public.connectical_cancel_reservation(p_reservation_id uuid, p_reason text)
returns public.connectical_reservations
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_reservation public.connectical_reservations;
  v_is_traveler boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  v_is_traveler := v_reservation.traveler_user_id = auth.uid();
  if not v_is_traveler
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
  end if;
  if v_reservation.status in ('held', 'pending_payment', 'confirmed') then
    update public.connectical_reservations set status = 'cancelled', hold_expires_at = null,
      updated_at = now() where id = p_reservation_id returning * into v_reservation;
    insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
      values (v_reservation.id, auth.uid(), 'reservation_cancelled', jsonb_build_object('reason', p_reason));
  end if;
  return public.connectical_redact_reservation(v_reservation);
end;
$$;

-- Igual que en 202611140008, más el caso de intento anterior.
create or replace function public.connectical_system_ingest_payment_event(
  p_gateway text,
  p_event_id text,
  p_reservation_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_currency text,
  p_method text default null,
  p_gateway_reference text default null
)
returns public.connectical_payment_events
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_event public.connectical_payment_events;
  v_reservation public.connectical_reservations;
  v_outcome text;
  v_review boolean := false;
begin
  -- Reintento del mismo evento: devolver lo ya registrado sin tocar nada.
  select * into v_event from public.connectical_payment_events
    where gateway = p_gateway and event_id = p_event_id;
  if found then return v_event; end if;

  select * into v_reservation from public.connectical_reservations where id = p_reservation_id;
  if not found then
    v_outcome := 'unknown_reservation'; v_review := true;
  else
    perform public.connectical_lock_offer(v_reservation.offer_id);
    -- Un reintento concurrente del mismo evento puede haber entrado mientras se esperaba el lock.
    select * into v_event from public.connectical_payment_events
      where gateway = p_gateway and event_id = p_event_id;
    if found then return v_event; end if;
    select * into v_reservation from public.connectical_reservations where id = p_reservation_id for update;

    if p_currency is distinct from 'BRL' then
      v_outcome := 'currency_mismatch'; v_review := true;
    elsif p_kind = 'payment_approved' and p_amount_cents <> v_reservation.amount_cents then
      v_outcome := 'amount_mismatch'; v_review := true;
    elsif p_kind = 'payment_approved' then
      if v_reservation.status = 'confirmed' or v_reservation.status = 'refunded'
         or (v_reservation.status = 'cancelled' and v_reservation.payment_status = 'approved') then
        v_outcome := 'possible_double_charge'; v_review := true;
      elsif v_reservation.status in ('held', 'pending_payment') and v_reservation.hold_expires_at > now() then
        perform public.connectical_adjust_stay_inventory(
          v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
          -v_reservation.quantity, v_reservation.quantity);
        update public.connectical_reservations set status = 'confirmed', payment_status = 'approved',
          payment_method = p_method, payment_reference = p_gateway_reference,
          hold_expires_at = null, updated_at = now()
          where id = v_reservation.id;
        v_outcome := 'applied_confirmed';
      else
        -- Retención vencida o reserva cancelada sin cobro previo: hay dinero sin reserva.
        v_outcome := 'paid_without_reservation'; v_review := true;
      end if;
    elsif p_kind = 'payment_rejected' then
      -- Un rechazo de un intento anterior no cancela un intento más reciente con otra referencia.
      if v_reservation.status in ('held', 'pending_payment') and v_reservation.payment_reference is not null
         and p_gateway_reference is distinct from v_reservation.payment_reference then
        v_outcome := 'ignored_stale_attempt';
      elsif v_reservation.status in ('held', 'pending_payment') then
        perform public.connectical_adjust_stay_inventory(
          v_reservation.offer_id, v_reservation.service_date, v_reservation.nights,
          -v_reservation.quantity, 0);
        update public.connectical_reservations set status = 'cancelled', payment_status = 'rejected',
          payment_method = p_method, payment_reference = p_gateway_reference,
          hold_expires_at = null, updated_at = now()
          where id = v_reservation.id;
        v_outcome := 'applied_rejected';
      else
        v_outcome := 'ignored_not_pending';
      end if;
    else
      if v_reservation.status in ('held', 'pending_payment') then
        update public.connectical_reservations set status = 'pending_payment', payment_status = 'pending',
          payment_method = p_method, payment_reference = p_gateway_reference, updated_at = now()
          where id = v_reservation.id;
        v_outcome := 'applied_pending';
      else
        v_outcome := 'ignored_not_pending';
      end if;
    end if;

    if v_outcome like 'applied_%' then
      insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
        values (v_reservation.id, null, p_kind,
          jsonb_build_object('provider', p_gateway, 'event_id', p_event_id, 'reference', p_gateway_reference));
    end if;
  end if;

  insert into public.connectical_payment_events (
    gateway, event_id, reservation_id, kind, amount_cents, currency, method, gateway_reference, outcome, needs_review
  ) values (
    p_gateway, p_event_id, case when v_reservation.id is null then null else p_reservation_id end,
    p_kind, p_amount_cents, coalesce(p_currency, ''), p_method, p_gateway_reference, v_outcome, v_review
  )
  on conflict (gateway, event_id) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into v_event from public.connectical_payment_events where gateway = p_gateway and event_id = p_event_id;
  end if;
  return v_event;
end;
$$;
