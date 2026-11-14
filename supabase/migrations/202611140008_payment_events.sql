-- Ingesta idempotente de eventos de pasarela (webhooks). Ninguna pasarela real está conectada.
--
-- Un manejador de webhooks de confianza (función edge con la clave de servicio) verifica la firma
-- de la pasarela y llama a connectical_system_ingest_payment_event. Esta función:
--   * registra cada evento una sola vez por (gateway, event_id): un reintento devuelve el resultado
--     original sin volver a aplicarlo;
--   * aplica solo eventos en BRL cuyo importe coincide exactamente con lo cotizado;
--   * nunca confirma dos veces: un segundo pago aprobado para una reserva ya confirmada queda como
--     posible doble cobro para revisión;
--   * un pago aprobado que llega con la reserva vencida o cancelada no la revive: queda como cobro
--     sin reserva, que la administración debe devolver;
--   * todo lo que no se aplica queda con needs_review = true y un motivo.
-- No es accesible para anon ni authenticated. La administración consulta las revisiones por RPC.

create table if not exists public.connectical_payment_events (
  id bigint generated always as identity primary key,
  gateway text not null check (gateway ~ '^[a-z0-9_]{2,40}$'),
  event_id text not null check (char_length(event_id) between 1 and 200),
  reservation_id uuid references public.connectical_reservations(id),
  kind text not null check (kind in ('payment_approved', 'payment_rejected', 'payment_pending')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  method text check (method in ('card', 'pix')),
  gateway_reference text,
  outcome text not null,
  needs_review boolean not null default false,
  received_at timestamptz not null default now(),
  unique (gateway, event_id)
);

create index if not exists connectical_payment_events_review_idx
  on public.connectical_payment_events (received_at desc) where needs_review;
create index if not exists connectical_payment_events_reservation_idx
  on public.connectical_payment_events (reservation_id);

alter table public.connectical_payment_events enable row level security;
revoke all on table public.connectical_payment_events from public, anon, authenticated;

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
      if v_reservation.status in ('held', 'pending_payment') then
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

revoke all on function public.connectical_system_ingest_payment_event(text, text, uuid, text, integer, text, text, text)
  from public, anon, authenticated;

create or replace function public.connectical_admin_list_payment_reviews(p_limit integer default 100)
returns setof public.connectical_payment_events
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select * from public.connectical_payment_events
    where needs_review
    order by received_at desc, id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.connectical_admin_list_payment_reviews(integer) from public, anon;
grant execute on function public.connectical_admin_list_payment_reviews(integer) to authenticated;
