-- Oculta identificadores internos de Auth a quien no los necesita.
--
-- Antes de esta migración, turistas y proveedores podían leer:
--   * connectical_reservation_events.actor_user_id: el uuid de quien actuó, incluido el administrador;
--   * connectical_refunds.actor_user_id e idempotency_key: el uuid del administrador y su clave;
--   * connectical_reservations.traveler_user_id e idempotency_key: el proveedor veía el uuid del turista,
--     también en la fila que devuelve connectical_cancel_reservation cuando cancela él.
--
-- Los datos siguen guardados para auditoría. Lo que cambia es qué columnas puede leer el rol
-- authenticated: los privilegios por columna excluyen esos campos (las políticas RLS siguen usándolos
-- para filtrar filas, porque las expresiones de política no exigen privilegio sobre la columna).
-- La administración consulta la autoría con connectical_admin_list_reservation_events.
-- Consecuencia para clientes: `select *` sobre estas tablas falla; hay que pedir columnas explícitas.

revoke select on table public.connectical_reservations from authenticated, anon;
grant select (
  id, quote_id, offer_id, provider_id, service_date, nights, quantity, status, hold_expires_at,
  amount_cents, service_fee_rate_bps, service_fee_cents, provider_commission_rate_bps,
  provider_commission_cents, connectical_margin_cents, quote_version, payment_status, payment_method,
  payment_reference, refund_cents, created_at, updated_at
) on public.connectical_reservations to authenticated;

revoke select on table public.connectical_reservation_events from authenticated, anon;
grant select (id, reservation_id, event_type, details, created_at)
  on public.connectical_reservation_events to authenticated;

revoke select on table public.connectical_refunds from authenticated, anon;
grant select (id, reservation_id, amount_cents, reason, created_at)
  on public.connectical_refunds to authenticated;

-- Las políticas de eventos y reembolsos comprobaban el acceso con una subconsulta sobre
-- connectical_reservations.traveler_user_id. Una subconsulta a otra tabla sí exige privilegio de
-- columna, así que pasan a usar este helper, que solo responde si quien consulta puede ver la reserva.
create or replace function public.connectical_can_read_reservation(p_reservation_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.connectical_is_admin() or exists (
    select 1 from public.connectical_reservations r
    where r.id = p_reservation_id
      and (r.traveler_user_id = auth.uid() or exists (
        select 1 from public.connectical_providers p
        where p.id = r.provider_id and p.owner_user_id = auth.uid())))
$$;

revoke all on function public.connectical_can_read_reservation(uuid) from public, anon;
grant execute on function public.connectical_can_read_reservation(uuid) to authenticated;

drop policy if exists connectical_events_read on public.connectical_reservation_events;
create policy connectical_events_read on public.connectical_reservation_events for select to authenticated
  using (public.connectical_can_read_reservation(reservation_id));

drop policy if exists connectical_refunds_read on public.connectical_refunds;
create policy connectical_refunds_read on public.connectical_refunds for select to authenticated
  using (public.connectical_can_read_reservation(reservation_id));

-- Igual que en 202611140001, salvo que la fila devuelta no lleva el uuid ni la clave del turista
-- cuando quien cancela es el proveedor.
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
  if not v_is_traveler and not public.connectical_is_admin() then
    v_reservation.traveler_user_id := null;
    v_reservation.idempotency_key := null;
  end if;
  return v_reservation;
end;
$$;

-- Auditoría completa, incluida la autoría, solo para administración.
create or replace function public.connectical_admin_list_reservation_events(
  p_reservation_id uuid default null,
  p_limit integer default 200
)
returns table (
  id bigint,
  reservation_id uuid,
  actor_user_id uuid,
  event_type text,
  details jsonb,
  created_at timestamptz
)
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select e.id, e.reservation_id, e.actor_user_id, e.event_type, e.details, e.created_at
    from public.connectical_reservation_events e
    where p_reservation_id is null or e.reservation_id = p_reservation_id
    order by e.created_at desc, e.id desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.connectical_admin_list_reservation_events(uuid, integer) from public, anon;
grant execute on function public.connectical_admin_list_reservation_events(uuid, integer) to authenticated;
