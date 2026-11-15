-- Índices para las claves foráneas que recorren las consultas frecuentes, señalados por el advisor de InsForge
-- en buziosflow (15-11-2026). Las tablas están vacías, así que crearlos dentro de la transacción de la migración
-- no bloquea a nadie. Se omiten los que el advisor sugiere sobre columnas de baja selectividad (rol, publicada,
-- estado de moderación) y los de columnas de auditoría que nunca se filtran.

create index if not exists connectical_quotes_offer_idx on public.connectical_quotes (offer_id);
create index if not exists connectical_quotes_traveler_idx on public.connectical_quotes (traveler_user_id);
create index if not exists connectical_offers_provider_idx on public.connectical_offers (provider_id);
create index if not exists connectical_reservation_events_reservation_idx
  on public.connectical_reservation_events (reservation_id, created_at desc);
create index if not exists connectical_incidents_reservation_idx on public.connectical_incidents (reservation_id);
create index if not exists connectical_incidents_reporter_idx on public.connectical_incidents (reporter_user_id, created_at desc);
