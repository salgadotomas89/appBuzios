-- Retención del registro del barrido. Con el schedule de buziosflow cada 2 minutos, connectical_sweep_runs
-- crece unas 720 filas al día y nada las borraba.
--
--   * Las ejecuciones sin efecto (succeeded o skipped que no vencieron nada) se conservan 30 días: bastan para
--     la salud del barrido, que mira la última hora.
--   * Las que vencieron retenciones o terminaron 'partial' se conservan 180 días, para investigar incidencias.
--   * Como mucho 1000 filas por ejecución, para que una limpieza atrasada no alargue el barrido.
--   * Si la limpieza falla, el barrido se registra igual: el error queda en failed_offers con offer_id nulo.

create or replace function public.connectical_prune_sweep_runs()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
begin
  delete from public.connectical_sweep_runs
  where id in (
    select r.id from public.connectical_sweep_runs r
    where r.finished_at is not null
      and ((r.status in ('succeeded', 'skipped') and r.expired_count = 0 and r.started_at < now() - interval '30 days')
        or r.started_at < now() - interval '180 days')
    order by r.id
    limit 1000
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.connectical_prune_sweep_runs() from public, anon, authenticated;

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

  begin
    perform public.connectical_prune_sweep_runs();
  exception when others then
    v_failed := v_failed || jsonb_build_array(jsonb_build_object(
      'offer_id', null, 'sqlstate', sqlstate, 'error', left('prune: ' || sqlerrm, 200)));
  end;

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
