// Cliente de la función offer-media (functions/offer-media.ts): la app sube y borra fotos a través de ella, nunca
// directamente al bucket. La función valida la imagen otra vez, decide con la base si el usuario gestiona la oferta y
// registra la foto; aquí solo se comprueba antes de enviar para dar un error claro sin gastar datos.
import { checkImage, type ImageCandidate, type ImageCheckError } from './imagePolicy';

export type GatewayFailure =
  | ImageCheckError
  | 'not_signed_in'
  | 'not_allowed'
  | 'limit_reached'
  | 'storage_not_configured'
  | 'rejected'
  | 'network';

export class OfferMediaGatewayError extends Error {
  constructor(readonly code: GatewayFailure) {
    super(code);
    this.name = 'OfferMediaGatewayError';
  }
}

export type UploadedOfferPhoto = { id: string; key: string; url: string; contentType: string; width: number; height: number };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

const STATUS: Record<number, GatewayFailure> = { 401: 'not_signed_in', 403: 'not_allowed', 409: 'limit_reached', 503: 'storage_not_configured' };

export function createOfferMediaGateway(options: {
  functionUrl: string; // https://<app>.function2.insforge.app/offer-media
  getAccessToken: () => Promise<string | null>;
  fetch?: FetchLike;
}) {
  const base = options.functionUrl.replace(/\/+$/, '');
  const send: FetchLike = options.fetch ?? ((url, init) => fetch(url, init as RequestInit));

  async function call(method: string, path: string, body?: Uint8Array, extra: Record<string, string> = {}) {
    const token = await options.getAccessToken();
    if (!token) throw new OfferMediaGatewayError('not_signed_in');
    let response;
    try {
      response = await send(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...extra }, body });
    } catch {
      throw new OfferMediaGatewayError('network');
    }
    if (response.status >= 200 && response.status < 300) return response.json();
    throw new OfferMediaGatewayError(STATUS[response.status] ?? 'rejected');
  }

  return {
    async upload(offerId: string, candidate: ImageCandidate): Promise<UploadedOfferPhoto> {
      const checked = checkImage(candidate);
      if (!checked.ok) throw new OfferMediaGatewayError(checked.error);
      return (await call('POST', `offers/${encodeURIComponent(offerId)}`, candidate.bytes, {
        'Content-Type': checked.image.type,
        'X-Alt-Text': encodeURIComponent(checked.image.altText),
      })) as UploadedOfferPhoto;
    },
    async remove(mediaId: string): Promise<void> {
      await call('DELETE', `media/${encodeURIComponent(mediaId)}`);
    },
  };
}
