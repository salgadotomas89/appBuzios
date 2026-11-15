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
  constructor(readonly code: ImageCheckError | 'storage_not_configured' | 'upload_failed' | 'remove_failed') {
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

// Bucket de InsForge para las fotos de ofertas. Con supabase/migrations/202611160004_offer_media_storage.sql ninguna
// sesión de usuario puede escribir en él: la app sube por la función offer-media (src/media/offerMediaGateway.ts) y
// la base solo registra archivos que escribió la función (202611160003). Este adaptador queda para pruebas.
export const OFFER_MEDIA_BUCKET = 'offer-media';

type StorageResult<T> = { data: T | null; error: { message: string } | null };
export type InsforgeStorageLike = {
  from(bucket: string): {
    upload(key: string, file: Blob): Promise<StorageResult<{ key?: string; url?: string }>>;
    remove(key: string): Promise<StorageResult<unknown>>;
  };
};

// Adaptador real sobre el SDK. Recibe una función que devuelve el almacenamiento de un cliente con la sesión
// vigente (freshClient), porque las reglas del bucket dependen de quién sube. Si InsForge guarda el objeto con
// otra clave, se borra y se rechaza: la base solo registra claves con la forma offers/<oferta>/<uuid>.<ext>.
// Nota: React Native no construye Blob desde bytes; el selector de fotos, cuando exista, tendrá que entregar
// el archivo de otra forma. Hoy ninguna pantalla sube fotos.
export function createInsforgeMediaStorage(
  getStorage: () => Promise<InsforgeStorageLike>,
  bucket: string = OFFER_MEDIA_BUCKET,
): MediaStorage {
  return {
    configured: true,
    async upload(key, bytes, contentType) {
      const storage = (await getStorage()).from(bucket);
      // Los tipos de React Native solo admiten string o Blob como partes (ver la nota anterior); en Node y en
      // navegadores el constructor acepta los bytes.
      const file = new Blob([bytes as unknown as Blob], { type: contentType, lastModified: Date.now() });
      const { data, error } = await storage.upload(key, file);
      if (error || !data?.url) throw new MediaUploadError('upload_failed');
      if (data.key !== undefined && data.key !== key) {
        await storage.remove(data.key).catch(() => undefined);
        throw new MediaUploadError('upload_failed');
      }
      return { url: data.url, key };
    },
    async remove(key) {
      const { error } = await (await getStorage()).from(bucket).remove(key);
      if (error) throw new MediaUploadError('remove_failed');
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
