-- Ejecución programada del barrido de retenciones, preparada para cualquier scheduler que pueda
-- llamar a una función SQL con un rol de confianza (pg_cron, tareas de la plataforma o una función
-- edge con la clave de servicio). No instala ningún scheduler.
--
--   * Sin solapes: si otra ejecución está en curso, esta termina como 'skipped' sin tocar nada.
--   * Aislamiento por oferta: un fallo en una oferta (por ejemplo contadores desfasados) se registra
--     y el barrido sigue con las demás, en vez de dejar todas las retenciones sin vencer.
--   * Registro: cada ejecución deja una fila con inicio, fin, retenciones vencidas, ofertas fallidas
--     y el estado ('succeeded', 'partial', 'skipped').
--   * Recuperación: el barrido es idempotente; la siguiente ejecución retoma lo que haya quedado.
--     Si el proceso muere a mitad de transacción, la fila de la ejecución se revierte con ella y la
--     salud del barrido lo refleja como tiempo sin ejecuciones correctas.

create table if not exists public.connectical_sweep_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'partial', 'skipped')),
  expired_count integer not null default 0 check (expired_count >= 0),
  failed_offers jsonb not null default '[]'::jsonb
);

create index if not exists connectical_sweep_runs_started_idx
  on public.connectical_sweep_runs (started_at desc);

alter table public.connectical_sweep_runs enable row level security;
revoke all on table public.connectical_sweep_runs from public, anon, authenticated;

create or replace function public.connectical_system_run_hold_sweep()
returns public.connectical_sweep_runs
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_run public.connectical_sweep_runs;
  v_offer_id uuid;
  v_expired integer := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('connectical-hold-sweep', 0)) then
    insert into public.connectical_sweep_runs (status, finished_at)
      values ('skipped', clock_timestamp()) returning * into v_run;
    return v_run;
  end if;

  insert into public.connectical_sweep_runs (status) values ('running') returning * into v_run;
  for v_offer_id in
    select distinct offer_id from public.connectical_reservations
    where status in ('held', 'pending_payment') and hold_expires_at <= now()
    order by offer_id
  loop
    begin
      perform public.connectical_lock_offer(v_offer_id);
      v_expired := v_expired + public.connectical_expire_offer_holds(v_offer_id);
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'offer_id', v_offer_id, 'sqlstate', sqlstate, 'error', left(sqlerrm, 200)));
    end;
  end loop;

  update public.connectical_sweep_runs
    set finished_at = clock_timestamp(),
        expired_count = v_expired,
        failed_offers = v_failed,
        status = case when jsonb_array_length(v_failed) = 0 then 'succeeded' else 'partial' end
    where id = v_run.id
    returning * into v_run;
  return v_run;
end;
$$;

revoke all on function public.connectical_system_run_hold_sweep() from public, anon, authenticated;

comment on function public.connectical_system_run_hold_sweep() is
  'Scheduled hold sweep with overlap guard and run log; for a trusted scheduler only. Not granted to app roles.';

-- Salud del barrido para la administración. 'stale' indica que no hubo una ejecución correcta en
-- p_max_age_minutes (por defecto 15, con retenciones de 10 minutos y una cadencia de 1–5).
create or replace function public.connectical_admin_sweep_health(p_max_age_minutes integer default 15)
returns table (
  last_success_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  runs_last_hour integer,
  partial_runs_last_hour integer,
  overdue_holds integer,
  stale boolean
)
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.connectical_is_admin() then raise exception 'permission_denied' using errcode = '42501'; end if;
  return query
    select
      (select max(r.finished_at) from public.connectical_sweep_runs r where r.status = 'succeeded'),
      (select max(r.started_at) from public.connectical_sweep_runs r),
      (select r.status from public.connectical_sweep_runs r order by r.started_at desc, r.id desc limit 1),
      (select count(*)::integer from public.connectical_sweep_runs r where r.started_at > now() - interval '1 hour'),
      (select count(*)::integer from public.connectical_sweep_runs r
        where r.started_at > now() - interval '1 hour' and r.status = 'partial'),
      (select count(*)::integer from public.connectical_reservations res
        where res.status in ('held', 'pending_payment') and res.hold_expires_at <= now()),
      coalesce((select max(r.finished_at) from public.connectical_sweep_runs r where r.status = 'succeeded')
        < now() - make_interval(mins => greatest(coalesce(p_max_age_minutes, 15), 1)), true);
end;
$$;

revoke all on function public.connectical_admin_sweep_health(integer) from public, anon;
grant execute on function public.connectical_admin_sweep_health(integer) to authenticated;
