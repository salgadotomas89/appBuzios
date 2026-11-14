-- Registro de reembolsos simulados. No aplica ninguna política comercial: no calcula
-- plazos ni porcentajes. Un administrador registra el importe que decidió devolver y la
-- base de datos solo garantiza los invariantes financieros:
--   * solo se reembolsa una reserva con pago aprobado;
--   * la suma de reembolsos nunca supera lo cobrado (amount_cents);
--   * un reembolso total exige cancelar antes, para no dejar cupo vendido sin cobro;
--   * cada solicitud lleva una clave de idempotencia y reintentarla no duplica dinero; repetirla con
--     otro importe o motivo se rechaza.
-- No contacta ninguna pasarela de pago.

create table if not exists public.connectical_refunds (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.connectical_reservations(id),
  idempotency_key uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (reservation_id, idempotency_key)
);

create index if not exists connectical_refunds_reservation_idx
  on public.connectical_refunds (reservation_id, created_at);

alter table public.connectical_refunds enable row level security;

drop policy if exists connectical_refunds_read on public.connectical_refunds;
create policy connectical_refunds_read on public.connectical_refunds for select to authenticated
  using (
    public.connectical_is_admin()
    or exists (
      select 1 from public.connectical_reservations r
      where r.id = reservation_id
        and (r.traveler_user_id = auth.uid() or exists (
          select 1 from public.connectical_providers p
          where p.id = r.provider_id and p.owner_user_id = auth.uid()))
    )
  );

revoke all on table public.connectical_refunds from public, anon, authenticated;
grant select on table public.connectical_refunds to authenticated;

create or replace function public.connectical_admin_record_refund(
  p_reservation_id uuid,
  p_amount_cents integer,
  p_reason text,
  p_idempotency_key uuid
)
returns public.connectical_reservations
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_reservation public.connectical_reservations;
  v_existing public.connectical_refunds;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_idempotency_key is null
     or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'invalid_refund_input' using errcode = '22023';
  end if;

  select * into v_reservation from public.connectical_reservations
    where id = p_reservation_id for update;
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;

  select * into v_existing from public.connectical_refunds
    where reservation_id = p_reservation_id and idempotency_key = p_idempotency_key;
  if found then
    -- Una repetición debe ser idéntica; si cambia importe o motivo es otra solicitud con clave reutilizada.
    if v_existing.amount_cents <> p_amount_cents or v_existing.reason <> btrim(p_reason) then
      raise exception 'refund_idempotency_conflict' using errcode = '23505';
    end if;
    return v_reservation;
  end if;

  if v_reservation.payment_status is distinct from 'approved'
     or v_reservation.status not in ('confirmed', 'cancelled') then
    raise exception 'refund_not_allowed' using errcode = 'P0001';
  end if;
  if v_reservation.refund_cents + p_amount_cents > v_reservation.amount_cents then
    raise exception 'refund_exceeds_paid' using errcode = 'P0001';
  end if;
  if v_reservation.refund_cents + p_amount_cents = v_reservation.amount_cents
     and v_reservation.status = 'confirmed' then
    raise exception 'refund_requires_cancellation' using errcode = 'P0001';
  end if;

  insert into public.connectical_refunds (reservation_id, idempotency_key, amount_cents, reason, actor_user_id)
    values (p_reservation_id, p_idempotency_key, p_amount_cents, btrim(p_reason), auth.uid());

  update public.connectical_reservations
    set refund_cents = refund_cents + p_amount_cents,
        status = case when refund_cents + p_amount_cents = amount_cents then 'refunded' else status end,
        updated_at = now()
    where id = p_reservation_id
    returning * into v_reservation;

  insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
    values (v_reservation.id, auth.uid(), 'refund_recorded', jsonb_build_object(
      'amount_cents', p_amount_cents,
      'refund_total_cents', v_reservation.refund_cents,
      'reason', btrim(p_reason),
      'simulated', true));
  return v_reservation;
end;
$$;

revoke all on function public.connectical_admin_record_refund(uuid, integer, text, uuid) from public, anon;
grant execute on function public.connectical_admin_record_refund(uuid, integer, text, uuid) to authenticated;
