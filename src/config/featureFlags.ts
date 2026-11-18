// Interruptores de funcionalidades que dependen del backend compartido.
//
// SHARED_CATALOG_ENABLED suma al catálogo de la demo las ofertas publicadas en InsForge
// (tablas connectical_*). Desde el 17-11-2026 buziosflow tiene las 26 migraciones aplicadas: se enciende en los
// builds de desarrollo (__DEV__: `npm run ios` en el simulador), que son la versión de ensayo, y sigue apagado en
// release hasta decidir el lanzamiento. Los pagos son simulados en ambos casos.
// Es una constante y no una variable de .env porque react-native-dotenv está configurado con
// allowUndefined: false y una variable nueva rompería cualquier .env local existente.
export const SHARED_CATALOG_ENABLED: boolean = __DEV__;

// OFFER_PHOTOS_ENABLED muestra a los proveedores el gestor de fotos (src/components/OfferPhotoManager.tsx), que sube
// por la función offer-media. Desde el 17-11-2026 buziosflow tiene migraciones, bucket privado, función, URL y limpieza
// (docs/despliegue-fotos.md, pasos 1-7). Encendido solo en builds de desarrollo, que son la «build de prueba con la
// bandera encendida» del paso 11; en release sigue apagado hasta completar la verificación con cuentas del equipo y
// las pruebas en un iPhone y un Android reales.
export const OFFER_PHOTOS_ENABLED: boolean = __DEV__;

// CANCELLATION_POLICY_ENABLED permitiría mostrar la propuesta de src/utils/cancellationPolicy.ts.
// No existe una política comercial aprobada, así que no hay ninguna política cargada y ningún flujo
// lo consulta todavía. No cambiarlo sin una política aprobada por escrito.
export const CANCELLATION_POLICY_ENABLED = false;

// Pagos reales: dos controles independientes que deben estar encendidos a la vez, además de un
// adaptador en vivo implementado (src/payments/gateways.ts, hoy ninguno). Sin contrato con una
// pasarela ni tarifas confirmadas, ambos quedan apagados y vacíos.
export const REAL_PAYMENTS_ENABLED = false;
export const LIVE_PAYMENT_GATEWAYS: readonly ('simulated_gateway' | 'mercado_pago')[] = [];
