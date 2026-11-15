-- Solo se registran fotos que subió la función offer-media (functions/offer-media.ts).
--
-- En buziosflow (InsForge 2.3.5, migración 066 aplicada) cualquier usuario autenticado puede subir archivos a
-- cualquier bucket por /api/storage si quedan a su nombre (uploaded_by). connectical_add_offer_media se puede llamar
-- directamente por RPC, así que un proveedor podría subir un archivo cualquiera al bucket y registrarlo como foto
-- declarando un tipo, tamaño y medidas falsos, sin pasar por la validación de la función.
--
--   * La foto solo se registra si el archivo existe en 'offer-media' con esa clave, lo escribió la clave de API
--     (uploaded_by nulo: InsForge solo pone el usuario cuando sube un JWT de usuario) y coinciden el tamaño y el tipo
--     que InsForge guardó. La clave de API solo la tiene la función (y la administración del proyecto).
--   * Como mucho 30 fotos registradas por usuario en una hora, para acotar el consumo aunque se borren y se suban
--     de nuevo. El recuento se hace bajo un bloqueo por usuario, así que subidas simultáneas no lo eluden.
--
-- La función es SECURITY DEFINER de project_admin, que en buziosflow tiene BYPASSRLS y SELECT en storage.objects
-- (leído el 15-11-2026); no se toca el esquema storage. Firma, permisos y errores existentes no cambian.

create or replace function public.connectical_add_offer_media(
  p_offer_id uuid,
  p_storage_key text,
  p_content_type text,
  p_byte_size integer,
  p_width integer,
  p_height integer,
  p_alt_text text
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_count integer;
  v_base text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_can_manage_offer(p_offer_id) then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  if p_storage_key is null or p_storage_key !~ ('^offers/' || p_offer_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  select value #>> '{}' into v_base from public.connectical_settings where key = 'media_public_base_url';
  if v_base is null or v_base !~ '^https://[^/\s]+(/[^\s]*)?$' then
    raise exception 'media_storage_not_configured' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket = 'offer-media' and o.key = p_storage_key and o.uploaded_by is null
      and o.size = p_byte_size and o.mime_type = p_content_type
  ) then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  -- Un registro por usuario a la vez: sin este bloqueo, dos subidas simultáneas a ofertas distintas contarían las
  -- mismas fotos y podrían pasar las dos del límite.
  perform pg_advisory_xact_lock(hashtextextended('connectical_offer_media:' || auth.uid()::text, 0));
  if (select count(*) from public.connectical_offer_media
      where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'media_rate_limited' using errcode = 'P0001';
  end if;
  perform public.connectical_lock_offer(p_offer_id);
  select count(*) into v_count from public.connectical_offer_media where offer_id = p_offer_id;
  if v_count >= 10 then raise exception 'media_limit_reached' using errcode = 'P0001'; end if;
  begin
    insert into public.connectical_offer_media (
      offer_id, storage_key, url, content_type, byte_size, width, height, alt_text, position, created_by
    ) values (
      p_offer_id, p_storage_key, rtrim(v_base, '/') || '/' || p_storage_key, p_content_type, p_byte_size, p_width, p_height,
      btrim(p_alt_text), v_count, auth.uid()
    ) returning id into v_id;
  exception when check_violation or not_null_violation or unique_violation then
    raise exception 'invalid_media' using errcode = '22023';
  end;
  return v_id;
end;
$$;

revoke all on function public.connectical_add_offer_media(uuid, text, text, integer, integer, integer, text) from public, anon;
grant execute on function public.connectical_add_offer_media(uuid, text, text, integer, integer, integer, text) to authenticated;
