import { useEffect, useMemo, useState } from 'react';
import { isInsforgeConfigured } from '../lib/insforge';
import {
  listPublishedAvailability,
  PUBLISHED_AVAILABILITY_LIMIT,
  listActivePromotions,
  listSharedOffers,
  type SharedInventory,
  type SharedOffer,
  type SharedPromotion,
} from '../lib/reservationService';
import {
  listFeed,
  listOfferMedia,
  listProviderProfiles,
  type FeedPost,
  type OfferMedia,
  type PublicProviderProfile,
} from '../lib/platformService';
import { buziosIsoDate } from '../utils/portalInput';
import { buildCatalog, type Catalog } from './catalog';
import { homeMock } from './homeMock';

// Extras del catálogo (promociones, novedades, perfiles): si fallan, incluso de forma síncrona, el catálogo sigue.
function optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  return Promise.resolve()
    .then(load)
    .catch(() => fallback);
}

export type CatalogSource = 'demo' | 'loading' | 'shared' | 'demo_fallback';

// Con el flag apagado o sin InsForge configurado devuelve el catálogo de ejemplo sin tocar la red.
// Si la lectura falla, sigue con el ejemplo e informa 'demo_fallback' para que la pantalla lo diga.
export function useCatalog(sharedEnabled: boolean): Catalog & { source: CatalogSource; feed: FeedPost[] } {
  const active = sharedEnabled && isInsforgeConfigured();
  const [shared, setShared] = useState<{
    offers: SharedOffer[];
    inventory: SharedInventory[] | null;
    media: OfferMedia[];
    promotions: SharedPromotion[];
    profiles: PublicProviderProfile[];
  } | null>(null);
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [source, setSource] = useState<CatalogSource>(active ? 'loading' : 'demo');

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    (async () => {
      try {
        const offers = await listSharedOffers();
        // Sin inventario el catálogo sigue siendo útil; la disponibilidad se confirma en el portal.
        const rows = await listPublishedAvailability(buziosIsoDate(), offers.map(offer => offer.id)).catch(() => null);
        // Una lectura truncada podría omitir el cupo de alguna oferta y mostrarla sin cupo:
        // en ese caso la disponibilidad queda por confirmar en el portal.
        const inventory = rows && rows.length < PUBLISHED_AVAILABILITY_LIMIT ? rows : null;
        // Sin fotos la oferta se muestra con su ilustración de categoría.
        const media = await listOfferMedia(offers.map(offer => offer.id)).catch(() => []);
        // Sin promociones se muestra el precio base; la cotización del servidor aplica la vigente igualmente.
        const promotions = await optional(listActivePromotions, []);
        // Novedades moderadas; sin ellas la portada sigue igual.
        const posts = await optional(listFeed, []);
        const profiles = await optional(() => listProviderProfiles([...new Set(offers.map(offer => offer.provider_id))]), []);
        if (!mounted) return;
        setShared({ offers, inventory, media, promotions, profiles });
        setFeed(posts);
        setSource('shared');
      } catch {
        if (mounted) setSource('demo_fallback');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [active]);

  const catalog = useMemo(
    () => buildCatalog(homeMock.offers, homeMock.categories, shared, buziosIsoDate()),
    [shared],
  );
  return { ...catalog, source, feed };
}
