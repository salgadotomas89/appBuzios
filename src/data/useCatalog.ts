import { useEffect, useMemo, useState } from 'react';
import { isInsforgeConfigured } from '../lib/insforge';
import {
  listPublishedAvailability,
  PUBLISHED_AVAILABILITY_LIMIT,
  listSharedOffers,
  type SharedInventory,
  type SharedOffer,
} from '../lib/reservationService';
import { buziosIsoDate } from '../utils/portalInput';
import { buildCatalog, type Catalog } from './catalog';
import { homeMock } from './homeMock';

export type CatalogSource = 'demo' | 'loading' | 'shared' | 'demo_fallback';

// Con el flag apagado o sin InsForge configurado devuelve el catálogo de ejemplo sin tocar la red.
// Si la lectura falla, sigue con el ejemplo e informa 'demo_fallback' para que la pantalla lo diga.
export function useCatalog(sharedEnabled: boolean): Catalog & { source: CatalogSource } {
  const active = sharedEnabled && isInsforgeConfigured();
  const [shared, setShared] = useState<{ offers: SharedOffer[]; inventory: SharedInventory[] | null } | null>(null);
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
        if (!mounted) return;
        setShared({ offers, inventory });
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
    () => buildCatalog(homeMock.offers, homeMock.categories, shared),
    [shared],
  );
  return { ...catalog, source };
}
