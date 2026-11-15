/* eslint-disable no-bitwise -- leer cabeceras binarias de imágenes */
// Función de InsForge `offer-media`: único camino para subir, servir y borrar fotos de ofertas mientras InsForge
// 2.3.5 no permita aplicar las políticas de storage.objects (ver docs/runbook-insforge-ensayo.md).
//
// El bucket es PRIVADO y solo esta función lo toca con la clave de API. Quién puede hacer qué lo decide la base:
//   POST   /offers/<oferta>        bytes de la imagen (cuerpo), cabecera X-Alt-Text (URI-encoded). Sube con la
//                                  clave de API y registra con connectical_add_offer_media EN NOMBRE DEL USUARIO;
//                                  si la base lo rechaza (no gestiona la oferta, límite, etc.), borra el archivo.
//   GET    /offers/<oferta>/<id>.<ext>  sirve la foto solo si el llamante la ve por RLS en connectical_offer_media
//                                  (publicada y aprobada para cualquiera; dueño y admin, todas).
//   DELETE /media/<id de la foto>  connectical_remove_offer_media como el usuario y después borra el archivo.
//   POST   /maintenance/cleanup    solo con la clave de API (schedule): borra archivos sin foto registrada con más
//                                  de una hora, incluidos los que un usuario suba directamente al bucket.
// El tipo y las medidas se leen de los bytes (firma y cabecera del formato), nunca del nombre ni de lo declarado.
// Es un único archivo porque `functions deploy` publica un archivo; las reglas de imagen repiten las de
// src/media/imagePolicy.ts y una prueba comprueba que coinciden.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 600;
export const MAX_IMAGE_SIDE = 6000;
export const MAX_ALT_TEXT = 160;
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
export const OFFER_MEDIA_BUCKET = 'offer-media';

const EXTENSIONS: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MEDIA_KEY = new RegExp(`^offers/(${UUID})/(${UUID})\\.(jpg|png|webp)$`);

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (bytes.length >= 3 && starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

// Medidas declaradas en la cabecera de cada formato; null si la cabecera no se puede leer.
export function readImageSize(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  if (type === 'image/png') {
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return { width, height };
  }
  if (type === 'image/webp') {
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    return null;
  }
  // JPEG: recorre los segmentos hasta el primer SOF (C0–CF salvo C4, C8 y CC).
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(i + 7), height: u16be(i + 5) };
    }
    i += 2 + u16be(i + 2);
  }
  return null;
}

export type CallerResult = { data: unknown; error: { message: string } | null };
export interface Caller {
  rpc(name: string, args: Record<string, unknown>): Promise<CallerResult>;
  // URL y tipo de las fotos de la oferta que este llamante puede ver por RLS.
  visibleMedia(offerId: string): Promise<{ url: string; content_type: string }[]>;
}
export interface AdminStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(keys: string[]): Promise<void>;
  list(): Promise<{ key: string; uploadedAt: string }[]>;
  registeredKeys(keys: string[]): Promise<Set<string>>;
}
export interface OfferMediaDeps {
  admin: AdminStore;
  callerFor(token: string | null): Caller;
  apiKey: string;
  publicBaseUrl: string; // la misma que connectical_settings.media_public_base_url
  newId(): string;
  now(): number;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Alt-Text',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Errores de las RPC (mensaje de la excepción de PostgreSQL) → estado HTTP.
const RPC_STATUS: Record<string, number> = {
  authentication_required: 401,
  offer_not_owned: 403,
  media_not_found: 404,
  media_limit_reached: 409,
  invalid_media: 422,
  media_storage_not_configured: 503,
};
function rpcFailure(error: { message: string }) {
  const code = Object.keys(RPC_STATUS).find(name => error.message.includes(name));
  return json(code ? RPC_STATUS[code] : 502, { error: code ?? 'database_error' });
}

function bearer(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await req.arrayBuffer());
  return bytes.length > MAX_IMAGE_BYTES ? null : bytes;
}

export function createOfferMediaHandler(deps: OfferMediaDeps): (req: Request) => Promise<Response> {
  const base = deps.publicBaseUrl.replace(/\/+$/, '');

  async function upload(req: Request, offerId: string, token: string | null) {
    if (!token || sameSecret(token, deps.apiKey)) return json(401, { error: 'authentication_required' });
    const bytes = await readBody(req);
    if (!bytes) return json(413, { error: 'image_too_large' });
    if (!bytes.length) return json(422, { error: 'image_empty' });
    const type = detectImageType(bytes);
    if (!type) return json(422, { error: 'image_type_not_allowed' });
    const size = readImageSize(bytes, type);
    if (!size || ![size.width, size.height].every(side => side >= MIN_IMAGE_SIDE && side <= MAX_IMAGE_SIDE)) {
      return json(422, { error: 'image_dimensions' });
    }
    let altText: string;
    try {
      altText = decodeURIComponent(req.headers.get('X-Alt-Text') ?? '').trim();
    } catch {
      altText = '';
    }
    if (!altText || altText.length > MAX_ALT_TEXT) return json(422, { error: 'image_alt_required' });

    const key = `offers/${offerId}/${deps.newId().toLowerCase()}.${EXTENSIONS[type]}`;
    if (!MEDIA_KEY.test(key)) return json(500, { error: 'invalid_key' });
    try {
      await deps.admin.put(key, bytes, type);
    } catch {
      return json(502, { error: 'upload_failed' });
    }
    const { data, error } = await deps.callerFor(token).rpc('connectical_add_offer_media', {
      p_offer_id: offerId, p_storage_key: key, p_content_type: type, p_byte_size: bytes.length,
      p_width: size.width, p_height: size.height, p_alt_text: altText,
    });
    if (error) {
      await deps.admin.remove([key]).catch(() => undefined); // si falla, la limpieza lo recoge
      return rpcFailure(error);
    }
    return json(201, { id: data, key, url: `${base}/${key}`, contentType: type, width: size.width, height: size.height });
  }

  async function serve(key: string, offerId: string, token: string | null) {
    const caller = deps.callerFor(token && !sameSecret(token, deps.apiKey) ? token : null);
    const url = `${base}/${key}`;
    const row = (await caller.visibleMedia(offerId)).find(media => media.url === url);
    if (!row) return json(404, { error: 'media_not_found' });
    const bytes = await deps.admin.get(key);
    if (!bytes) return json(404, { error: 'media_not_found' });
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': row.content_type,
        'Content-Length': String(bytes.length),
        // Sin sesión solo se ven fotos publicadas; con sesión puede ser una foto aún no aprobada.
        'Cache-Control': token ? 'private, no-store' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  }

  async function remove(mediaId: string, token: string | null) {
    if (!token || sameSecret(token, deps.apiKey)) return json(401, { error: 'authentication_required' });
    const { data, error } = await deps.callerFor(token).rpc('connectical_remove_offer_media', { p_media_id: mediaId });
    if (error) return rpcFailure(error);
    const key = typeof data === 'string' ? data : '';
    // La fila ya no existe; si borrar el archivo falla, la limpieza lo recoge.
    const removed = MEDIA_KEY.test(key) && (await deps.admin.remove([key]).then(() => true, () => false));
    return json(200, { removed: true, fileRemoved: removed });
  }

  async function cleanup(token: string | null) {
    if (!token || !sameSecret(token, deps.apiKey)) return json(401, { error: 'authentication_required' });
    const cutoff = deps.now() - ORPHAN_AGE_MS;
    const old = (await deps.admin.list()).filter(object => Date.parse(object.uploadedAt) < cutoff);
    const registered = await deps.admin.registeredKeys(old.map(object => object.key).filter(key => MEDIA_KEY.test(key)));
    const orphans = old.map(object => object.key).filter(key => !registered.has(key));
    if (orphans.length) await deps.admin.remove(orphans);
    return json(200, { checked: old.length, removed: orphans.length });
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname.replace(/^\/+|\/+$/g, '');
    const token = bearer(req);
    try {
      const uploadMatch = new RegExp(`^offers/(${UUID})$`).exec(path);
      if (req.method === 'POST' && uploadMatch) return await upload(req, uploadMatch[1], token);
      const keyMatch = MEDIA_KEY.exec(path);
      if (req.method === 'GET' && keyMatch) return await serve(path, keyMatch[1], token);
      const mediaMatch = new RegExp(`^media/(${UUID})$`).exec(path);
      if (req.method === 'DELETE' && mediaMatch) return await remove(mediaMatch[1], token);
      if (req.method === 'POST' && path === 'maintenance/cleanup') return await cleanup(token);
      return json(404, { error: 'not_found' });
    } catch {
      return json(500, { error: 'internal_error' });
    }
  };
}

// --- Despliegue en InsForge (Deno). Las pruebas no llegan aquí. ---------------------------------------------------
declare const Deno: { env: { get(name: string): string | undefined } };
declare const crypto: { randomUUID(): string };
type SdkClient = {
  storage: { from(bucket: string): {
    upload(key: string, file: Blob): Promise<{ data: { key?: string } | null; error: { message: string } | null }>;
    download(key: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string; statusCode?: number } | null }>;
    remove(keys: string[]): Promise<{ error: { message: string } | null }>;
    list(options: { limit: number; offset: number }): Promise<{
      data: { objects: { key: string; uploadedAt: string }[] } | null; error: { message: string } | null }>;
  } };
  database: {
    rpc(name: string, args: Record<string, unknown>): Promise<CallerResult>;
    from(table: string): { select(columns: string): {
      eq(column: string, value: string): Promise<{ data: { url: string; content_type: string }[] | null; error: unknown }>;
      in(column: string, values: string[]): Promise<{ data: { storage_key: string }[] | null; error: unknown }>;
    } };
  };
};
const SDK_MODULE = 'npm:@insforge/sdk@1.5.2';
let deployedHandler: ((req: Request) => Promise<Response>) | null = null;

// https://<app>.<región>.insforge.app → https://<app>.function2.insforge.app/offer-media (como el SDK).
export function functionsBaseUrl(baseUrl: string): string {
  const match = /^https:\/\/([a-z0-9]+)\.[a-z0-9-]+\.insforge\.app\/?$/.exec(baseUrl);
  return match ? `https://${match[1]}.function2.insforge.app/offer-media` : '';
}

async function deployedDeps(): Promise<OfferMediaDeps> {
  const { createClient } = (await import(SDK_MODULE)) as {
    createClient(config: Record<string, unknown>): SdkClient;
  };
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL') ?? '';
  const apiKey = Deno.env.get('API_KEY') ?? '';
  const anonKey = Deno.env.get('ANON_KEY') ?? '';
  const publicBaseUrl = Deno.env.get('OFFER_MEDIA_PUBLIC_BASE_URL') ?? functionsBaseUrl(baseUrl);
  if (!baseUrl || !apiKey || !anonKey || !publicBaseUrl) throw new Error('offer-media is not configured');
  const admin = createClient({ baseUrl, anonKey: apiKey, isServerMode: true });
  const bucket = admin.storage.from(OFFER_MEDIA_BUCKET);
  return {
    apiKey,
    publicBaseUrl,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    callerFor(token) {
      const client = createClient(token ? { baseUrl, anonKey, accessToken: token, isServerMode: true } : { baseUrl, anonKey, isServerMode: true });
      return {
        rpc: (name, args) => client.database.rpc(name, args),
        async visibleMedia(offerId) {
          const { data, error } = await client.database.from('connectical_offer_media').select('url, content_type').eq('offer_id', offerId);
          if (error) throw new Error('media lookup failed');
          return data ?? [];
        },
      };
    },
    admin: {
      async put(key, bytes, contentType) {
        const { data, error } = await bucket.upload(key, new Blob([bytes as unknown as Blob], { type: contentType, lastModified: Date.now() }));
        if (error) throw new Error(error.message);
        if (data?.key && data.key !== key) {
          await bucket.remove([data.key]);
          throw new Error('stored under another key');
        }
      },
      async get(key) {
        const { data, error } = await bucket.download(key);
        if (error?.statusCode === 404) return null;
        if (error || !data) throw new Error('download failed');
        return new Uint8Array(await data.arrayBuffer());
      },
      async remove(keys) {
        const { error } = await bucket.remove(keys);
        if (error) throw new Error(error.message);
      },
      async list() {
        const objects: { key: string; uploadedAt: string }[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await bucket.list({ limit: 1000, offset });
          if (error || !data) throw new Error('list failed');
          objects.push(...data.objects.map(({ key, uploadedAt }) => ({ key, uploadedAt })));
          if (data.objects.length < 1000) return objects;
        }
      },
      async registeredKeys(keys) {
        if (!keys.length) return new Set();
        const { data, error } = await admin.database.from('connectical_offer_media').select('storage_key').in('storage_key', keys);
        if (error || !data) throw new Error('registered lookup failed');
        return new Set(data.map(row => row.storage_key));
      },
    },
  };
}

export default async function offerMedia(req: Request): Promise<Response> {
  if (!deployedHandler) {
    try {
      deployedHandler = createOfferMediaHandler(await deployedDeps());
    } catch {
      return json(503, { error: 'offer_media_not_configured' });
    }
  }
  return deployedHandler(req);
}
