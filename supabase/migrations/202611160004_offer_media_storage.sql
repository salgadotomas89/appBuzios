-- El bucket de fotos de ofertas ('offer-media') solo lo toca la función offer-media con la clave de API.
--
-- buziosflow trae las políticas por defecto de InsForge (migración 066): cualquier usuario autenticado puede subir,
-- reemplazar o borrar en cualquier bucket los objetos que queden a su nombre (uploaded_by). Para 'offer-media' eso
-- sobra: la función valida y sube con la clave de API, que no pasa por RLS, y 202611160003 solo registra archivos
-- escritos así. Estas políticas son RESTRICTIVE y se suman a las de InsForge: ninguna sesión de usuario puede leer,
-- escribir ni borrar objetos de 'offer-media' directamente. Los demás buckets no cambian.
--
-- Se aplica con `db migrations up` como project_admin: buziosflow carga insforge_pg_utils con
-- insforge.policy_grant_role = project_admin e insforge.policy_grant_tables, que incluye storage.objects (leído el
-- 15-11-2026). Así lo ensaya scripts/lab/insforge-lab.sh con la imagen oficial de InsForge 2.3.5. Una restauración
-- sobre postgres:15 sin esa extensión responde "must be owner of table objects": ese ensayo no vale para esta
-- migración.

drop policy if exists connectical_offer_media_select on storage.objects;
create policy connectical_offer_media_select on storage.objects as restrictive for select to authenticated
  using (bucket <> 'offer-media');

drop policy if exists connectical_offer_media_insert on storage.objects;
create policy connectical_offer_media_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket <> 'offer-media');

drop policy if exists connectical_offer_media_update on storage.objects;
create policy connectical_offer_media_update on storage.objects as restrictive for update to authenticated
  using (bucket <> 'offer-media') with check (bucket <> 'offer-media');

drop policy if exists connectical_offer_media_delete on storage.objects;
create policy connectical_offer_media_delete on storage.objects as restrictive for delete to authenticated
  using (bucket <> 'offer-media');
