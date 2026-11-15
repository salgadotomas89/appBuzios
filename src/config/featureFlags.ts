// Interruptores de funcionalidades que dependen del backend compartido.
//
// SHARED_CATALOG_ENABLED suma al catálogo de la demo las ofertas publicadas en InsForge
// (tablas connectical_*). Queda apagado hasta aplicar las migraciones en un tenant de ensayo
// confirmado; mientras tanto la app muestra solo el catálogo de ejemplo de homeMock.
// Es una constante y no una variable de .env porque react-native-dotenv está configurado con
// allowUndefined: false y una variable nueva rompería cualquier .env local existente.
export const SHARED_CATALOG_ENABLED = false;

// OFFER_PHOTOS_ENABLED muestra a los proveedores el gestor de fotos (src/components/OfferPhotoManager.tsx), que sube
// por la función offer-media. Queda apagado hasta desplegar en buziosflow las migraciones 202611160003/0004, el bucket
// privado, la función y su URL (docs/despliegue-fotos.md); sin eso la función no existe y cada subida fallaría.
export const OFFER_PHOTOS_ENABLED = false;

// CANCELLATION_POLICY_ENABLED permitiría mostrar la propuesta de src/utils/cancellationPolicy.ts.
// No existe una política comercial aprobada, así que no hay ninguna política cargada y ningún flujo
// lo consulta todavía. No cambiarlo sin una política aprobada por escrito.
export const CANCELLATION_POLICY_ENABLED = false;

// Pagos reales: dos controles independientes que deben estar encendidos a la vez, además de un
// adaptador en vivo implementado (src/payments/gateways.ts, hoy ninguno). Sin contrato con una
// pasarela ni tarifas confirmadas, ambos quedan apagados y vacíos.
export const REAL_PAYMENTS_ENABLED = false;
export const LIVE_PAYMENT_GATEWAYS: readonly ('simulated_gateway' | 'mercado_pago')[] = [];
