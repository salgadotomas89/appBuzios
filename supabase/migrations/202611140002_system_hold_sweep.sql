-- System sweep for expired holds, for a scheduler that runs without an end-user session.
--
-- connectical_expire_holds() requires auth.uid(), so a cron job cannot call it. This
-- variant records events with a null actor and is executable only by the database
-- owner / trusted roles: anon and authenticated cannot call it. No scheduler is
-- installed here; wire one up only after confirming InsForge's scheduling support.
-- Apply after 202611140001.

create or replace function public.connectical_system_expire_holds()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_offer_id uuid;
  v_count integer := 0;
begin
  for v_offer_id in
    select distinct offer_id from public.connectical_reservations
    where status in ('held', 'pending_payment') and hold_expires_at <= now()
    order by offer_id
  loop
    perform public.connectical_lock_offer(v_offer_id);
    v_count := v_count + public.connectical_expire_offer_holds(v_offer_id);
  end loop;
  return v_count;
end;
$$;

revoke all on function public.connectical_system_expire_holds() from public, anon, authenticated;

comment on function public.connectical_system_expire_holds() is
  'Expires overdue holds without a user session; for a trusted scheduler only. Not granted to app roles.';
