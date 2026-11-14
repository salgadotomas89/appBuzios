// Interruptores de funcionalidades que dependen del backend compartido.
//
// SHARED_CATALOG_ENABLED suma al catálogo de la demo las ofertas publicadas en InsForge
// (tablas connectical_*). Queda apagado hasta aplicar las migraciones en un tenant de ensayo
// confirmado; mientras tanto la app muestra solo el catálogo de ejemplo de homeMock.
// Es una constante y no una variable de .env porque react-native-dotenv está configurado con
// allowUndefined: false y una variable nueva rompería cualquier .env local existente.
export const SHARED_CATALOG_ENABLED = false;
