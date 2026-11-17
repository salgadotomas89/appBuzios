-- Estadísticas del proveedor por oferta. Preparada y probada en local; NO aplicada en ningún tenant.
--
-- Solo lectura y solo sobre las ofertas del proveedor de quien llama (activo o pausado: un proveedor pausado
-- puede seguir viendo su historial). Periodo por fecha de creación en hora de Búzios, como connectical_admin_kpis.
-- Sin datos del turista: solo recuentos e importes. Importes en centavos BRL:
--   gross   = lo pagado por el turista en reservas confirmadas (incluye su cargo de servicio)
--   net     = gross - cargo de servicio - comisión (lo que corresponde al proveedor; mismo cálculo que el portal)
--   discount = descuento de promociones concedido en esas reservas (lo financia el proveedor, 202611160006)
-- upcoming_7d no depende del periodo: reservas confirmadas con servicio entre hoy y dentro de 7 días.

create or replace function public.connectical_provider_stats(p_from date, p_to date)
returns table (
  offer_id uuid, title text, category text, published boolean,
  quotes integer, reservations integer, confirmed integer, cancelled integer, expired integer,
  units_sold integer, gross_cents bigint, service_fee_cents bigint, commission_cents bigint, net_cents bigint,
  refunded_cents bigint, discount_cents bigint, checked_in integer, upcoming_7d integer
)
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_provider_id uuid;
  v_today date := public.connectical_today();
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select id into v_provider_id from public.connectical_providers where owner_user_id = auth.uid();
  if v_provider_id is null then raise exception 'provider_not_authorized' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  return query
    with own as (
      select o.id, o.title, o.category, o.published from public.connectical_offers o where o.provider_id = v_provider_id
    ), q as (
      select q.offer_id, count(*)::integer as n from public.connectical_quotes q
      where q.offer_id in (select id from own)
        and (q.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      group by q.offer_id
    ), r as (
      select r.offer_id,
        count(*)::integer as reservations,
        count(*) filter (where r.status = 'confirmed')::integer as confirmed,
        count(*) filter (where r.status = 'cancelled')::integer as cancelled,
        count(*) filter (where r.status = 'expired')::integer as expired,
        coalesce(sum(r.quantity * coalesce(r.nights, 1)) filter (where r.status = 'confirmed'), 0)::integer as units,
        coalesce(sum(r.amount_cents) filter (where r.status = 'confirmed'), 0)::bigint as gross,
        coalesce(sum(r.service_fee_cents) filter (where r.status = 'confirmed'), 0)::bigint as fee,
        coalesce(sum(r.provider_commission_cents) filter (where r.status = 'confirmed'), 0)::bigint as commission,
        coalesce(sum(r.refund_cents), 0)::bigint as refunded,
        coalesce(sum(qq.discount_cents) filter (where r.status = 'confirmed'), 0)::bigint as discount,
        count(*) filter (where r.checked_in_at is not null)::integer as checked_in
      from public.connectical_reservations r
      join public.connectical_quotes qq on qq.id = r.quote_id
      where r.provider_id = v_provider_id
        and (r.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      group by r.offer_id
    ), u as (
      select r.offer_id, count(*)::integer as n from public.connectical_reservations r
      where r.provider_id = v_provider_id and r.status = 'confirmed'
        and r.service_date between v_today and v_today + 7
      group by r.offer_id
    )
    select own.id, own.title, own.category, own.published,
      coalesce(q.n, 0), coalesce(r.reservations, 0), coalesce(r.confirmed, 0), coalesce(r.cancelled, 0),
      coalesce(r.expired, 0), coalesce(r.units, 0), coalesce(r.gross, 0::bigint), coalesce(r.fee, 0::bigint),
      coalesce(r.commission, 0::bigint), coalesce(r.gross - r.fee - r.commission, 0::bigint),
      coalesce(r.refunded, 0::bigint), coalesce(r.discount, 0::bigint), coalesce(r.checked_in, 0), coalesce(u.n, 0)
    from own
    left join q on q.offer_id = own.id
    left join r on r.offer_id = own.id
    left join u on u.offer_id = own.id
    order by coalesce(r.gross, 0) desc, own.title;
end;
$$;
revoke all on function public.connectical_provider_stats(date, date) from public, anon;
grant execute on function public.connectical_provider_stats(date, date) to authenticated;
