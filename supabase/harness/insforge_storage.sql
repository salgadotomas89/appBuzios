-- Emulación local del esquema storage de InsForge para los harnesses (no se aplica en ningún tenant). Columnas,
-- public_buckets() y las cuatro políticas por defecto copiadas de buziosflow el 15-11-2026, con RLS activo y la
-- tabla de propiedad de postgres, como allí. Única adaptación: auth.jwt() arma los claims desde
-- request.jwt.claim.sub, que es lo que usan los harnesses para auth.uid().
create schema if not exists storage;
create table storage.buckets (
  name text primary key, public boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table storage.objects (
  bucket text not null references storage.buckets(name), key text not null, size integer not null, mime_type text,
  uploaded_at timestamptz default now(), uploaded_by text, uploaded_via text not null default 'rest',
  s3_access_key_id text, etag text, primary key (bucket, key)
);
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('sub', nullif(current_setting('request.jwt.claim.sub', true), '')) $$;
create function storage.public_buckets() returns text[] language sql stable security definer as $$
  select coalesce(array_agg(b.name), '{}'::text[]) from storage.buckets b where b.public $$;
alter table storage.objects enable row level security;
create policy storage_objects_owner_select on storage.objects for select to authenticated
  using ((uploaded_by = (select (auth.jwt() ->> 'sub'::text))) or ((select storage.public_buckets()) @> array[bucket]));
create policy storage_objects_owner_insert on storage.objects for insert to authenticated
  with check (uploaded_by = (select (auth.jwt() ->> 'sub'::text)));
create policy storage_objects_owner_update on storage.objects for update to authenticated
  using (uploaded_by = (select (auth.jwt() ->> 'sub'::text))) with check (uploaded_by = (select (auth.jwt() ->> 'sub'::text)));
create policy storage_objects_owner_delete on storage.objects for delete to authenticated
  using (uploaded_by = (select (auth.jwt() ->> 'sub'::text)));
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function auth.jwt() to anon, authenticated;
