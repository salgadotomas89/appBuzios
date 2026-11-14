-- Herramientas de operación:
--   * el proveedor publica el mismo cupo para un rango de noches en una sola llamada atómica;
--   * la administración pausa o reactiva un proveedor sin abrir el SQL Editor.

-- Reutiliza connectical_provider_publish_inventory para cada fecha, así se aplican las mismas
-- reglas (propiedad, proveedor activo, fechas pasadas, cupo no menor que lo comprometido). Si una
-- fecha falla, la llamada entera se revierte y no queda un rango a medias.
create or replace function public.connectical_provider_publish_inventory_range(
  p_offer_id uuid,
  p_from_date date,
  p_nights integer,
  p_total_units integer
)
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_index integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if p_nights is null or p_nights < 1 or p_nights > 90 then
    raise exception 'invalid_inventory_range' using errcode = '22023';
  end if;
  for v_index in 0 .. p_nights - 1 loop
    perform public.connectical_provider_publish_inventory(p_offer_id, p_from_date + v_index, p_total_units);
  end loop;
  return p_nights;
end;
$$;

revoke all on function public.connectical_provider_publish_inventory_range(uuid, date, integer, integer) from public, anon;
grant execute on function public.connectical_provider_publish_inventory_range(uuid, date, integer, integer) to authenticated;

-- Pausar impide nuevas cotizaciones y nuevas publicaciones de cupo (provider_inactive y
-- provider_not_authorized). Las reservas ya retenidas o confirmadas no se tocan: qué hacer con
-- ellas es una decisión operativa que queda en manos de la administración.
create or replace function public.connectical_admin_set_provider_active(
  p_provider_id uuid,
  p_active boolean
)
returns public.connectical_providers
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_provider public.connectical_providers;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_active is null then raise exception 'invalid_provider_state' using errcode = '22023'; end if;
  update public.connectical_providers
    set active = p_active, updated_at = now()
    where id = p_provider_id
    returning * into v_provider;
  if not found then raise exception 'provider_not_found' using errcode = 'P0002'; end if;
  return v_provider;
end;
$$;

revoke all on function public.connectical_admin_set_provider_active(uuid, boolean) from public, anon;
grant execute on function public.connectical_admin_set_provider_active(uuid, boolean) to authenticated;
