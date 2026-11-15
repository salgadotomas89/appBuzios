import { INSFORGE_URL } from '@env';
import { sessionManager } from '../lib/insforge';
import { createOfferMediaGateway, type OfferMediaGateway } from './offerMediaGateway';

// URL pública de la función offer-media a partir de la del proyecto, como hace el SDK con las funciones:
// https://<app>.<región>.insforge.app → https://<app>.function2.insforge.app/offer-media. Repite
// functionsBaseUrl de functions/offer-media.ts (que no entra en el bundle); una prueba comprueba que coinciden.
export function offerMediaFunctionUrl(baseUrl: string): string {
  const match = /^https:\/\/([a-z0-9]+)\.[a-z0-9-]+\.insforge\.app\/?$/.exec(baseUrl);
  return match ? `https://${match[1]}.function2.insforge.app/offer-media` : '';
}

// Cliente de la función con el token de la sesión vigente (en memoria, renovado si hace falta). null si el proyecto
// no está configurado o la URL no es de InsForge.
export const offerPhotoGateway: OfferMediaGateway | null = (() => {
  const functionUrl = offerMediaFunctionUrl(INSFORGE_URL ?? '');
  const manager = sessionManager;
  return manager && functionUrl
    ? createOfferMediaGateway({ functionUrl, getAccessToken: () => manager.currentAccessToken() })
    : null;
})();
