// Reglas para las fotos de ofertas, comprobadas antes de subir y repetidas en PostgreSQL.
// El tipo se deduce de los primeros bytes del archivo: el tipo declarado por el sistema o el nombre
// no son fiables.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 600;
export const MAX_IMAGE_SIDE = 6000;
export const MAX_IMAGES_PER_OFFER = 10;
export const MAX_ALT_TEXT = 160;

const EXTENSIONS: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type ImageCheckError =
  | 'image_empty'
  | 'image_too_large'
  | 'image_type_not_allowed'
  | 'image_dimensions'
  | 'image_alt_required';

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export type ImageCandidate = { bytes: Uint8Array; width: number; height: number; altText: string };
export type CheckedImage = { type: ImageType; extension: string; byteSize: number; width: number; height: number; altText: string };

export function checkImage(candidate: ImageCandidate): { ok: true; image: CheckedImage } | { ok: false; error: ImageCheckError } {
  if (!candidate.bytes.length) return { ok: false, error: 'image_empty' };
  if (candidate.bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_large' };
  const type = detectImageType(candidate.bytes);
  if (!type) return { ok: false, error: 'image_type_not_allowed' };
  const sides = [candidate.width, candidate.height];
  if (!sides.every(side => Number.isInteger(side) && side >= MIN_IMAGE_SIDE && side <= MAX_IMAGE_SIDE)) {
    return { ok: false, error: 'image_dimensions' };
  }
  // Texto alternativo obligatorio: lectores de pantalla y conexiones lentas.
  const altText = candidate.altText.trim();
  if (!altText || altText.length > MAX_ALT_TEXT) return { ok: false, error: 'image_alt_required' };
  return {
    ok: true,
    image: { type, extension: EXTENSIONS[type], byteSize: candidate.bytes.length, width: candidate.width, height: candidate.height, altText },
  };
}

// Clave de almacenamiento: nunca deriva del nombre del archivo del usuario.
export function offerImageKey(offerId: string, uniqueId: string, extension: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(offerId) || !/^[0-9a-f-]{36}$/i.test(uniqueId) || !/^(jpg|png|webp)$/.test(extension)) {
    throw new Error('invalid_image_key');
  }
  return `offers/${offerId.toLowerCase()}/${uniqueId.toLowerCase()}.${extension}`;
}
