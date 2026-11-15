-- Huella de la base: estructura, permisos y datos de todos los esquemas no internos de PostgreSQL. La usa
-- scripts/backup-verified.sh para comparar el tenant con su restauración; compárense las salidas ordenadas.
-- Excluye objetos que pertenecen a extensiones (su versión puede diferir en la copia local).
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

select 'schema', nspname, nspowner::regrole, (select coalesce(string_agg(x.grantee::regrole::text || '=' || x.privilege_type || case when x.is_grantable then '*' else '' end || '/' || x.grantor::regrole::text, ',' order by x.grantee::regrole::text, x.privilege_type, x.grantor::regrole::text), '') from aclexplode(coalesce(nspacl, acldefault('n'::"char", nspowner))) x) from pg_namespace n
  where oid in (select oid from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') order by 2;
select 'extension', extname, extnamespace::regnamespace from pg_extension order by 2;

select 'relation', n.nspname, c.relname, c.relkind, c.relowner::regrole, c.relrowsecurity, c.relforcerowsecurity,
       (select coalesce(string_agg(x.grantee::regrole::text || '=' || x.privilege_type || case when x.is_grantable then '*' else '' end || '/' || x.grantor::regrole::text, ',' order by x.grantee::regrole::text, x.privilege_type, x.grantor::regrole::text), '') from aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) x)
  from pg_class c join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace
  where c.relkind in ('r','p','v','m','S','f')
    and not exists (select 1 from (select classid, objid from pg_depend where deptype = 'e') e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
  order by 2, 3;

select 'column', n.nspname, c.relname, row_number() over (partition by c.oid order by a.attnum), a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
       coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
    and not exists (select 1 from (select classid, objid from pg_depend where deptype = 'e') e where e.classid = 'pg_class'::regclass and e.objid = c.oid)
  order by 2, 3, 4;

select 'constraint', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace
  order by 2, 3, 4;

select 'index', n.nspname, ci.relname, pg_get_indexdef(i.indexrelid)
  from pg_index i join pg_class ci on ci.oid = i.indexrelid join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = ci.relnamespace
  where not exists (select 1 from (select classid, objid from pg_depend where deptype = 'e') e where e.classid = 'pg_class'::regclass and e.objid = i.indrelid)
  order by 2, 3;

select 'function', n.nspname, p.oid::regprocedure, p.proowner::regrole, p.prosecdef, p.provolatile,
       coalesce(array_to_string(p.proconfig, ','), ''), md5(p.prosrc), (select coalesce(string_agg(x.grantee::regrole::text || '=' || x.privilege_type || case when x.is_grantable then '*' else '' end || '/' || x.grantor::regrole::text, ',' order by x.grantee::regrole::text, x.privilege_type, x.grantor::regrole::text), '') from aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) x)
  from pg_proc p join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = p.pronamespace
  where not exists (select 1 from (select classid, objid from pg_depend where deptype = 'e') e where e.classid = 'pg_proc'::regclass and e.objid = p.oid)
  order by 2, 3;

select 'view', n.nspname, c.relname, md5(pg_get_viewdef(c.oid))
  from pg_class c join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace where c.relkind in ('v','m') order by 2, 3;

select 'policy', n.nspname, c.relname, p.polname, p.polpermissive, p.polcmd, p.polroles::regrole[]::text,
       coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  from pg_policy p join pg_class c on c.oid = p.polrelid join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace
  order by 2, 3, 4;

select 'trigger', n.nspname, c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = c.relnamespace
  where not t.tgisinternal order by 2, 3, 4;

select 'event_trigger', evtname, evtevent, evtfoid::regproc, evtenabled from pg_event_trigger order by 2;

select 'default_acl', defaclrole::regrole, coalesce(defaclnamespace::regnamespace::text, ''), defaclobjtype,
       defaclacl::text
  from pg_default_acl order by 2, 3, 4;

select 'type', n.nspname, t.typname, t.typtype,
       coalesce((select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = t.oid), '')
  from pg_type t join (select oid, nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') n on n.oid = t.typnamespace
  where t.typtype in ('e','d','c') and (t.typtype <> 'c' or exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c'))
    and not exists (select 1 from (select classid, objid from pg_depend where deptype = 'e') e where e.classid = 'pg_type'::regclass and e.objid = t.oid)
  order by 2, 3;

-- Las secuencias no siguen el snapshot (su valor puede avanzar mientras se vuelca), así que no se compara el valor:
-- se comprueba que ninguna quede por detrás del máximo de la columna que alimenta.
select format('select ''sequence'', %L, %L, (select coalesce(last_value, 0) from pg_sequences where schemaname = %L and sequencename = %L) >= coalesce((select max(%I) from %I.%I), 0)',
              sn.nspname, sc.relname, sn.nspname, sc.relname, a.attname, tn.nspname, tc.relname)
  from pg_depend d
  join pg_class sc on sc.oid = d.objid and sc.relkind = 'S'
  join pg_namespace sn on sn.oid = sc.relnamespace
  join pg_class tc on tc.oid = d.refobjid
  join pg_namespace tn on tn.oid = tc.relnamespace
  join pg_attribute a on a.attrelid = tc.oid and a.attnum = d.refobjsubid
  where d.deptype in ('a', 'i') and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
    and sn.nspname !~ '^pg_' and sn.nspname <> 'information_schema'
  order by sn.nspname, sc.relname
\gexec

-- Datos: recuento y md5 de todas las filas de cada tabla (incluye tablas de configuración de extensiones).
select format('select ''data'', %L, %L, count(*), coalesce(md5(string_agg(t::text, E''\n'' order by t::text)), '''') from %I.%I t',
              n.nspname, c.relname, n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
  order by n.nspname, c.relname
\gexec
