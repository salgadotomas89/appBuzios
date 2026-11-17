-- Indicadores comerciales por categoría para la administración. Preparada y probada en local; NO aplicada.
--
-- Reservas creadas en el periodo (hora de Búzios), como connectical_admin_kpis. Por categoría: confirmadas, pagado por
-- turistas, cargo de servicio, comisión, descuento de promociones y la tasa efectiva media (comisión / subtotal
-- cobrado al proveedor). Además, cuántas confirmadas usaron cada nivel de comisión (producto, proveedor+categoría,
-- proveedor); las cotizaciones anteriores a 202611160006 no tienen nivel y se cuentan como 'unknown'.

create or replace function public.connectical_admin_category_kpis(p_from date, p_to date)
returns table (
  category text, confirmed integer, gross_cents bigint, service_fee_cents bigint, commission_cents bigint,
  discount_cents bigint, effective_rate_bps integer,
  source_offer integer, source_provider_category integer, source_provider integer, source_unknown integer
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  return query
    with r as (
      select o.category as cat, r.amount_cents, r.service_fee_cents, r.provider_commission_cents,
             q.discount_cents, q.provider_commission_source as src
      from public.connectical_reservations r
      join public.connectical_offers o on o.id = r.offer_id
      join public.connectical_quotes q on q.id = r.quote_id
      where r.status = 'confirmed'
        and (r.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
    )
    select c.id,
      count(r.cat)::integer,
      coalesce(sum(r.amount_cents), 0)::bigint,
      coalesce(sum(r.service_fee_cents), 0)::bigint,
      coalesce(sum(r.provider_commission_cents), 0)::bigint,
      coalesce(sum(r.discount_cents), 0)::bigint,
      case when coalesce(sum(r.amount_cents - r.service_fee_cents), 0) = 0 then 0
           else (sum(r.provider_commission_cents) * 10000 / sum(r.amount_cents - r.service_fee_cents))::integer end,
      (count(*) filter (where r.src = 'offer'))::integer,
      (count(*) filter (where r.src = 'provider_category'))::integer,
      (count(*) filter (where r.src = 'provider'))::integer,
      (count(r.cat) filter (where r.src is null))::integer
    from public.connectical_categories c
    left join r on r.cat = c.id
    group by c.id, c.sort_order
    order by c.sort_order;
end;
$$;
revoke all on function public.connectical_admin_category_kpis(date, date) from public, anon;
grant execute on function public.connectical_admin_category_kpis(date, date) to authenticated;
