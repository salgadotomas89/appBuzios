-- Vuelta atrás de la moderación de fotos (202611160005). NO es una migración: si hace falta, se copia a migrations/
-- (y a supabase/migrations/) con el siguiente número libre y se aplica con `npx -y @insforge/cli db migrations up
-- <archivo>` (docs/despliegue-fotos.md, «Recuperación»). Va ANTES que offer-media-photos.sql si se deshacen ambas.
--
-- Vuelve a la lectura anterior (fotos de ofertas publicadas y aprobadas, sin mirar el estado de la foto) y quita los
-- triggers y las RPC de moderación. Las columnas de moderación se conservan: guardan quién revisó qué y cuándo, y sin
-- triggers ni RPC no tienen efecto. Ojo: con esta vuelta atrás, las fotos pendientes o rechazadas pasan a ser
-- públicas si su oferta lo es; antes de aplicarla, borrar las rechazadas o retirar la función offer-media.

drop policy if exists connectical_offer_media_read on public.connectical_offer_media;
create policy connectical_offer_media_read on public.connectical_offer_media for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved')
    or public.connectical_is_admin() or public.connectical_owns_offer(offer_id));

drop trigger if exists connectical_offer_media_moderation_guard on public.connectical_offer_media;
drop trigger if exists connectical_offer_media_new_pending on public.connectical_offer_media;
drop function if exists public.connectical_offer_media_moderation_guard();
drop function if exists public.connectical_offer_media_new_pending();
drop function if exists public.connectical_admin_set_media_moderation(uuid, text, text);
drop function if exists public.connectical_admin_list_media_reviews(text);
revoke select (moderation_status, moderation_note, moderated_at) on public.connectical_offer_media from anon, authenticated;
