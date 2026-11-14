-- Conciliación de inventario, solo lectura. Para cada noche publicada compara los contadores con
-- las reservas que la cubren: held_units = retenidas o con pago pendiente, sold_units = confirmadas.
-- Una estancia de N noches cubre [service_date, service_date + N). Devuelve solo las filas que no
-- cuadran; un resultado vacío significa inventario consistente.
-- Nota: una retención vencida sigue contando como retenida hasta que un barrido la marque 'expired'.
with coverage as (
  select i.offer_id, i.service_date, i.total_units, i.held_units, i.sold_units,
         coalesce(sum(r.quantity) filter (where r.status in ('held', 'pending_payment')), 0) as expected_held,
         coalesce(sum(r.quantity) filter (where r.status = 'confirmed'), 0) as expected_sold
  from public.connectical_inventory i
  left join public.connectical_reservations r
    on r.offer_id = i.offer_id
   and i.service_date >= r.service_date
   and i.service_date < r.service_date + r.nights
  group by i.offer_id, i.service_date, i.total_units, i.held_units, i.sold_units
)
select offer_id, service_date, total_units, held_units, expected_held, sold_units, expected_sold
from coverage
where held_units <> expected_held
   or sold_units <> expected_sold
   or held_units + sold_units > total_units
union all
-- Reservas que cubren noches sin fila de inventario (no debería ocurrir: el RPC exige cada noche).
select r.offer_id, (r.service_date + n.night)::date, null, null, r.quantity, null, null
from public.connectical_reservations r
cross join lateral generate_series(0, r.nights - 1) as n(night)
where r.status in ('held', 'pending_payment', 'confirmed')
  and not exists (select 1 from public.connectical_inventory i
                  where i.offer_id = r.offer_id and i.service_date = r.service_date + n.night)
order by 1, 2;
