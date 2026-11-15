// Selección de fotos de ofertas desde la galería o la cámara (react-native-image-picker). Devuelve los bytes
// reales de cada foto para validarlos con imagePolicy y enviarlos a la función offer-media; nunca sube nada.
//
// El selector reduce las fotos a 2400 px como máximo por lado y las recomprime en JPEG (calidad 0,8): una foto
// de 12 MP de la cámara pesaría más de 5 MB. En iOS, `compatible` convierte HEIC a JPEG. Las medidas y el tipo
// que importan son los de los bytes: el selector solo los informa.
import {
  launchCamera,
  launchImageLibrary,
  type CameraOptions,
  type ImageLibraryOptions,
  type ImagePickerResponse,
} from 'react-native-image-picker';

export type PickSource = 'library' | 'camera';
export type PickFailure = 'camera_unavailable' | 'permission' | 'picker_failed';
export type PickedPhoto = { localId: string; uri: string; bytes: Uint8Array; width: number; height: number };
export type PickResult = { status: 'picked'; photos: PickedPhoto[] } | { status: 'cancelled' } | { status: 'failed'; error: PickFailure };

export type Launchers = {
  launchCamera(options: CameraOptions): Promise<ImagePickerResponse>;
  launchImageLibrary(options: ImageLibraryOptions): Promise<ImagePickerResponse>;
};

const COMMON = {
  mediaType: 'photo',
  includeBase64: true,
  maxWidth: 2400,
  maxHeight: 2400,
  quality: 0.8,
  assetRepresentationMode: 'compatible',
} as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) LOOKUP[ALPHABET.charCodeAt(index)] = index;

// Base64 estándar a bytes, sin depender de atob ni de Buffer (no siempre existen en React Native). Una foto de
// 5 MB son unos 7 millones de caracteres: se recorre una vez con una tabla por código de carácter.
export function base64ToBytes(base64: string): Uint8Array | null {
  const clean = base64.replace(/\s+/g, '').replace(/[=]+$/, '');
  if (clean.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const code = clean.charCodeAt(index);
    const value = code < 128 ? LOOKUP[code] : -1;
    if (value < 0) return null;
    buffer = ((buffer << 6) | value) & 0xffffff; // eslint-disable-line no-bitwise
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (buffer >> bits) & 0xff; // eslint-disable-line no-bitwise
      out += 1;
    }
  }
  return bytes;
}

let sequence = 0;

export async function pickPhotos(source: PickSource, limit: number, launchers: Launchers = { launchCamera, launchImageLibrary }): Promise<PickResult> {
  if (limit < 1) return { status: 'cancelled' };
  let response: ImagePickerResponse;
  try {
    response = source === 'camera'
      ? await launchers.launchCamera({ ...COMMON, saveToPhotos: false })
      : await launchers.launchImageLibrary({ ...COMMON, selectionLimit: limit, restrictMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
  } catch {
    return { status: 'failed', error: 'picker_failed' };
  }
  if (response.didCancel) return { status: 'cancelled' };
  if (response.errorCode) {
    return { status: 'failed', error: response.errorCode === 'others' ? 'picker_failed' : response.errorCode };
  }
  const photos: PickedPhoto[] = [];
  for (const asset of (response.assets ?? []).slice(0, limit)) {
    const bytes = asset.base64 ? base64ToBytes(asset.base64) : null;
    if (!bytes || !asset.uri) continue;
    sequence += 1;
    photos.push({ localId: `local-${sequence}`, uri: asset.uri, bytes, width: asset.width ?? 0, height: asset.height ?? 0 });
  }
  return photos.length ? { status: 'picked', photos } : { status: 'failed', error: 'picker_failed' };
}
