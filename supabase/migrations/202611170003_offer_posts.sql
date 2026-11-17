-- Publicaciones e historias de ofertas. Preparada y probada en local; NO aplicada en ningún tenant.
--
--   * El proveedor (activo) publica sobre una oferta propia: texto de hasta 280 caracteres y, opcionalmente, el
--     enlace permanente a una publicación suya de Instagram o TikTok. Nada se descarga ni se copia de esas redes:
--     la app abre el enlace en la red social (mecanismo admitido por ambas). Incrustar con oEmbed queda para cuando
--     exista una app registrada en Meta / TikTok (ver docs/contenido-social.md).
--   * Solo se aceptan permalinks con forma conocida (sin parámetros de seguimiento) y la plataforma la deduce el servidor.
--   * Toda publicación nueva o editada queda 'pending' hasta que la administración la aprueba (rechazar exige motivo).
--     Una historia ('story') es visible 24 horas desde su aprobación; una publicación ('post') hasta que se borre.
--   * Límite: 10 publicaciones nuevas por proveedor y día. Todo cambio de moderación queda en la auditoría.

create table if not exists public.connectical_offer_posts (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.connectical_offers (id) on delete cascade,
  provider_id uuid not null references public.connectical_providers (id) on delete cascade,
  kind text not null check (kind in ('post', 'story')),
  body text not null check (char_length(btrim(body)) between 1 and 280),
  link_url text check (link_url is null or char_length(link_url) <= 200),
  link_platform text check (link_platform in ('instagram', 'tiktok')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  moderation_note text not null default '',
  moderated_by uuid,
  moderated_at timestamptz,
  visible_until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((link_url is null) = (link_platform is null))
);
create index if not exists connectical_offer_posts_offer_idx on public.connectical_offer_posts (offer_id);
create index if not exists connectical_offer_posts_provider_idx on public.connectical_offer_posts (provider_id, created_at desc);
create index if not exists connectical_offer_posts_pending_idx
  on public.connectical_offer_posts (created_at) where status = 'pending';
alter table public.connectical_offer_posts enable row level security;
revoke all on table public.connectical_offer_posts from public, anon, authenticated;

-- Plataforma de un permalink admitido, o null si no lo es.
create or replace function public.connectical_social_platform(p_url text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when p_url ~ '^https://(www\.)?instagram\.com/(p|reel|tv)/[A-Za-z0-9_-]{5,40}/?$' then 'instagram'
    when p_url ~ '^https://(www\.)?tiktok\.com/@[A-Za-z0-9_.]{2,24}/video/[0-9]{8,25}/?$' then 'tiktok'
    when p_url ~ '^https://vm\.tiktok\.com/[A-Za-z0-9]{5,15}/?$' then 'tiktok'
    else null
  end
$$;
grant execute on function public.connectical_social_platform(text) to anon, authenticated;

-- p_post_id nulo crea; con id edita (y vuelve a revisión). p_link_url vacío = sin enlace.
create or replace function public.connectical_provider_save_post(
  p_post_id uuid, p_offer_id uuid, p_kind text, p_body text, p_link_url text
)
returns public.connectical_offer_posts
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_provider_id uuid;
  v_link text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_platform text;
  v_post public.connectical_offer_posts;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select o.provider_id into v_provider_id
    from public.connectical_offers o join public.connectical_providers p on p.id = o.provider_id
    where o.id = p_offer_id and ((p.owner_user_id = auth.uid() and p.active) or public.connectical_is_admin());
  if v_provider_id is null then raise exception 'offer_not_owned' using errcode = '42501'; end if;
  v_platform := public.connectical_social_platform(v_link);
  if p_kind is null or p_kind not in ('post', 'story')
     or p_body is null or char_length(btrim(p_body)) not between 1 and 280
     or (v_link is not null and v_platform is null) then
    raise exception 'invalid_post' using errcode = '22023';
  end if;
  if p_post_id is null then
    -- Serializa a las altas del mismo proveedor para que el límite diario no se pueda saltar en paralelo.
    perform 1 from public.connectical_providers where id = v_provider_id for update;
    if (select count(*) from public.connectical_offer_posts
        where provider_id = v_provider_id and created_at > now() - interval '1 day') >= 10 then
      raise exception 'post_rate_limited' using errcode = 'P0001';
    end if;
    insert into public.connectical_offer_posts (offer_id, provider_id, kind, body, link_url, link_platform, created_by)
      values (p_offer_id, v_provider_id, p_kind, btrim(p_body), v_link, v_platform, auth.uid())
      returning * into v_post;
  else
    update public.connectical_offer_posts set kind = p_kind, body = btrim(p_body), link_url = v_link,
      link_platform = v_platform, status = 'pending', moderation_note = '', moderated_by = null, moderated_at = null,
      visible_until = null, updated_at = now()
      where id = p_post_id and offer_id = p_offer_id
      returning * into v_post;
    if not found then raise exception 'post_not_found' using errcode = 'P0002'; end if;
  end if;
  return v_post;
end;
$$;
revoke all on function public.connectical_provider_save_post(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.connectical_provider_save_post(uuid, uuid, text, text, text) to authenticated;

create or replace function public.connectical_provider_delete_post(p_post_id uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  delete from public.connectical_offer_posts po
    where po.id = p_post_id and (public.connectical_is_admin() or exists (
      select 1 from public.connectical_providers p where p.id = po.provider_id and p.owner_user_id = auth.uid()));
  if not found then raise exception 'post_not_found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.connectical_provider_delete_post(uuid) from public, anon;
grant execute on function public.connectical_provider_delete_post(uuid) to authenticated;

-- Publicaciones propias con su estado y el motivo de un rechazo (sin quién moderó).
create or replace function public.connectical_provider_list_posts()
returns table (id uuid, offer_id uuid, kind text, body text, link_url text, link_platform text, status text,
               moderation_note text, visible_until timestamptz, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query
    select po.id, po.offer_id, po.kind, po.body, po.link_url, po.link_platform, po.status, po.moderation_note,
           po.visible_until, po.created_at
    from public.connectical_offer_posts po join public.connectical_providers p on p.id = po.provider_id
    where p.owner_user_id = auth.uid()
    order by po.created_at desc limit 200;
end;
$$;
revoke all on function public.connectical_provider_list_posts() from public, anon;
grant execute on function public.connectical_provider_list_posts() to authenticated;

create or replace function public.connectical_admin_list_posts(p_status text)
returns table (id uuid, offer_id uuid, offer_title text, provider_name text, kind text, body text, link_url text,
               link_platform text, status text, moderation_note text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select po.id, po.offer_id, o.title, p.name, po.kind, po.body, po.link_url, po.link_platform, po.status,
           po.moderation_note, po.created_at
    from public.connectical_offer_posts po
    join public.connectical_offers o on o.id = po.offer_id
    join public.connectical_providers p on p.id = po.provider_id
    where p_status is null or po.status = p_status
    order by po.created_at limit 200;
end;
$$;
revoke all on function public.connectical_admin_list_posts(text) from public, anon;
grant execute on function public.connectical_admin_list_posts(text) to authenticated;

create or replace function public.connectical_admin_moderate_post(p_post_id uuid, p_status text, p_note text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('approved', 'rejected') or char_length(v_note) > 300 then
    raise exception 'invalid_moderation' using errcode = '22023';
  end if;
  if p_status = 'rejected' and char_length(v_note) < 3 then
    raise exception 'review_note_required' using errcode = '22023';
  end if;
  update public.connectical_offer_posts set status = p_status,
    moderation_note = case when p_status = 'rejected' then v_note else '' end,
    moderated_by = auth.uid(), moderated_at = now(),
    visible_until = case when p_status = 'approved' and kind = 'story' then now() + interval '24 hours' end,
    updated_at = now()
    where id = p_post_id returning kind into v_kind;
  if v_kind is null then raise exception 'post_not_found' using errcode = 'P0002'; end if;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'post_' || p_status, 'connectical_offer_posts', p_post_id::text,
      jsonb_build_object('kind', v_kind));
  return p_status;
end;
$$;
revoke all on function public.connectical_admin_moderate_post(uuid, text, text) from public, anon;
grant execute on function public.connectical_admin_moderate_post(uuid, text, text) to authenticated;

-- Feed público (también sin sesión): aprobadas, vigentes, de ofertas visibles y proveedores activos.
create or replace function public.connectical_list_feed()
returns table (id uuid, offer_id uuid, kind text, body text, link_url text, link_platform text,
               published_at timestamptz, visible_until timestamptz)
language sql stable security definer
set search_path = public, auth
as $$
  select po.id, po.offer_id, po.kind, po.body, po.link_url, po.link_platform, po.moderated_at, po.visible_until
  from public.connectical_offer_posts po
  join public.connectical_offers o on o.id = po.offer_id
  join public.connectical_providers p on p.id = po.provider_id
  where po.status = 'approved' and (po.visible_until is null or po.visible_until > now())
    and o.published and o.moderation_status = 'approved' and p.active
  order by po.moderated_at desc
  limit 50
$$;
revoke all on function public.connectical_list_feed() from public;
grant execute on function public.connectical_list_feed() to anon, authenticated;
