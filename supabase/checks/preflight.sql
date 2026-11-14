-- Preflight de solo lectura ANTES de aplicar supabase/migrations en un tenant candidato.
-- Pegar en el SQL Editor. Solo SELECT: no crea, modifica ni borra nada, y no lee filas de usuarios
-- (solo cuenta). Guardar el resultado con la fecha y detenerse si algo no es lo esperado.
-- La identidad del proyecto (ensayo frente a producción) se confirma en el panel de InsForge:
-- ninguna consulta SQL puede probarlo por sí sola.

-- 1. Identidad del servidor y de la sesión.
select current_database() as database, current_user as session_user_name,
       inet_server_addr() as server_addr, version() as postgres_version,
       current_setting('server_version_num')::int >= 150000 as postgres_15_or_newer,
       current_setting('TimeZone') as server_timezone;

-- 2. Extensiones: gen_random_uuid() es nativa desde PostgreSQL 13; pg_cron permitiría programar
--    el barrido de retenciones dentro de la base (si no está, usar el scheduler de la plataforma).
select name, default_version, installed_version
from pg_available_extensions
where name in ('pgcrypto', 'pg_cron', 'pg_net')
order by name;

-- 3. Esquema Auth que las migraciones referencian.
select
  exists (select 1 from pg_namespace where nspname = 'auth') as has_auth_schema,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'auth' and p.proname = 'uid') as has_auth_uid,
  exists (select 1 from information_schema.columns where table_schema = 'auth'
          and table_name = 'users' and column_name = 'raw_user_meta_data') as has_user_metadata,
  (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) = 2 as has_app_roles;

-- 4. Estado previo: objetos de esta funcionalidad que ya existan (se esperan 0 en un tenant nuevo).
select 'table' as kind, table_name as name from information_schema.tables
  where table_schema = 'public' and table_name like 'connectical\_%'
union all
select 'function', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'connectical\_%'
union all
select 'trigger', t.tgname from pg_trigger t where t.tgname like 'connectical\_%' and not t.tgisinternal
order by 1, 2;

-- 5. Historial de migraciones gestionado por la plataforma, si existe alguno.
select table_schema, table_name from information_schema.tables
where table_name ilike '%migration%' and table_schema not in ('pg_catalog', 'information_schema')
order by 1, 2;

-- 6. Volumen previo (solo recuentos, nunca filas).
select (select count(*) from auth.users) as auth_users,
       (select count(*) from information_schema.tables where table_schema = 'public') as public_tables;

-- 7. ¿Puede esta sesión aplicar las migraciones? Necesita crear en public y ser dueña o superusuaria
--    para crear el trigger sobre auth.users.
select has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public,
       (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
       pg_has_role(current_user, (select relowner from pg_class where oid = 'auth.users'::regclass), 'MEMBER')
         as owns_auth_users;
