-- Vuelta atrás de las fotos de ofertas (202611160003 y 202611160004). NO es una migración: si hace falta, se copia a
-- migrations/ con el siguiente número libre (p. ej. 20261117000001_offer-media-rollback.sql) y se aplica con
-- `npx -y @insforge/cli db migrations up <archivo>`, como project_admin (docs/despliegue-fotos.md, «Recuperación»).
--
-- Quita las cuatro políticas RESTRICTIVE de storage.objects (offer-media vuelve a las reglas por defecto de InsForge)
-- y devuelve connectical_add_offer_media a su versión de 202611150003 (sin exigir que el archivo lo escribiera la
-- función ni límite por hora). Las fotos registradas y los archivos no se tocan.

drop policy if exists connectical_offer_media_select on storage.objects;
drop policy if exists connectical_offer_media_insert on storage.objects;
drop policy if exists connectical_offer_media_update on storage.objects;
drop policy if exists connectical_offer_media_delete on storage.objects;

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
