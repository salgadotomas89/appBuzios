-- Moderación de fotos de ofertas: toda foto nueva espera la aprobación de la administración antes de ser pública.
--
--   * connectical_offer_media gana moderation_status ('pending' | 'approved' | 'rejected'), quién y cuándo la revisó
--     y el motivo. Las fotos nuevas nacen 'pending'; las que ya existían quedan 'approved' (eran públicas), así una
--     oferta publicada conserva sus fotos aprobadas.
--   * Sin sesión o como turista solo se ven fotos 'approved' de ofertas publicadas y aprobadas. El dueño y la
--     administración ven todas, con su estado y motivo: el proveedor sigue el estado de cada foto.
--   * Una foto pendiente o rechazada no despublica la oferta ni bloquea sus reservas.
--   * Solo la administración cambia el estado, con connectical_admin_set_media_moderation: rechazar exige motivo y
--     cada decisión queda en connectical_admin_audit_log (quién, cuándo, de qué estado a cuál y por qué). Un
--     trigger impide que cualquier otra sesión cambie esos campos y vuelve a 'pending' una foto si cambia su
--     contenido: reemplazar una foto aprobada exige revisarla otra vez. Reemplazar es borrar y subir: la nueva nace
--     pendiente.
--   * connectical_admin_list_media_reviews es la bandeja de revisión.
-- Las fotos rechazadas siguen contando para el máximo de 10 hasta que el proveedor las borra.

alter table public.connectical_offer_media
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  add column if not exists moderation_note text not null default '' check (char_length(moderation_note) <= 300),
  add column if not exists moderated_by uuid references auth.users(id),
  add column if not exists moderated_at timestamptz;
alter table public.connectical_offer_media alter column moderation_status set default 'pending';
create index if not exists connectical_offer_media_review_idx
  on public.connectical_offer_media (created_at) where moderation_status = 'pending';

-- El estado y el motivo se pueden leer (el dueño los necesita); quién revisó, solo por la bandeja de la administración.
grant select (moderation_status, moderation_note, moderated_at) on public.connectical_offer_media to anon, authenticated;

drop policy if exists connectical_offer_media_read on public.connectical_offer_media;
create policy connectical_offer_media_read on public.connectical_offer_media for select to anon, authenticated
  using ((moderation_status = 'approved' and exists (select 1 from public.connectical_offers o
                 where o.id = offer_id and o.published and o.moderation_status = 'approved'))
    or public.connectical_is_admin() or public.connectical_owns_offer(offer_id));

create or replace function public.connectical_offer_media_moderation_guard()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if (new.storage_key, new.url, new.content_type, new.byte_size, new.width, new.height, new.alt_text, new.offer_id)
     is distinct from (old.storage_key, old.url, old.content_type, old.byte_size, old.width, old.height, old.alt_text, old.offer_id) then
    new.moderation_status := 'pending';
    new.moderation_note := '';
    new.moderated_by := null;
    new.moderated_at := null;
    return new;
  end if;
  -- Sin sesión (SQL del operador o procesos del sistema) se permite; con sesión, solo la administración.
  if (new.moderation_status, new.moderation_note, new.moderated_by, new.moderated_at)
     is distinct from (old.moderation_status, old.moderation_note, old.moderated_by, old.moderated_at)
     and auth.uid() is not null and not public.connectical_is_admin() then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.connectical_offer_media_moderation_guard() from public, anon, authenticated;
drop trigger if exists connectical_offer_media_moderation_guard on public.connectical_offer_media;
create trigger connectical_offer_media_moderation_guard before update on public.connectical_offer_media
  for each row execute function public.connectical_offer_media_moderation_guard();

-- Una inserción no puede elegir su estado: siempre nace pendiente, la haga quien la haga con sesión.
create or replace function public.connectical_offer_media_new_pending()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if auth.uid() is not null then
    new.moderation_status := 'pending';
    new.moderation_note := '';
    new.moderated_by := null;
    new.moderated_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.connectical_offer_media_new_pending() from public, anon, authenticated;
drop trigger if exists connectical_offer_media_new_pending on public.connectical_offer_media;
create trigger connectical_offer_media_new_pending before insert on public.connectical_offer_media
  for each row execute function public.connectical_offer_media_new_pending();

create or replace function public.connectical_admin_set_media_moderation(p_media_id uuid, p_status text, p_note text)
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_media public.connectical_offer_media;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') or char_length(v_note) > 300 then
    raise exception 'invalid_moderation' using errcode = '22023';
  end if;
  if p_status = 'rejected' and char_length(v_note) < 3 then
    raise exception 'review_note_required' using errcode = '22023';
  end if;
  select * into v_media from public.connectical_offer_media where id = p_media_id for update;
  if not found then raise exception 'media_not_found' using errcode = 'P0002'; end if;
  update public.connectical_offer_media
    set moderation_status = p_status, moderation_note = v_note, moderated_by = auth.uid(), moderated_at = now()
    where id = p_media_id;
  insert into public.connectical_admin_audit_log (actor_user_id, action, target_table, target_id, details)
    values (auth.uid(), 'media_' || p_status, 'connectical_offer_media', p_media_id::text,
            jsonb_build_object('offer_id', v_media.offer_id, 'from', v_media.moderation_status, 'to', p_status, 'note', v_note));
  return p_status;
end;
$$;

create or replace function public.connectical_admin_list_media_reviews(p_status text default 'pending')
returns table (media_id uuid, offer_id uuid, offer_title text, provider_name text, url text, content_type text,
               width integer, height integer, alt_text text, moderation_status text, moderation_note text,
               moderated_by uuid, moderated_at timestamptz, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid_moderation' using errcode = '22023';
  end if;
  return query
    select m.id, m.offer_id, o.title, p.name, m.url, m.content_type, m.width, m.height, m.alt_text,
           m.moderation_status, m.moderation_note, m.moderated_by, m.moderated_at, m.created_at
    from public.connectical_offer_media m
    join public.connectical_offers o on o.id = m.offer_id
    join public.connectical_providers p on p.id = o.provider_id
    where p_status is null or m.moderation_status = p_status
    order by m.created_at
    limit 200;
end;
$$;

revoke all on function public.connectical_admin_set_media_moderation(uuid, text, text) from public, anon;
revoke all on function public.connectical_admin_list_media_reviews(text) from public, anon;
grant execute on function public.connectical_admin_set_media_moderation(uuid, text, text) to authenticated;
grant execute on function public.connectical_admin_list_media_reviews(text) to authenticated;
