-- Perfil comercial público del proveedor. Preparada y probada en local; NO aplicada en ningún tenant.
--
-- El proveedor describe su negocio (hasta 500 caracteres), su barrio en Búzios y los idiomas en que atiende (pt, es,
-- en). Lo edita solo el dueño (activo) por RPC. Los visitantes, también sin sesión, leen el perfil únicamente de
-- proveedores activos con alguna oferta visible, y nunca la comisión, el país de registro ni el usuario dueño.

alter table public.connectical_providers add column if not exists public_description text not null default ''
  check (char_length(public_description) <= 500);
alter table public.connectical_providers add column if not exists neighborhood text not null default ''
  check (char_length(neighborhood) <= 80);
alter table public.connectical_providers add column if not exists languages text[] not null default '{}'
  check (languages <@ array['pt', 'es', 'en']::text[]);

create or replace function public.connectical_provider_update_profile(
  p_description text, p_neighborhood text, p_languages text[]
)
returns table (name text, public_description text, neighborhood text, languages text[])
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_description text := btrim(coalesce(p_description, ''));
  v_neighborhood text := btrim(coalesce(p_neighborhood, ''));
  v_languages text[] := array(select distinct unnest(coalesce(p_languages, '{}'::text[])) order by 1);
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if char_length(v_description) > 500 or char_length(v_neighborhood) > 80
     or not (v_languages <@ array['pt', 'es', 'en']::text[]) then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  update public.connectical_providers p set public_description = v_description, neighborhood = v_neighborhood,
    languages = v_languages, updated_at = now()
    where p.owner_user_id = auth.uid() and p.active;
  if not found then raise exception 'provider_not_authorized' using errcode = '42501'; end if;
  return query select p.name, p.public_description, p.neighborhood, p.languages
    from public.connectical_providers p where p.owner_user_id = auth.uid();
end;
$$;
revoke all on function public.connectical_provider_update_profile(text, text, text[]) from public, anon;
grant execute on function public.connectical_provider_update_profile(text, text, text[]) to authenticated;

create or replace function public.connectical_provider_get_profile()
returns table (name text, public_description text, neighborhood text, languages text[])
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query select p.name, p.public_description, p.neighborhood, p.languages
    from public.connectical_providers p where p.owner_user_id = auth.uid();
end;
$$;
revoke all on function public.connectical_provider_get_profile() from public, anon;
grant execute on function public.connectical_provider_get_profile() to authenticated;

create or replace function public.connectical_list_provider_profiles(p_provider_ids uuid[])
returns table (provider_id uuid, name text, public_description text, neighborhood text, languages text[])
language sql stable security definer
set search_path = public, auth
as $$
  select p.id, p.name, p.public_description, p.neighborhood, p.languages
  from public.connectical_providers p
  where p.id = any (coalesce(p_provider_ids, '{}'::uuid[])) and p.active
    and exists (select 1 from public.connectical_offers o
                where o.provider_id = p.id and o.published and o.moderation_status = 'approved')
  limit 200
$$;
revoke all on function public.connectical_list_provider_profiles(uuid[]) from public;
grant execute on function public.connectical_list_provider_profiles(uuid[]) to anon, authenticated;
