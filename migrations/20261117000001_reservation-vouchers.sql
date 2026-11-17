-- Comprobantes de reserva y check-in. Preparada y probada en local; NO aplicada en ningún tenant.
--
--   * Al confirmarse una reserva (por cualquier camino: pago simulado, webhook o SQL) un disparador le asigna un
--     código de comprobante único, legible y sin caracteres ambiguos: BZ-XXXX-XXXX (31^8 combinaciones).
--   * El código lo ven el turista dueño y la administración. El proveedor NO lo recibe en sus lecturas: lo escribe
--     cuando el turista se lo muestra, así el check-in prueba que el turista se presentó.
--   * connectical_provider_check_in(código): dueño del proveedor (activo) o administración; solo reservas
--     confirmadas, una vez, y desde la víspera hasta el último día del servicio (fecha de Búzios). Devuelve un estado
--     en lugar de lanzar error para que los intentos fallidos queden registrados: 20 fallos por usuario y hora como
--     máximo, contra la adivinación de códigos.

alter table public.connectical_reservations add column if not exists voucher_code text;
alter table public.connectical_reservations add column if not exists checked_in_at timestamptz;
alter table public.connectical_reservations add column if not exists checked_in_by uuid;
create unique index if not exists connectical_reservations_voucher_code_key
  on public.connectical_reservations (voucher_code) where voucher_code is not null;

create or replace function public.connectical_new_voucher_code()
returns text
language plpgsql volatile
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    -- uuid v4: 122 bits aleatorios del generador del servidor; se toman 8 bytes.
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := 'BZ-';
    for i in 0..7 loop
      if i = 4 then v_code := v_code || '-'; end if;
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.connectical_reservations where voucher_code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function public.connectical_new_voucher_code() from public, anon, authenticated;

create or replace function public.connectical_issue_voucher()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if new.status = 'confirmed' and new.voucher_code is null then
    new.voucher_code := public.connectical_new_voucher_code();
  end if;
  return new;
end;
$$;
revoke all on function public.connectical_issue_voucher() from public, anon, authenticated;

drop trigger if exists connectical_reservations_issue_voucher on public.connectical_reservations;
create trigger connectical_reservations_issue_voucher
  before insert or update of status on public.connectical_reservations
  for each row execute function public.connectical_issue_voucher();

-- Reservas ya confirmadas antes de esta migración.
update public.connectical_reservations set voucher_code = public.connectical_new_voucher_code()
  where status = 'confirmed' and voucher_code is null;

-- Igual que en 202611140010, y además el código del comprobante solo para el turista dueño.
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
    v_result.voucher_code := null;
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

create table if not exists public.connectical_voucher_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists connectical_voucher_attempts_user_idx
  on public.connectical_voucher_attempts (user_id, created_at desc);
alter table public.connectical_voucher_attempts enable row level security;
revoke all on table public.connectical_voucher_attempts from public, anon, authenticated;

-- Resultado: {"status": "...", "reservation": {...}}. status: checked_in, already_checked_in (con la hora del
-- primero), not_found, not_confirmed, outside_dates o too_many_attempts. La reserva solo viaja si el código es de
-- una reserva propia del proveedor (o es la administración), redactada como en cualquier otra lectura.
create or replace function public.connectical_provider_check_in(p_voucher_code text)
returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_voucher_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_reservation public.connectical_reservations;
  v_nights integer;
  v_status text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_providers where owner_user_id = auth.uid() and active
  ) then
    raise exception 'provider_not_authorized' using errcode = '42501';
  end if;
  if (select count(*) from public.connectical_voucher_attempts
      where user_id = auth.uid() and not succeeded and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;
  -- Admite el código con o sin guiones y en minúsculas: BZ-ABCD-EFGH, bzabcdefgh.
  if v_code ~ '^BZ[0-9A-Z]{8}$' then
    v_code := 'BZ-' || substr(v_code, 3, 4) || '-' || substr(v_code, 7, 4);
    select r.* into v_reservation from public.connectical_reservations r
      where r.voucher_code = v_code
        and (public.connectical_is_admin() or exists (
          select 1 from public.connectical_providers p where p.id = r.provider_id and p.owner_user_id = auth.uid()))
      for update;
  end if;
  if v_reservation.id is null then
    insert into public.connectical_voucher_attempts (user_id, succeeded) values (auth.uid(), false);
    return jsonb_build_object('status', 'not_found');
  end if;
  v_nights := greatest(coalesce(v_reservation.nights, 1), 1);
  if v_reservation.status <> 'confirmed' then
    v_status := 'not_confirmed';
  elsif v_reservation.checked_in_at is not null then
    v_status := 'already_checked_in';
  elsif public.connectical_today() < v_reservation.service_date - 1
     or public.connectical_today() > v_reservation.service_date + v_nights - 1 then
    v_status := 'outside_dates';
  else
    update public.connectical_reservations set checked_in_at = now(), checked_in_by = auth.uid(), updated_at = now()
      where id = v_reservation.id returning * into v_reservation;
    insert into public.connectical_reservation_events (reservation_id, actor_user_id, event_type, details)
      values (v_reservation.id, auth.uid(), 'checked_in', '{}'::jsonb);
    v_status := 'checked_in';
  end if;
  insert into public.connectical_voucher_attempts (user_id, succeeded) values (auth.uid(), v_status = 'checked_in');
  return jsonb_build_object('status', v_status,
    'reservation', to_jsonb(public.connectical_redact_reservation(v_reservation)));
end;
$$;
revoke all on function public.connectical_provider_check_in(text) from public, anon;
grant execute on function public.connectical_provider_check_in(text) to authenticated;

-- Retención: los intentos solo sirven para el límite por hora; se purgan los de más de 30 días al registrar.
create or replace function public.connectical_prune_voucher_attempts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.connectical_voucher_attempts where created_at < now() - interval '30 days';
  return null;
end;
$$;
revoke all on function public.connectical_prune_voucher_attempts() from public, anon, authenticated;
drop trigger if exists connectical_voucher_attempts_prune on public.connectical_voucher_attempts;
create trigger connectical_voucher_attempts_prune
  after insert on public.connectical_voucher_attempts
  for each statement execute function public.connectical_prune_voucher_attempts();
