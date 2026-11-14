import { newIdempotencyKey } from '../utils/reservationTotals';
import { checkImage, offerImageKey, type CheckedImage, type ImageCandidate, type ImageCheckError } from './imagePolicy';

// Almacenamiento de fotos detrás de una interfaz. No hay bucket confirmado en el tenant, así que el
// adaptador por defecto rechaza las subidas; las pruebas usan el adaptador en memoria. Siguiendo
// AGENTS.md, el resultado conserva `url` y `key`: la clave permite borrar el archivo más tarde.

export type StoredObject = { url: string; key: string };

export interface MediaStorage {
  readonly configured: boolean;
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
}

export class MediaUploadError extends Error {
  constructor(readonly code: ImageCheckError | 'storage_not_configured' | 'upload_failed') {
    super(code);
    this.name = 'MediaUploadError';
  }
}

export const disabledMediaStorage: MediaStorage = {
  configured: false,
  async upload() {
    throw new MediaUploadError('storage_not_configured');
  },
  async remove() {
    throw new MediaUploadError('storage_not_configured');
  },
};

export function createMemoryMediaStorage(baseUrl = 'memory://offer-media'): MediaStorage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    configured: true,
    objects,
    async upload(key, bytes) {
      objects.set(key, bytes);
      return { url: `${baseUrl}/${key}`, key };
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

// Valida, genera la clave y sube. Devuelve lo que hay que registrar con el RPC de la oferta.
export async function uploadOfferImage(
  storage: MediaStorage,
  offerId: string,
  candidate: ImageCandidate,
  uniqueId: string = newIdempotencyKey(),
): Promise<StoredObject & CheckedImage> {
  if (!storage.configured) throw new MediaUploadError('storage_not_configured');
  const checked = checkImage(candidate);
  if (!checked.ok) throw new MediaUploadError(checked.error);
  const key = offerImageKey(offerId, uniqueId, checked.image.extension);
  let stored: StoredObject;
  try {
    stored = await storage.upload(key, candidate.bytes, checked.image.type);
  } catch (error) {
    if (error instanceof MediaUploadError) throw error;
    throw new MediaUploadError('upload_failed');
  }
  return { ...stored, ...checked.image };
}
