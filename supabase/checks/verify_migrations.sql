-- Verificación de solo lectura después de aplicar las migraciones de supabase/migrations.
-- Pegar en el SQL Editor del tenant de ENSAYO confirmado. No modifica nada: solo SELECT.
-- Cada fila debe salir con ok = true. scripts/test-shared-reservations.sh la ejecuta contra
-- PostgreSQL local para que no quede desactualizada.
with checks(name, ok) as (
  values
    ('tables exist',
      (select count(*) = 7 from information_schema.tables where table_schema = 'public' and table_name in (
        'connectical_profiles', 'connectical_providers', 'connectical_offers', 'connectical_inventory',
        'connectical_quotes', 'connectical_reservations', 'connectical_reservation_events'))),
    ('refund ledger table exists',
      (select count(*) = 1 from information_schema.tables where table_schema = 'public' and table_name = 'connectical_refunds')),
    ('reservations.nights column exists',
      (select count(*) = 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'connectical_reservations' and column_name = 'nights')),
    ('RLS enabled on every connectical table',
      (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'connectical\_%')),
    ('internal helpers not executable by app roles',
      (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                       and not has_function_privilege('anon', p.oid, 'execute'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'connectical_adjust_stay_inventory', 'connectical_expire_offer_holds', 'connectical_lock_offer',
          'connectical_create_traveler_profile', 'connectical_system_expire_holds',
          'connectical_system_run_hold_sweep'))),
    ('app RPCs executable by authenticated',
      (select count(*) = 15 and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'connectical_create_quote', 'connectical_create_reservation_hold', 'connectical_simulate_payment',
          'connectical_cancel_reservation', 'connectical_expire_holds', 'connectical_provider_upsert_offer',
          'connectical_provider_publish_inventory', 'connectical_admin_record_refund', 'connectical_today',
          'connectical_provider_publish_inventory_range', 'connectical_admin_set_provider_active',
          'connectical_admin_sweep_health', 'connectical_admin_set_provider_commission',
          'connectical_admin_set_offer_commission', 'connectical_admin_list_commission_terms'))),
    ('anon cannot run reservation, refund or operations RPCs',
      (select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'connectical_create_reservation_hold', 'connectical_simulate_payment', 'connectical_cancel_reservation',
          'connectical_admin_record_refund', 'connectical_provider_publish_inventory_range',
          'connectical_admin_set_provider_active'))),
    ('SECURITY DEFINER functions pin search_path',
      (select bool_and(p.proconfig is not null and exists (
          select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'connectical\_%' and p.prosecdef)),
    -- Seguro si el rol no tiene permiso de escritura, o si la tabla tiene RLS y ninguna política de escritura
    -- (algunos BaaS conceden ALL a authenticated por defecto y delegan el control en RLS).
    ('app roles cannot write ledger tables directly',
      (select bool_and(
          (not has_table_privilege(r.role, c.oid, 'INSERT') and not has_table_privilege(r.role, c.oid, 'UPDATE')
             and not has_table_privilege(r.role, c.oid, 'DELETE'))
          or (c.relrowsecurity and not exists (
            select 1 from pg_policies pol where pol.schemaname = 'public' and pol.tablename = c.relname
              and pol.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))))
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) as r(role)
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname in ('connectical_reservations', 'connectical_inventory', 'connectical_quotes',
                            'connectical_reservation_events', 'connectical_refunds'))),
    -- Identificadores de Auth: solo se pueden leer los que RLS limita a su dueño (perfil propio,
    -- proveedor propio, cotización propia). Una columna *_user_id nueva falla aquí hasta revisarla.
    ('app roles cannot read internal Auth ids of other people',
      (select coalesce(bool_and(not has_column_privilege(r.role, format('public.%I', c.table_name)::regclass,
                                                         c.column_name, 'SELECT')), true)
        from information_schema.columns c
        cross join (values ('anon'), ('authenticated')) as r(role)
        where c.table_schema = 'public' and c.table_name like 'connectical\_%'
          and (c.column_name like '%user_id' or c.column_name = 'idempotency_key')
          and (c.table_name, c.column_name) not in (
            ('connectical_profiles', 'user_id'),
            ('connectical_providers', 'owner_user_id'),
            ('connectical_quotes', 'traveler_user_id')))),
    ('product commission and references are not readable by app roles',
      (select not has_column_privilege('anon', 'public.connectical_offers', 'commission_rate_bps', 'SELECT')
          and not has_column_privilege('authenticated', 'public.connectical_offers', 'commission_rate_bps', 'SELECT')
          and not has_table_privilege('authenticated', 'public.connectical_commission_references', 'SELECT'))),
    ('commission references seeded as proposals, none approved',
      (select count(*) = 5 and bool_and(status = 'reference') from public.connectical_commission_references)),
    ('no scheduler assumed: system sweeps exist but are private',
      (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('connectical_system_expire_holds', 'connectical_system_run_hold_sweep')))
)
select name, coalesce(ok, false) as ok from checks order by name;
