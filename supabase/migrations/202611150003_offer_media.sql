-- Fotos de ofertas: solo los metadatos. El archivo vive en un bucket que todavía no está confirmado
-- en el tenant; aquí se guarda la `url` y la `storage_key` que devuelve la subida (AGENTS.md).
--
--   * Solo el proveedor dueño (activo) o la administración registran o retiran fotos.
--   * La clave debe empezar por offers/<id de la oferta>/: nadie puede apuntar una foto a un archivo
--     de otra oferta. Tipo, tamaño, dimensiones y texto alternativo se validan aquí también.
--   * Máximo 10 fotos por oferta. Turistas y visitantes solo ven las de ofertas publicadas y visibles.

create table if not exists public.connectical_offer_media (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.connectical_offers(id) on delete cascade,
  storage_key text not null unique check (char_length(storage_key) <= 200),
  url text not null check (url ~ '^(https|memory)://' and char_length(url) <= 500),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  width integer not null check (width between 600 and 6000),
  height integer not null check (height between 600 and 6000),
  alt_text text not null check (char_length(btrim(alt_text)) between 1 and 160),
  position integer not null default 0 check (position between 0 and 9),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists connectical_offer_media_offer_idx on public.connectical_offer_media (offer_id, position);

alter table public.connectical_offer_media enable row level security;
revoke all on table public.connectical_offer_media from public, anon, authenticated;
grant select (id, offer_id, url, content_type, width, height, alt_text, position)
  on public.connectical_offer_media to anon, authenticated;

drop policy if exists connectical_offer_media_read on public.connectical_offer_media;
create policy connectical_offer_media_read on public.connectical_offer_media for select to anon, authenticated
  using (exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved')
    or public.connectical_is_admin() or exists (
      select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
      where o.id = offer_id and p.owner_user_id = auth.uid()
    ));

create or replace function public.connectical_can_manage_offer(p_offer_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.connectical_is_admin() or exists (
    select 1 from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and p.owner_user_id = auth.uid() and p.active)
$$;
revoke all on function public.connectical_can_manage_offer(uuid) from public, anon, authenticated;

create or replace function public.connectical_add_offer_media(
  p_offer_id uuid,
  p_storage_key text,
  p_url text,
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
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_can_manage_offer(p_offer_id) then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  if p_storage_key is null or p_storage_key !~ ('^offers/' || p_offer_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'invalid_media' using errcode = '22023';
  end if;
  perform public.connectical_lock_offer(p_offer_id);
  select count(*) into v_count from public.connectical_offer_media where offer_id = p_offer_id;
  if v_count >= 10 then raise exception 'media_limit_reached' using errcode = 'P0001'; end if;
  begin
    insert into public.connectical_offer_media (
      offer_id, storage_key, url, content_type, byte_size, width, height, alt_text, position, created_by
    ) values (
      p_offer_id, p_storage_key, p_url, p_content_type, p_byte_size, p_width, p_height, btrim(p_alt_text), v_count, auth.uid()
    ) returning id into v_id;
  exception when check_violation or not_null_violation or unique_violation then
    raise exception 'invalid_media' using errcode = '22023';
  end;
  return v_id;
end;
$$;

-- Devuelve la clave para que quien llama borre el archivo del bucket.
create or replace function public.connectical_remove_offer_media(p_media_id uuid)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_media public.connectical_offer_media;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select * into v_media from public.connectical_offer_media where id = p_media_id;
  if not found then raise exception 'media_not_found' using errcode = 'P0002'; end if;
  if not public.connectical_can_manage_offer(v_media.offer_id) then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  delete from public.connectical_offer_media where id = p_media_id;
  return v_media.storage_key;
end;
$$;

revoke all on function public.connectical_add_offer_media(uuid, text, text, text, integer, integer, integer, text) from public, anon;
revoke all on function public.connectical_remove_offer_media(uuid) from public, anon;
grant execute on function public.connectical_add_offer_media(uuid, text, text, text, integer, integer, integer, text) to authenticated;
grant execute on function public.connectical_remove_offer_media(uuid) to authenticated;
