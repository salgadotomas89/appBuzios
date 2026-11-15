-- Detalle de producto para el catálogo y límites de cantidad por reserva.
--
--   * Texto que carga el proveedor: descripción, ubicación, punto de encuentro y horario.
--   * min_quantity / max_quantity: personas, entradas, grupos o habitaciones por reserva.
--     connectical_create_quote rechaza cantidades fuera del rango (quantity_out_of_range).
--   * Las fotografías quedan fuera hasta confirmar el bucket de almacenamiento del tenant y contar
--     con imágenes autorizadas por cada proveedor.

alter table public.connectical_offers
  add column if not exists description text not null default '' check (char_length(description) <= 2000),
  add column if not exists location text not null default '' check (char_length(location) <= 160),
  add column if not exists meeting_point text not null default '' check (char_length(meeting_point) <= 160),
  add column if not exists schedule text not null default '' check (char_length(schedule) <= 160),
  add column if not exists min_quantity integer not null default 1 check (min_quantity between 1 and 500),
  add column if not exists max_quantity integer check (max_quantity between 1 and 500);

alter table public.connectical_offers drop constraint if exists connectical_offers_quantity_range_check;
alter table public.connectical_offers add constraint connectical_offers_quantity_range_check
  check (max_quantity is null or max_quantity >= min_quantity);

grant select (description, location, meeting_point, schedule, min_quantity, max_quantity)
  on public.connectical_offers to anon, authenticated;

create or replace function public.connectical_provider_set_offer_details(
  p_offer_id uuid,
  p_description text,
  p_location text,
  p_meeting_point text,
  p_schedule text,
  p_min_quantity integer,
  p_max_quantity integer
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() and not exists (
    select 1 from public.connectical_offers o
    join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid() and p.active
  ) then
    raise exception 'offer_not_owned' using errcode = '42501';
  end if;
  if p_description is null or char_length(btrim(p_description)) > 2000
     or p_location is null or char_length(btrim(p_location)) > 160
     or p_meeting_point is null or char_length(btrim(p_meeting_point)) > 160
     or p_schedule is null or char_length(btrim(p_schedule)) > 160
     or p_min_quantity is null or p_min_quantity not between 1 and 500
     or (p_max_quantity is not null and (p_max_quantity not between 1 and 500 or p_max_quantity < p_min_quantity)) then
    raise exception 'invalid_offer_details' using errcode = '22023';
  end if;
  update public.connectical_offers set
    description = btrim(p_description), location = btrim(p_location),
    meeting_point = btrim(p_meeting_point), schedule = btrim(p_schedule),
    min_quantity = p_min_quantity, max_quantity = p_max_quantity, updated_at = now()
    where id = p_offer_id;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  return p_offer_id;
end;
$$;

revoke all on function public.connectical_provider_set_offer_details(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.connectical_provider_set_offer_details(uuid, text, text, text, text, integer, integer) to authenticated;

-- Igual que en 202611140007, más los límites de cantidad por reserva del producto.
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
  return v_quote;
end;
$$;
