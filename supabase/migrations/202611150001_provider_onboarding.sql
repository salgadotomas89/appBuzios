-- Alta de proveedores con revisión administrativa.
--
--   * Un usuario autenticado con rol 'traveler' envía una solicitud con los datos del establecimiento.
--     Solo puede tener una pendiente a la vez. Enviarla no concede ningún privilegio.
--   * Solo la administración la aprueba o la rechaza. Al aprobar, la base de datos cambia el perfil a
--     'provider' y crea el registro del proveedor con la comisión que la administración indique de
--     forma explícita (no hay tasas comerciales aprobadas que aplicar por defecto). Rechazar exige un
--     motivo, que el solicitante puede leer.
--   * Los datos de contacto son los mínimos para operar (LGPD): nada de documentos de identidad.

create table if not exists public.connectical_provider_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 2 and 120),
  category text not null check (category in ('pousadas', 'barcos', 'noche', 'buggy', 'experiencias')),
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 120),
  contact_phone text not null check (contact_phone ~ '^\+?[0-9 ()-]{8,20}$'),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact_email) <= 200),
  location text not null check (char_length(btrim(location)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '' check (char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  provider_id uuid references public.connectical_providers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists connectical_provider_applications_one_pending
  on public.connectical_provider_applications (applicant_user_id) where status = 'pending';
create index if not exists connectical_provider_applications_status_idx
  on public.connectical_provider_applications (status, created_at desc);

alter table public.connectical_provider_applications enable row level security;
revoke all on table public.connectical_provider_applications from public, anon, authenticated;

create or replace function public.connectical_submit_provider_application(
  p_business_name text,
  p_category text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_location text,
  p_description text
)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.connectical_profiles where user_id = auth.uid() and role = 'traveler') then
    raise exception 'application_not_allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.connectical_provider_applications
             where applicant_user_id = auth.uid() and status = 'pending') then
    raise exception 'application_already_pending' using errcode = '23505';
  end if;
  begin
    insert into public.connectical_provider_applications (
      applicant_user_id, business_name, category, contact_name, contact_phone, contact_email, location, description
    ) values (
      auth.uid(), btrim(p_business_name), p_category, btrim(p_contact_name), btrim(p_contact_phone),
      lower(btrim(p_contact_email)), btrim(p_location), btrim(coalesce(p_description, ''))
    ) returning id into v_id;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid_application' using errcode = '22023';
    when unique_violation then
      raise exception 'application_already_pending' using errcode = '23505';
  end;
  return v_id;
end;
$$;

-- La solicitud más reciente de quien consulta, con el motivo si fue rechazada.
create or replace function public.connectical_my_provider_application()
returns table (id uuid, business_name text, category text, status text, review_note text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  return query
    select a.id, a.business_name, a.category, a.status, a.review_note, a.created_at, a.reviewed_at
    from public.connectical_provider_applications a
    where a.applicant_user_id = auth.uid()
    order by a.created_at desc
    limit 1;
end;
$$;

create or replace function public.connectical_admin_list_provider_applications(p_status text default 'pending')
returns setof public.connectical_provider_applications
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select * from public.connectical_provider_applications a
    where p_status is null or a.status = p_status
    order by a.created_at desc
    limit 200;
end;
$$;

create or replace function public.connectical_admin_review_provider_application(
  p_application_id uuid,
  p_decision text,
  p_note text,
  p_commission_rate_bps integer default null
)
returns public.connectical_provider_applications
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_application public.connectical_provider_applications;
  v_provider_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_review' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and char_length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'review_note_required' using errcode = '22023';
  end if;
  if p_decision = 'approved' and (p_commission_rate_bps is null or p_commission_rate_bps not between 0 and 10000) then
    raise exception 'invalid_commission_rate' using errcode = '22023';
  end if;

  select * into v_application from public.connectical_provider_applications
    where id = p_application_id for update;
  if not found then raise exception 'application_not_found' using errcode = 'P0002'; end if;
  if v_application.status <> 'pending' then raise exception 'application_already_reviewed' using errcode = 'P0001'; end if;

  if p_decision = 'approved' then
    -- Solo se convierte un perfil de turista; nunca se toca un administrador.
    update public.connectical_profiles set role = 'provider'
      where user_id = v_application.applicant_user_id and role = 'traveler';
    if not found then raise exception 'application_not_allowed' using errcode = '42501'; end if;
    insert into public.connectical_providers (owner_user_id, name, country_code, commission_rate_bps, active)
      values (v_application.applicant_user_id, v_application.business_name, 'BR', p_commission_rate_bps, true)
      returning id into v_provider_id;
  end if;

  update public.connectical_provider_applications
    set status = p_decision, review_note = btrim(coalesce(p_note, '')), reviewed_by = auth.uid(),
        reviewed_at = now(), provider_id = v_provider_id, updated_at = now()
    where id = p_application_id
    returning * into v_application;
  return v_application;
end;
$$;

revoke all on function public.connectical_submit_provider_application(text, text, text, text, text, text, text) from public, anon;
revoke all on function public.connectical_my_provider_application() from public, anon;
revoke all on function public.connectical_admin_list_provider_applications(text) from public, anon;
revoke all on function public.connectical_admin_review_provider_application(uuid, text, text, integer) from public, anon;
grant execute on function public.connectical_submit_provider_application(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.connectical_my_provider_application() to authenticated;
grant execute on function public.connectical_admin_list_provider_applications(text) to authenticated;
grant execute on function public.connectical_admin_review_provider_application(uuid, text, text, integer) to authenticated;
