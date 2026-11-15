// Cliente de la función offer-media (functions/offer-media.ts): la app sube y borra fotos a través de ella, nunca
// directamente al bucket. La función valida la imagen otra vez, decide con la base si el usuario gestiona la oferta y
// registra la foto; aquí solo se comprueba antes de enviar para dar un error claro sin gastar datos.
import { checkImage, type ImageCandidate, type ImageCheckError } from './imagePolicy';

export type GatewayFailure =
  | ImageCheckError
  | 'not_signed_in'
  | 'not_allowed'
  | 'limit_reached'
  | 'rate_limited'
  | 'storage_not_configured'
  | 'rejected'
  | 'network'
  | 'cancelled';

export class OfferMediaGatewayError extends Error {
  constructor(readonly code: GatewayFailure) {
    super(code);
    this.name = 'OfferMediaGatewayError';
  }
}

export type UploadedOfferPhoto = { id: string; key: string; url: string; contentType: string; width: number; height: number };

// Lo mínimo de AbortSignal que hace falta (los tipos de React Native no lo declaran entero).
export type CancelSignal = { readonly aborted: boolean; addEventListener(type: 'abort', listener: () => void): void };
export type TransportRequest = { method: string; url: string; headers: Record<string, string>; body?: Uint8Array };
export type TransportOptions = { onProgress?: (fraction: number) => void; signal?: CancelSignal };
export type TransportResponse = { status: number; json(): Promise<unknown> };
export type Transport = (request: TransportRequest, options: TransportOptions) => Promise<TransportResponse>;

export class TransportCancelled extends Error {}

export type XhrLike = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: unknown): void;
  abort(): void;
  status: number;
  responseText: string;
  timeout: number;
  upload?: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
};
declare const XMLHttpRequest: new () => XhrLike;

// XMLHttpRequest en lugar de fetch: es lo único que informa del progreso de la subida en React Native y se puede
// abortar. React Native envía un Uint8Array como cuerpo binario.
export function xhrTransport(createXhr: () => XhrLike = () => new XMLHttpRequest()): Transport {
  return (request, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new TransportCancelled());
        return;
      }
      const xhr = createXhr();
      xhr.open(request.method, request.url);
      Object.entries(request.headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.timeout = 120000;
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = event => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
        };
      }
      xhr.onload = () =>
        resolve({ status: xhr.status, json: async () => (xhr.responseText ? JSON.parse(xhr.responseText) : null) });
      xhr.onerror = () => reject(new Error('network'));
      xhr.ontimeout = () => reject(new Error('network'));
      xhr.onabort = () => reject(new TransportCancelled());
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(request.body);
    });
}

const STATUS: Record<number, GatewayFailure> = {
  401: 'not_signed_in',
  403: 'not_allowed',
  409: 'limit_reached',
  413: 'image_too_large',
  429: 'rate_limited',
  503: 'storage_not_configured',
};

export type OfferMediaGateway = ReturnType<typeof createOfferMediaGateway>;

export function createOfferMediaGateway(options: {
  functionUrl: string; // https://<app>.function2.insforge.app/offer-media
  getAccessToken: () => Promise<string | null>;
  transport?: Transport;
}) {
  const base = options.functionUrl.replace(/\/+$/, '');
  const send = options.transport ?? xhrTransport();

  async function call(method: string, path: string, body?: Uint8Array, extra: Record<string, string> = {}, transportOptions: TransportOptions = {}) {
    const token = await options.getAccessToken();
    if (!token) throw new OfferMediaGatewayError('not_signed_in');
    let response;
    try {
      response = await send({ method, url: `${base}/${path}`, headers: { Authorization: `Bearer ${token}`, ...extra }, body }, transportOptions);
    } catch (error) {
      throw new OfferMediaGatewayError(error instanceof TransportCancelled ? 'cancelled' : 'network');
    }
    if (response.status >= 200 && response.status < 300) return response.json();
    throw new OfferMediaGatewayError(STATUS[response.status] ?? 'rejected');
  }

  return {
    // Cancelar mientras se envía el cuerpo no deja nada: la función solo escribe con el cuerpo completo. Si el
    // servidor ya lo había recibido, la foto puede quedar registrada: quien llama vuelve a leer la lista.
    async upload(offerId: string, candidate: ImageCandidate, transportOptions: TransportOptions = {}): Promise<UploadedOfferPhoto> {
      const checked = checkImage(candidate);
      if (!checked.ok) throw new OfferMediaGatewayError(checked.error);
      return (await call('POST', `offers/${encodeURIComponent(offerId)}`, candidate.bytes, {
        'Content-Type': checked.image.type,
        'X-Alt-Text': encodeURIComponent(checked.image.altText),
      }, transportOptions)) as UploadedOfferPhoto;
    },
    async remove(mediaId: string): Promise<void> {
      await call('DELETE', `media/${encodeURIComponent(mediaId)}`);
    },
  };
}
