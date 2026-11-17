-- Catálogo y comercio. Preparada y probada en local; NO aplicada en ningún tenant.
--
--   1. Categorías como datos (connectical_categories) en lugar de listas fijas en cada CHECK y función.
--      Se suman 'restaurantes' y 'actividades'. Las tablas que validaban la categoría pasan a una FK.
--   2. Promociones por oferta (connectical_offer_promotions): porcentaje de descuento en un rango de
--      fechas de servicio, sin solapes por oferta. Las crea el proveedor dueño (activo) o la administración.
--      La cotización aplica la promoción vigente en la fecha de inicio del servicio y congela el precio de
--      lista, el descuento y la promoción usada. Quien financia el descuento es el proveedor: la comisión y
--      el cargo al turista se calculan sobre el subtotal ya descontado.
--   3. Comisión por categoría de cada proveedor (connectical_provider_category_rates), solo administración.
--      Orden de resolución: producto > proveedor+categoría > proveedor. La cotización guarda qué nivel se
--      aplicó (provider_commission_source) para trazabilidad; el turista nunca lo recibe.
--   Ninguna tasa ni promoción queda sembrada: siguen siendo decisiones comerciales.

-- 1. Categorías -----------------------------------------------------------------------------------------
create table if not exists public.connectical_categories (
  id text primary key check (id ~ '^[a-z][a-z_]{1,30}$'),
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.connectical_categories (id, sort_order) values
  ('pousadas', 10), ('barcos', 20), ('noche', 30), ('buggy', 40), ('experiencias', 50),
  ('restaurantes', 60), ('actividades', 70)
on conflict (id) do nothing;

alter table public.connectical_categories enable row level security;
revoke all on table public.connectical_categories from public, anon, authenticated;
grant select on public.connectical_categories to anon, authenticated;
drop policy if exists connectical_categories_read on public.connectical_categories;
create policy connectical_categories_read on public.connectical_categories for select to anon, authenticated
  using (active or public.connectical_is_admin());

create or replace function public.connectical_is_category(p_category text)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select p_category is not null and exists (
    select 1 from public.connectical_categories where id = p_category and active)
$$;
revoke all on function public.connectical_is_category(text) from public;
grant execute on function public.connectical_is_category(text) to anon, authenticated;

alter table public.connectical_offers drop constraint if exists connectical_offers_category_check;
alter table public.connectical_offers drop constraint if exists connectical_offers_category_fkey;
alter table public.connectical_offers add constraint connectical_offers_category_fkey
  foreign key (category) references public.connectical_categories (id);

alter table public.connectical_provider_applications
  drop constraint if exists connectical_provider_applications_category_check;
alter table public.connectical_provider_applications
  drop constraint if exists connectical_provider_applications_category_fkey;
alter table public.connectical_provider_applications add constraint connectical_provider_applications_category_fkey
  foreign key (category) references public.connectical_categories (id);

alter table public.connectical_campaigns drop constraint if exists connectical_campaigns_category_check;
alter table public.connectical_campaigns drop constraint if exists connectical_campaigns_category_fkey;
alter table public.connectical_campaigns add constraint connectical_campaigns_category_fkey
  foreign key (category) references public.connectical_categories (id);

alter table public.connectical_commission_references
  drop constraint if exists connectical_commission_references_category_check;
alter table public.connectical_commission_references
  drop constraint if exists connectical_commission_references_category_fkey;
alter table public.connectical_commission_references add constraint connectical_commission_references_category_fkey
  foreign key (category) references public.connectical_categories (id);
insert into public.connectical_commission_references (category, min_rate_bps, max_rate_bps, note) values
  ('restaurantes', null, null, 'Pendiente de definición comercial'),
  ('actividades', null, null, 'Pendiente de definición comercial')
on conflict (category) do nothing;

create index if not exists connectical_offers_category_idx on public.connectical_offers (category);
create index if not exists connectical_provider_applications_category_idx
  on public.connectical_provider_applications (category);
create index if not exists connectical_campaigns_category_idx on public.connectical_campaigns (category);

-- Igual que en 202611140007, salvo que la categoría se valida contra connectical_categories.
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
  if not public.connectical_is_category(p_category)
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
  -- El proveedor no debe recibir la comisión que la administración fijó para su producto.
  if not public.connectical_is_admin() then v_offer.commission_rate_bps := null; end if;
  return v_offer;
end;
$$;

-- 2. Promociones --------------------------------------------------------------------------------------
create table if not exists public.connectical_offer_promotions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.connectical_offers (id) on delete cascade,
  percent_off_bps integer not null check (percent_off_bps between 100 and 9000),
  starts_on date not null,
  ends_on date not null,
  label text not null default '' check (length(label) <= 60),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366)
);
create index if not exists connectical_offer_promotions_offer_idx
  on public.connectical_offer_promotions (offer_id, starts_on);

alter table public.connectical_offer_promotions enable row level security;
revoke all on table public.connectical_offer_promotions from public, anon, authenticated;

-- Escritura solo por RPC. p_promotion_id nulo crea; con id edita (incluido desactivar con p_active = false).
create or replace function public.connectical_provider_save_promotion(
  p_promotion_id uuid,
  p_offer_id uuid,
  p_percent_off_bps integer,
  p_starts_on date,
  p_ends_on date,
  p_label text,
  p_active boolean
)
returns public.connectical_offer_promotions
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_promotion public.connectical_offer_promotions;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid() and p.active
  ) then
    raise exception 'offer_not_owned' using errcode = '42501';
  end if;
  if p_percent_off_bps is null or p_percent_off_bps not between 100 and 9000
     or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 366 or length(v_label) > 60 or p_active is null then
    raise exception 'invalid_promotion' using errcode = '22023';
  end if;
  if p_active and p_ends_on < public.connectical_today() then
    raise exception 'invalid_promotion' using errcode = '22023';
  end if;
  -- Serializa con las cotizaciones y con otras promociones de la misma oferta.
  perform public.connectical_lock_offer(p_offer_id);
  if p_active and exists (
    select 1 from public.connectical_offer_promotions
    where offer_id = p_offer_id and active and id is distinct from p_promotion_id
      and starts_on <= p_ends_on and ends_on >= p_starts_on
  ) then
    raise exception 'promotion_overlap' using errcode = '23P01';
  end if;
  if p_promotion_id is null then
    insert into public.connectical_offer_promotions
      (offer_id, percent_off_bps, starts_on, ends_on, label, active, created_by)
      values (p_offer_id, p_percent_off_bps, p_starts_on, p_ends_on, v_label, p_active, auth.uid())
      returning * into v_promotion;
  else
    update public.connectical_offer_promotions set percent_off_bps = p_percent_off_bps,
      starts_on = p_starts_on, ends_on = p_ends_on, label = v_label, active = p_active, updated_at = now()
      where id = p_promotion_id and offer_id = p_offer_id
      returning * into v_promotion;
    if not found then raise exception 'promotion_not_found' using errcode = 'P0002'; end if;
  end if;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'promotion_saved', 'connectical_offer_promotions', v_promotion.id::text,
      jsonb_build_object('offer_id', p_offer_id, 'percent_off_bps', p_percent_off_bps,
        'starts_on', p_starts_on, 'ends_on', p_ends_on, 'active', p_active));
  return v_promotion;
end;
$$;
revoke all on function public.connectical_provider_save_promotion(uuid, uuid, integer, date, date, text, boolean)
  from public, anon;
grant execute on function public.connectical_provider_save_promotion(uuid, uuid, integer, date, date, text, boolean)
  to authenticated;

-- Promociones de una oferta para su dueño o la administración (incluye inactivas y pasadas).
create or replace function public.connectical_provider_list_promotions(p_offer_id uuid)
returns setof public.connectical_offer_promotions
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() and not public.connectical_owns_offer(p_offer_id) then
    raise exception 'offer_not_owned' using errcode = '42501';
  end if;
  return query select * from public.connectical_offer_promotions
    where offer_id = p_offer_id order by starts_on desc limit 100;
end;
$$;
revoke all on function public.connectical_provider_list_promotions(uuid) from public, anon;
grant execute on function public.connectical_provider_list_promotions(uuid) to authenticated;

-- Catálogo público: promociones activas que no han terminado, solo de ofertas visibles. Sin autoría.
create or replace function public.connectical_list_active_promotions()
returns table (offer_id uuid, percent_off_bps integer, starts_on date, ends_on date, label text)
language sql stable security definer
set search_path = public, auth
as $$
  select pr.offer_id, pr.percent_off_bps, pr.starts_on, pr.ends_on, pr.label
  from public.connectical_offer_promotions pr
  join public.connectical_offers o on o.id = pr.offer_id
  join public.connectical_providers p on p.id = o.provider_id
  where pr.active and pr.ends_on >= public.connectical_today()
    and o.published and o.moderation_status = 'approved' and p.active
  order by pr.offer_id, pr.starts_on
  limit 1000
$$;
revoke all on function public.connectical_list_active_promotions() from public;
grant execute on function public.connectical_list_active_promotions() to anon, authenticated;

-- 3. Comisión por categoría de proveedor ---------------------------------------------------------------
create table if not exists public.connectical_provider_category_rates (
  provider_id uuid not null references public.connectical_providers (id) on delete cascade,
  category text not null references public.connectical_categories (id),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (provider_id, category)
);
create index if not exists connectical_provider_category_rates_category_idx
  on public.connectical_provider_category_rates (category);
alter table public.connectical_provider_category_rates enable row level security;
revoke all on table public.connectical_provider_category_rates from public, anon, authenticated;

-- p_rate_bps nulo elimina la tasa de la categoría (vuelve a la del proveedor).
create or replace function public.connectical_admin_set_provider_category_rate(
  p_provider_id uuid, p_category text, p_rate_bps integer
)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_previous integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.connectical_providers where id = p_provider_id) then
    raise exception 'provider_not_found' using errcode = 'P0002';
  end if;
  if not public.connectical_is_category(p_category)
     or (p_rate_bps is not null and p_rate_bps not between 0 and 10000) then
    raise exception 'invalid_commission_rate' using errcode = '22023';
  end if;
  select rate_bps into v_previous from public.connectical_provider_category_rates
    where provider_id = p_provider_id and category = p_category;
  if p_rate_bps is null then
    delete from public.connectical_provider_category_rates
      where provider_id = p_provider_id and category = p_category;
  else
    insert into public.connectical_provider_category_rates (provider_id, category, rate_bps, updated_by)
      values (p_provider_id, p_category, p_rate_bps, auth.uid())
      on conflict (provider_id, category)
      do update set rate_bps = excluded.rate_bps, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'category_rate_set', 'connectical_provider_category_rates', p_provider_id::text,
      jsonb_build_object('category', p_category, 'rate_bps', jsonb_build_array(v_previous, p_rate_bps)));
end;
$$;
revoke all on function public.connectical_admin_set_provider_category_rate(uuid, text, integer) from public, anon;
grant execute on function public.connectical_admin_set_provider_category_rate(uuid, text, integer) to authenticated;

create or replace function public.connectical_admin_list_provider_category_rates(p_provider_id uuid)
returns setof public.connectical_provider_category_rates
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query select * from public.connectical_provider_category_rates
    where provider_id = p_provider_id order by category;
end;
$$;
revoke all on function public.connectical_admin_list_provider_category_rates(uuid) from public, anon;
grant execute on function public.connectical_admin_list_provider_category_rates(uuid) to authenticated;

-- 4. Cotización con descuento y origen de la comisión --------------------------------------------------
alter table public.connectical_quotes add column if not exists list_subtotal_cents integer;
alter table public.connectical_quotes add column if not exists discount_cents integer not null default 0
  check (discount_cents >= 0);
alter table public.connectical_quotes add column if not exists promotion_id uuid
  references public.connectical_offer_promotions (id) on delete set null;
alter table public.connectical_quotes add column if not exists provider_commission_source text
  check (provider_commission_source in ('offer', 'provider_category', 'provider'));
update public.connectical_quotes set list_subtotal_cents = subtotal_cents where list_subtotal_cents is null;
create index if not exists connectical_quotes_promotion_idx on public.connectical_quotes (promotion_id);

-- El turista lee su propio precio de lista, descuento y promoción; nunca el origen de la comisión.
grant select (list_subtotal_cents, discount_cents, promotion_id) on public.connectical_quotes to authenticated;

-- Igual que en 202611150002, más la promoción vigente y la resolución de comisión en tres niveles.
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
  v_source text;
  v_category_rate integer;
  v_promotion public.connectical_offer_promotions;
  v_list numeric;
  v_discount numeric := 0;
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

  select rate_bps into v_category_rate from public.connectical_provider_category_rates
    where provider_id = v_provider.id and category = v_offer.category;
  if v_offer.commission_rate_bps is not null then
    v_rate := v_offer.commission_rate_bps; v_source := 'offer';
  elsif v_category_rate is not null then
    v_rate := v_category_rate; v_source := 'provider_category';
  else
    v_rate := v_provider.commission_rate_bps; v_source := 'provider';
  end if;

  -- Sin solapes por oferta (lo garantiza save_promotion), así que hay como mucho una vigente.
  select * into v_promotion from public.connectical_offer_promotions
    where offer_id = v_offer.id and active and p_service_date between starts_on and ends_on
    order by starts_on desc limit 1;

  v_list := v_offer.base_price_cents::numeric * p_quantity::numeric * p_nights::numeric;
  if v_promotion.id is not null then
    v_discount := round(v_list * v_promotion.percent_off_bps::numeric / 10000);
  end if;
  v_subtotal := v_list - v_discount;
  v_fee := round(v_subtotal * p_service_fee_rate_bps::numeric / 10000);
  v_commission := round(v_subtotal * v_rate::numeric / 10000);
  if v_list > 2147483647
     or v_fee > 2147483647
     or v_commission > 2147483647
     or v_subtotal + v_fee > 2147483647 then
    raise exception 'quote_amount_out_of_range' using errcode = '22003';
  end if;
  insert into public.connectical_quotes (
    traveler_user_id, offer_id, service_date, quantity, nights,
    subtotal_cents, service_fee_rate_bps, service_fee_cents, traveler_total_cents,
    provider_commission_rate_bps, provider_commission_cents, quote_version,
    list_subtotal_cents, discount_cents, promotion_id, provider_commission_source
  ) values (
    auth.uid(), v_offer.id, p_service_date, p_quantity, p_nights,
    v_subtotal::integer, p_service_fee_rate_bps, v_fee::integer, (v_subtotal + v_fee)::integer,
    v_rate,
    v_commission::integer,
    case when v_promotion.id is null then 'connectical-brl-v1' else 'connectical-brl-v2-promo' end,
    v_list::integer, v_discount::integer, v_promotion.id, v_source
  ) returning * into v_quote;
  -- Quien cotiza es el turista: la comisión es un acuerdo entre proveedor y plataforma.
  if not public.connectical_is_admin() then
    v_quote.provider_commission_rate_bps := null;
    v_quote.provider_commission_cents := null;
    v_quote.provider_commission_source := null;
  end if;
  return v_quote;
end;
$$;
