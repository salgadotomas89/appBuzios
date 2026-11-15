-- Operaciones de administración: moderación de ofertas, registro de actividad, incidencias,
-- usuarios, indicadores y campañas.
--
--   * Moderación: la administración suspende o reactiva ofertas; una suspendida desaparece del
--     catálogo, no se puede cotizar ni retener con una cotización anterior. Una reserva ya retenida o
--     confirmada no cambia: qué hacer con ella lo decide la administración. Exigir aprobación previa de cada oferta nueva es una decisión de
--     negocio: queda detrás de connectical_settings.offer_moderation_required (apagado por defecto).
--   * Registro de actividad: triggers sobre roles, proveedores, ofertas, reembolsos y solicitudes,
--     así ningún cambio administrativo escapa al registro aunque llegue por otra vía.
--   * Campañas: solo contenido (título, texto, fechas). NO aplican descuentos: cambiar precios o
--     comisiones requiere una decisión comercial aprobada.

-- Moderación de ofertas -------------------------------------------------------------------------

alter table public.connectical_offers
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('approved', 'pending', 'suspended')),
  add column if not exists moderation_note text not null default '' check (char_length(moderation_note) <= 500);

grant select (moderation_status) on public.connectical_offers to anon, authenticated;

insert into public.connectical_settings (key, value) values ('offer_moderation_required', 'false')
on conflict (key) do nothing;

create or replace function public.connectical_offer_moderation_guard()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if public.connectical_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.moderation_status := case
      when coalesce((select (value #>> '{}')::boolean from public.connectical_settings
                     where key = 'offer_moderation_required'), false) then 'pending'
      else 'approved' end;
    new.moderation_note := '';
  else
    -- Solo la administración cambia el estado de moderación.
    new.moderation_status := old.moderation_status;
    new.moderation_note := old.moderation_note;
  end if;
  return new;
end;
$$;
revoke all on function public.connectical_offer_moderation_guard() from public, anon, authenticated;

drop trigger if exists connectical_offer_moderation_guard on public.connectical_offers;
create trigger connectical_offer_moderation_guard
  before insert or update on public.connectical_offers
  for each row execute function public.connectical_offer_moderation_guard();

drop policy if exists connectical_offers_read on public.connectical_offers;
create policy connectical_offers_read on public.connectical_offers for select to anon, authenticated
  using ((published and moderation_status = 'approved') or public.connectical_is_admin() or exists (
    select 1 from public.connectical_providers p where p.id = provider_id and p.owner_user_id = auth.uid()
  ));

drop policy if exists connectical_inventory_read on public.connectical_inventory;
create policy connectical_inventory_read on public.connectical_inventory for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved')
    or public.connectical_is_admin() or exists (
      select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
      where o.id = offer_id and p.owner_user_id = auth.uid()
    ));

create or replace function public.connectical_admin_set_offer_moderation(p_offer_id uuid, p_status text, p_note text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_status not in ('approved', 'pending', 'suspended') or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_moderation' using errcode = '22023';
  end if;
  if p_status = 'suspended' and char_length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'review_note_required' using errcode = '22023';
  end if;
  update public.connectical_offers set moderation_status = p_status, moderation_note = btrim(coalesce(p_note, '')),
    updated_at = now() where id = p_offer_id;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  return p_status;
end;
$$;

create or replace function public.connectical_admin_list_offers_for_moderation()
returns table (offer_id uuid, title text, category text, provider_name text, published boolean,
               moderation_status text, moderation_note text, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select o.id, o.title, o.category, p.name, o.published, o.moderation_status, o.moderation_note, o.updated_at
    from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    order by (o.moderation_status = 'pending') desc, o.updated_at desc
    limit 500;
end;
$$;

-- Igual que en 202611140010, salvo que una oferta suspendida o pendiente no se puede cotizar.
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
    where id = p_offer_id and published = true and moderation_status = 'approved';
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

-- Igual que en 202611140010, salvo que se vuelve a comprobar la oferta y el proveedor: una
-- cotización emitida antes de suspender la oferta o pausar al proveedor ya no permite reservar.
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
  -- La cotización puede ser anterior a una suspensión, una despublicación o una pausa del proveedor.
  if not exists (select 1 from public.connectical_offers
                 where id = v_quote.offer_id and published and moderation_status = 'approved') then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
                 where o.id = v_quote.offer_id and p.active) then
    raise exception 'provider_inactive' using errcode = 'P0002';
  end if;
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

-- Registro de actividad administrativa ----------------------------------------------------------

create table if not exists public.connectical_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  target_table text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists connectical_admin_audit_log_created_idx on public.connectical_admin_audit_log (created_at desc);
alter table public.connectical_admin_audit_log enable row level security;
revoke all on table public.connectical_admin_audit_log from public, anon, authenticated;

-- actor nulo = cambio hecho desde el SQL Editor o por un proceso del sistema.
create or replace function public.connectical_audit_change()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_target text;
begin
  if tg_table_name = 'connectical_profiles' then
    if new.role is not distinct from old.role then return new; end if;
    v_action := 'role_changed'; v_target := new.user_id::text;
    v_details := jsonb_build_object('from', old.role, 'to', new.role);
  elsif tg_table_name = 'connectical_providers' and tg_op = 'INSERT' then
    v_action := 'provider_created'; v_target := new.id::text;
    v_details := jsonb_build_object('commission_rate_bps', new.commission_rate_bps, 'active', new.active);
  elsif tg_table_name = 'connectical_providers' then
    if new.active is not distinct from old.active and new.commission_rate_bps is not distinct from old.commission_rate_bps then
      return new;
    end if;
    v_action := 'provider_updated'; v_target := new.id::text;
    v_details := jsonb_build_object('active', jsonb_build_array(old.active, new.active),
      'commission_rate_bps', jsonb_build_array(old.commission_rate_bps, new.commission_rate_bps));
  elsif tg_table_name = 'connectical_offers' then
    if new.moderation_status is not distinct from old.moderation_status
       and new.commission_rate_bps is not distinct from old.commission_rate_bps then
      return new;
    end if;
    v_action := 'offer_terms_changed'; v_target := new.id::text;
    v_details := jsonb_build_object('moderation_status', jsonb_build_array(old.moderation_status, new.moderation_status),
      'commission_rate_bps', jsonb_build_array(old.commission_rate_bps, new.commission_rate_bps));
  elsif tg_table_name = 'connectical_refunds' then
    v_action := 'refund_recorded'; v_target := new.reservation_id::text;
    v_details := jsonb_build_object('amount_cents', new.amount_cents);
  elsif tg_table_name = 'connectical_provider_applications' then
    if new.status is not distinct from old.status then return new; end if;
    v_action := 'application_' || new.status; v_target := new.id::text;
    v_details := jsonb_build_object('provider_id', new.provider_id);
  else
    return new;
  end if;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), v_action, tg_table_name, v_target, v_details);
  return new;
end;
$$;
revoke all on function public.connectical_audit_change() from public, anon, authenticated;

drop trigger if exists connectical_audit_profiles on public.connectical_profiles;
create trigger connectical_audit_profiles after update on public.connectical_profiles
  for each row execute function public.connectical_audit_change();
drop trigger if exists connectical_audit_providers on public.connectical_providers;
create trigger connectical_audit_providers after insert or update on public.connectical_providers
  for each row execute function public.connectical_audit_change();
drop trigger if exists connectical_audit_offers on public.connectical_offers;
create trigger connectical_audit_offers after update on public.connectical_offers
  for each row execute function public.connectical_audit_change();
drop trigger if exists connectical_audit_refunds on public.connectical_refunds;
create trigger connectical_audit_refunds after insert on public.connectical_refunds
  for each row execute function public.connectical_audit_change();
drop trigger if exists connectical_audit_applications on public.connectical_provider_applications;
create trigger connectical_audit_applications after update on public.connectical_provider_applications
  for each row execute function public.connectical_audit_change();

create or replace function public.connectical_admin_list_audit_log(p_limit integer default 200)
returns setof public.connectical_admin_audit_log
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query select * from public.connectical_admin_audit_log
    order by created_at desc, id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- Incidencias ------------------------------------------------------------------------------------

create table if not exists public.connectical_incidents (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.connectical_reservations(id),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('payment', 'service', 'safety', 'access', 'other')),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists connectical_incidents_status_idx on public.connectical_incidents (status, created_at desc);
alter table public.connectical_incidents enable row level security;
revoke all on table public.connectical_incidents from public, anon, authenticated;

create or replace function public.connectical_report_incident(p_reservation_id uuid, p_category text, p_description text)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_reservation_id is not null and not public.connectical_can_read_reservation(p_reservation_id) then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  begin
    insert into public.connectical_incidents (reservation_id, reporter_user_id, category, description)
      values (p_reservation_id, auth.uid(), p_category, btrim(p_description))
      returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_incident' using errcode = '22023';
  end;
  return v_id;
end;
$$;

create or replace function public.connectical_my_incidents()
returns table (id uuid, reservation_id uuid, category text, description text, status text, admin_note text,
               created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query
    select i.id, i.reservation_id, i.category, i.description, i.status, i.admin_note, i.created_at, i.updated_at
    from public.connectical_incidents i where i.reporter_user_id = auth.uid()
    order by i.created_at desc limit 100;
end;
$$;

create or replace function public.connectical_admin_list_incidents(p_status text default null)
returns table (id uuid, reservation_id uuid, reporter_name text, category text, description text, status text,
               admin_note text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select i.id, i.reservation_id, coalesce(p.display_name, ''), i.category, i.description, i.status, i.admin_note,
           i.created_at, i.updated_at
    from public.connectical_incidents i
    left join public.connectical_profiles p on p.user_id = i.reporter_user_id
    where p_status is null or i.status = p_status
    order by (i.status = 'open') desc, i.created_at desc limit 500;
end;
$$;

create or replace function public.connectical_admin_update_incident(p_incident_id uuid, p_status text, p_note text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_status not in ('open', 'in_progress', 'resolved') or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'invalid_incident' using errcode = '22023';
  end if;
  update public.connectical_incidents set status = p_status, admin_note = btrim(coalesce(p_note, '')), updated_at = now()
    where id = p_incident_id;
  if not found then raise exception 'incident_not_found' using errcode = 'P0002'; end if;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'incident_' || p_status, 'connectical_incidents', p_incident_id::text, '{}'::jsonb);
  return p_status;
end;
$$;

-- Usuarios e indicadores -------------------------------------------------------------------------

-- Lectura para la administración. Los roles de administración siguen asignándose por SQL (PROVISIONING).
create or replace function public.connectical_admin_list_users(p_role text default null)
returns table (user_id uuid, display_name text, country_code text, role text, email text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select p.user_id, p.display_name, p.country_code, p.role, u.email::text, p.created_at
    from public.connectical_profiles p left join auth.users u on u.id = p.user_id
    where p_role is null or p.role = p_role
    order by p.created_at desc limit 500;
end;
$$;

-- Indicadores por fecha de creación en el calendario de Búzios. Ingresos solo de reservas confirmadas.
create or replace function public.connectical_admin_kpis(p_from date, p_to date)
returns table (quotes integer, reservations integer, confirmed integer, cancelled integer, expired integer,
               refunded integer, confirmed_gross_cents bigint, service_fee_cents bigint, commission_cents bigint,
               refunded_cents bigint, quote_to_confirmed_bps integer)
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_quotes integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  select count(*) into v_quotes from public.connectical_quotes q
    where (q.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to;
  return query
    select v_quotes,
      count(*)::integer,
      count(*) filter (where r.status = 'confirmed')::integer,
      count(*) filter (where r.status = 'cancelled')::integer,
      count(*) filter (where r.status = 'expired')::integer,
      count(*) filter (where r.status = 'refunded')::integer,
      coalesce(sum(r.amount_cents) filter (where r.status = 'confirmed'), 0)::bigint,
      coalesce(sum(r.service_fee_cents) filter (where r.status = 'confirmed'), 0)::bigint,
      coalesce(sum(r.provider_commission_cents) filter (where r.status = 'confirmed'), 0)::bigint,
      coalesce(sum(r.refund_cents), 0)::bigint,
      case when v_quotes = 0 then 0
           else (count(*) filter (where r.status = 'confirmed') * 10000 / v_quotes)::integer end
    from public.connectical_reservations r
    where (r.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to;
end;
$$;

-- Campañas de contenido (sin efecto en precios) ---------------------------------------------------

create table if not exists public.connectical_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  body text not null default '' check (char_length(body) <= 500),
  category text check (category in ('pousadas', 'barcos', 'noche', 'buggy', 'experiencias')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
alter table public.connectical_campaigns enable row level security;
revoke all on table public.connectical_campaigns from public, anon, authenticated;

create or replace function public.connectical_admin_save_campaign(
  p_campaign_id uuid, p_title text, p_body text, p_category text, p_starts_on date, p_ends_on date, p_status text
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  begin
    if p_campaign_id is null then
      insert into public.connectical_campaigns (title, body, category, starts_on, ends_on, status, created_by)
        values (btrim(p_title), btrim(coalesce(p_body, '')), p_category, p_starts_on, p_ends_on, p_status, auth.uid())
        returning id into v_id;
    else
      update public.connectical_campaigns set title = btrim(p_title), body = btrim(coalesce(p_body, '')),
        category = p_category, starts_on = p_starts_on, ends_on = p_ends_on, status = p_status, updated_at = now()
        where id = p_campaign_id returning id into v_id;
      if v_id is null then raise exception 'campaign_not_found' using errcode = 'P0002'; end if;
    end if;
  exception when check_violation or not_null_violation then
    raise exception 'invalid_campaign' using errcode = '22023';
  end;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'campaign_saved', 'connectical_campaigns', v_id::text, jsonb_build_object('status', p_status));
  return v_id;
end;
$$;

create or replace function public.connectical_admin_list_campaigns()
returns setof public.connectical_campaigns
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query select * from public.connectical_campaigns order by starts_on desc, created_at desc limit 200;
end;
$$;

-- Campañas visibles hoy en Búzios, para el catálogo (también sin sesión).
create or replace function public.connectical_active_campaigns()
returns table (id uuid, title text, body text, category text, starts_on date, ends_on date)
language sql stable security definer
set search_path = public, auth
as $$
  select c.id, c.title, c.body, c.category, c.starts_on, c.ends_on
  from public.connectical_campaigns c
  where c.status = 'active' and public.connectical_today() between c.starts_on and c.ends_on
  order by c.starts_on desc limit 20
$$;

revoke all on function public.connectical_admin_set_offer_moderation(uuid, text, text) from public, anon;
revoke all on function public.connectical_admin_list_offers_for_moderation() from public, anon;
revoke all on function public.connectical_admin_list_audit_log(integer) from public, anon;
revoke all on function public.connectical_report_incident(uuid, text, text) from public, anon;
revoke all on function public.connectical_my_incidents() from public, anon;
revoke all on function public.connectical_admin_list_incidents(text) from public, anon;
revoke all on function public.connectical_admin_update_incident(uuid, text, text) from public, anon;
revoke all on function public.connectical_admin_list_users(text) from public, anon;
revoke all on function public.connectical_admin_kpis(date, date) from public, anon;
revoke all on function public.connectical_admin_save_campaign(uuid, text, text, text, date, date, text) from public, anon;
revoke all on function public.connectical_admin_list_campaigns() from public, anon;
revoke all on function public.connectical_active_campaigns() from public;
grant execute on function public.connectical_admin_set_offer_moderation(uuid, text, text) to authenticated;
grant execute on function public.connectical_admin_list_offers_for_moderation() to authenticated;
grant execute on function public.connectical_admin_list_audit_log(integer) to authenticated;
grant execute on function public.connectical_report_incident(uuid, text, text) to authenticated;
grant execute on function public.connectical_my_incidents() to authenticated;
grant execute on function public.connectical_admin_list_incidents(text) to authenticated;
grant execute on function public.connectical_admin_update_incident(uuid, text, text) to authenticated;
grant execute on function public.connectical_admin_list_users(text) to authenticated;
grant execute on function public.connectical_admin_kpis(date, date) to authenticated;
grant execute on function public.connectical_admin_save_campaign(uuid, text, text, text, date, date, text) to authenticated;
grant execute on function public.connectical_admin_list_campaigns() to authenticated;
grant execute on function public.connectical_active_campaigns() to anon, authenticated;
