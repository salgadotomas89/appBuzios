-- Catálogo legible sin sesión.
--
-- Las políticas de lectura de ofertas, inventario y fotos comprobaban la propiedad con una subconsulta
-- sobre connectical_providers. El rol anon no tiene privilegio sobre esa tabla, así que cualquier
-- lectura sin sesión fallaba con "permission denied" en lugar de mostrar las ofertas publicadas.
-- Las políticas pasan a usar un helper que solo responde si quien consulta es dueño de la oferta.

create or replace function public.connectical_owns_offer(p_offer_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select auth.uid() is not null and exists (
    select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid())
$$;
revoke all on function public.connectical_owns_offer(uuid) from public;
grant execute on function public.connectical_owns_offer(uuid) to anon, authenticated;

drop policy if exists connectical_offers_read on public.connectical_offers;
create policy connectical_offers_read on public.connectical_offers for select to anon, authenticated
  using ((published and moderation_status = 'approved') or public.connectical_is_admin()
    or public.connectical_owns_offer(id));

drop policy if exists connectical_inventory_read on public.connectical_inventory;
create policy connectical_inventory_read on public.connectical_inventory for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved')
    or public.connectical_is_admin() or public.connectical_owns_offer(offer_id));

drop policy if exists connectical_offer_media_read on public.connectical_offer_media;
create policy connectical_offer_media_read on public.connectical_offer_media for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved')
    or public.connectical_is_admin() or public.connectical_owns_offer(offer_id));
