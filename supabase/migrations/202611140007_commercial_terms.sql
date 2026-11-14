-- Términos comerciales configurables. Ninguna tasa queda aprobada por esta migración.
--
--   * Categoría nueva 'experiencias' (experiencias privadas y VIP).
--   * Comisión por producto: connectical_offers.commission_rate_bps (nula = usa la del proveedor, que
--     funciona como su contrato). Solo la administración la fija; create_quote congela la tasa
--     efectiva en la cotización, así que cambiarla no altera reservas ya cotizadas.
--   * La comisión por producto es información B2B: anon, turistas y proveedores no pueden leerla.
--   * connectical_commission_references guarda las referencias por categoría con estado
--     'reference' (propuesta) o 'approved'. Se siembran como 'reference'; Buggy queda sin valor.

alter table public.connectical_offers drop constraint if exists connectical_offers_category_check;
alter table public.connectical_offers add constraint connectical_offers_category_check
  check (category in ('pousadas', 'barcos', 'noche', 'buggy', 'experiencias'));

alter table public.connectical_offers
  add column if not exists commission_rate_bps integer check (commission_rate_bps between 0 and 10000);

revoke select on table public.connectical_offers from anon, authenticated;
grant select (id, provider_id, category, title, base_price_cents, price_mode, currency, published,
              created_at, updated_at)
  on public.connectical_offers to anon, authenticated;

create table if not exists public.connectical_commission_references (
  category text primary key check (category in ('pousadas', 'barcos', 'noche', 'buggy', 'experiencias')),
  min_rate_bps integer check (min_rate_bps between 0 and 10000),
  max_rate_bps integer check (max_rate_bps between 0 and 10000),
  status text not null default 'reference' check (status in ('reference', 'approved')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  check (min_rate_bps is null or max_rate_bps is null or min_rate_bps <= max_rate_bps)
);

insert into public.connectical_commission_references (category, min_rate_bps, max_rate_bps, note) values
  ('pousadas', 1000, 1000, 'Referencia comercial previa; no aprobada'),
  ('barcos', 1800, 1800, 'Referencia comercial previa; no aprobada'),
  ('noche', 1500, 1500, 'Discotecas y eventos; referencia previa; no aprobada'),
  ('experiencias', 1800, 2000, 'Experiencias privadas y VIP; rango de referencia; no aprobado'),
  ('buggy', null, null, 'Pendiente de definición comercial')
on conflict (category) do nothing;

alter table public.connectical_commission_references enable row level security;
revoke all on table public.connectical_commission_references from public, anon, authenticated;

-- Igual que en 202611140001, con la categoría nueva.
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
  if p_category is null or p_category not in ('pousadas', 'barcos', 'noche', 'buggy', 'experiencias')
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

-- Igual que en 202611140001, salvo que la comisión efectiva es la del producto si existe.
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
  return v_quote;
end;
$$;

create or replace function public.connectical_admin_set_provider_commission(p_provider_id uuid, p_rate_bps integer)
returns public.connectical_providers
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_provider public.connectical_providers;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_rate_bps is null or p_rate_bps not between 0 and 10000 then
    raise exception 'invalid_commission_rate' using errcode = '22023';
  end if;
  update public.connectical_providers set commission_rate_bps = p_rate_bps, updated_at = now()
    where id = p_provider_id returning * into v_provider;
  if not found then raise exception 'provider_not_found' using errcode = 'P0002'; end if;
  return v_provider;
end;
$$;

-- p_rate_bps nulo quita la excepción del producto y vuelve a la tasa del proveedor.
create or replace function public.connectical_admin_set_offer_commission(p_offer_id uuid, p_rate_bps integer)
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_rate_bps is not null and p_rate_bps not between 0 and 10000 then
    raise exception 'invalid_commission_rate' using errcode = '22023';
  end if;
  update public.connectical_offers set commission_rate_bps = p_rate_bps, updated_at = now()
    where id = p_offer_id;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  return p_rate_bps;
end;
$$;

-- Tasas efectivas por producto frente a la referencia de su categoría, para el panel admin.
create or replace function public.connectical_admin_list_commission_terms()
returns table (
  offer_id uuid,
  offer_title text,
  category text,
  provider_name text,
  provider_rate_bps integer,
  offer_rate_bps integer,
  effective_rate_bps integer,
  reference_min_bps integer,
  reference_max_bps integer,
  reference_status text,
  outside_reference boolean
)
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select o.id, o.title, o.category, p.name, p.commission_rate_bps, o.commission_rate_bps,
           coalesce(o.commission_rate_bps, p.commission_rate_bps),
           r.min_rate_bps, r.max_rate_bps, coalesce(r.status, 'reference'),
           r.min_rate_bps is not null and coalesce(o.commission_rate_bps, p.commission_rate_bps)
             not between r.min_rate_bps and coalesce(r.max_rate_bps, r.min_rate_bps)
    from public.connectical_offers o
    join public.connectical_providers p on p.id = o.provider_id
    left join public.connectical_commission_references r on r.category = o.category
    order by p.name, o.title;
end;
$$;

revoke all on function public.connectical_admin_set_provider_commission(uuid, integer) from public, anon;
revoke all on function public.connectical_admin_set_offer_commission(uuid, integer) from public, anon;
revoke all on function public.connectical_admin_list_commission_terms() from public, anon;
grant execute on function public.connectical_admin_set_provider_commission(uuid, integer) to authenticated;
grant execute on function public.connectical_admin_set_offer_commission(uuid, integer) to authenticated;
grant execute on function public.connectical_admin_list_commission_terms() to authenticated;
