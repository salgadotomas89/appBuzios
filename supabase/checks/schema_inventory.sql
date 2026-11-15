-- Inventario de solo lectura del esquema de Búzios Flow, para comparar un tenant con las migraciones
-- del repositorio. Ejecutar en el SQL Editor, copiar el resultado y compararlo con
-- supabase/checks/expected_schema_inventory.txt (una línea por objeto, ordenadas). Cualquier
-- diferencia indica migraciones pendientes, aplicadas a medias o cambios hechos a mano.
-- Las funciones se comparan por firma y por md5 de su cuerpo; no se leen datos de ninguna tabla.
select line from (
  select 'table ' || c.relname || ' rls=' || c.relrowsecurity as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'connectical\_%'
  union all
  select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name like 'connectical\_%'
  union all
  select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') definer=' || p.prosecdef
         || ' md5=' || md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'connectical\_%'
  union all
  select 'policy ' || tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',')
  from pg_policies where schemaname = 'public' and tablename like 'connectical\_%'
  union all
  select 'policy storage.' || tablename || '.' || policyname || ' ' || cmd || ' ' || permissive || ' ' || array_to_string(roles, ',')
  from pg_policies where schemaname = 'storage' and policyname like 'connectical\_%'
  union all
  select 'trigger ' || c.relname || '.' || t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where t.tgname like 'connectical\_%' and not t.tgisinternal
) inventory
order by line collate "C";
