-- Reglas de escritura del bucket de fotos de ofertas ('offer-media') en storage.objects.
--
-- buziosflow trae las políticas por defecto de InsForge: cualquier usuario autenticado puede subir a cualquier
-- bucket si el objeto queda a su nombre (uploaded_by). Con un bucket público de fotos, un turista podría alojar
-- archivos arbitrarios visibles para todos. Estas políticas son RESTRICTIVE: se suman a las de InsForge (que
-- siguen exigiendo ser el dueño del objeto) y solo afectan a 'offer-media'. Los demás buckets no cambian.
--
--   * Subir, reemplazar o borrar en 'offer-media' exige poder gestionar la oferta de la clave (proveedor dueño
--     activo o administración), con la misma forma de clave que valida connectical_add_offer_media:
--     offers/<id de la oferta>/<uuid>.(jpg|png|webp).
--   * Tipo y tamaño acotados como en offer_media: JPEG, PNG o WebP de hasta 5 MB.
--   * La lectura no se toca: en un bucket público las descargas directas no pasan por RLS (documentación de
--     InsForge). Las fotos de ofertas sin aprobar solo son accesibles para quien conozca su clave aleatoria.
--   * La clave de API (administración del proyecto) no pasa por RLS.
--
-- No se puede aplicar con `db migrations up` en InsForge 2.3.5: el backend ejecuta las migraciones con
-- SET LOCAL ROLE project_admin y crear políticas exige ser dueño de storage.objects (postgres). Ensayada sobre una
-- restauración exacta de buziosflow (15-11-2026): "must be owner of table objects" y la transacción no deja nada.
-- Va detrás de los índices para no bloquearlos; necesita que InsForge la aplique o un procedimiento suyo.

create or replace function public.connectical_can_write_offer_media_object(
  p_bucket text,
  p_key text,
  p_mime_type text,
  p_size integer
)
returns boolean
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if p_bucket is distinct from 'offer-media' then return true; end if;
  if p_key is null or p_key !~ '^offers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    return false;
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then return false; end if;
  if p_size is null or p_size not between 1 and 5242880 then return false; end if;
  return public.connectical_can_manage_offer(split_part(p_key, '/', 2)::uuid);
end;
$$;
revoke all on function public.connectical_can_write_offer_media_object(text, text, text, integer) from public, anon;
grant execute on function public.connectical_can_write_offer_media_object(text, text, text, integer) to authenticated;

drop policy if exists connectical_offer_media_insert on storage.objects;
create policy connectical_offer_media_insert on storage.objects as restrictive for insert to authenticated
  with check (public.connectical_can_write_offer_media_object(bucket, key, mime_type, size));

drop policy if exists connectical_offer_media_update on storage.objects;
create policy connectical_offer_media_update on storage.objects as restrictive for update to authenticated
  using (public.connectical_can_write_offer_media_object(bucket, key, mime_type, size))
  with check (public.connectical_can_write_offer_media_object(bucket, key, mime_type, size));

drop policy if exists connectical_offer_media_delete on storage.objects;
create policy connectical_offer_media_delete on storage.objects as restrictive for delete to authenticated
  using (public.connectical_can_write_offer_media_object(bucket, key, mime_type, size));
