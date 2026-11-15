/* eslint-disable no-bitwise -- leer cabeceras binarias de imágenes */
// Función de InsForge `offer-media`: único camino para subir, servir y borrar fotos de ofertas. 202611160004 cierra el
// bucket a las sesiones de usuario y 202611160003 solo registra archivos escritos con la clave de API (ver
// docs/runbook-insforge-ensayo.md, «Storage: corrección»).
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
// Antes de escribir nada en el bucket se comprueba la sesión con InsForge y se limita la frecuencia por usuario (en
// memoria de cada instancia: frena ráfagas; el límite que vale para todas es el de la base, 30 por hora). Al servir,
// los bytes se vuelven a validar contra el tipo registrado. La base solo registra archivos escritos con la clave de
// API (supabase/migrations/202611160003_offer_media_gateway_only.sql), así que subir directo al bucket no publica nada.
// Es un único archivo porque `functions deploy` publica un archivo; las reglas de imagen repiten las de
// src/media/imagePolicy.ts y una prueba comprueba que coinciden.

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 600;
export const MAX_IMAGE_SIDE = 6000;
export const MAX_ALT_TEXT = 160;
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
export const OFFER_MEDIA_BUCKET = 'offer-media';
export const UPLOADS_PER_WINDOW = 20;
export const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
export const MAX_CONCURRENT_UPLOADS = 2;

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
  // Usuario de la sesión según InsForge (no se fía del contenido del token); null si no es válida.
  userId(): Promise<string | null>;
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
  media_rate_limited: 429,
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

// Los tipos de React Native no declaran Request.body; en Deno y Node es un ReadableStream.
type BodyReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
};

// Lee el cuerpo por partes y corta al pasar del máximo, aunque no declare Content-Length (envío por bloques).
async function readBody(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) return null;
  const body = (req as unknown as { body: { getReader(): BodyReader } | null }).body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// Metadatos que pueden revelar dónde y cuándo se hizo la foto (GPS de EXIF, XMP, IPTC, textos). En Android un JPEG
// que no hace falta reducir sube tal cual desde la galería, y WebP nunca se recodifica. Se quitan antes de guardar:
//   JPEG: el directorio GPS de EXIF queda vacío y sus datos a cero (la orientación se conserva: sin ella las fotos de
//         la cámara saldrían giradas); fuera los segmentos XMP y demás APP1 que no son EXIF, IPTC (APP13) y comentarios.
//   PNG:  fuera eXIf, tEXt, iTXt y zTXt.
//   WebP: fuera los bloques EXIF y XMP, con las marcas de VP8X y el tamaño de RIFF corregidos.
// Devuelve null si la estructura no es coherente (longitudes que salen del archivo): no se guarda.
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array | null {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (type === 'image/png') {
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    for (let at = 8; at < bytes.length;) {
      if (at + 12 > bytes.length) return null;
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      const end = at + 12 + length;
      if (end > bytes.length) return null;
      if (!['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(ascii(at + 4, 4))) parts.push(bytes.subarray(at, end));
      at = end;
    }
    return concat(parts);
  }
  if (type === 'image/webp') {
    const parts: Uint8Array[] = [];
    let vp8x = -1;
    let length = 12;
    for (let at = 12; at < bytes.length;) {
      if (at + 8 > bytes.length) return null;
      const size = (bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)) >>> 0;
      const end = at + 8 + size + (size % 2);
      if (end > bytes.length) return null;
      const fourcc = ascii(at, 4);
      if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
        if (fourcc === 'VP8X') vp8x = length;
        parts.push(bytes.subarray(at, end));
        length += end - at;
      }
      at = end;
    }
    const out = concat([bytes.subarray(0, 12), ...parts]);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    if (vp8x >= 0) out[vp8x + 8] &= ~0x0c; // sin marcas de EXIF (0x08) ni XMP (0x04)
    return out;
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(at)); // a partir del escaneo, datos de imagen
      return concat(parts);
    }
    if (marker === 0xff) { // relleno: el marcador real empieza en el siguiente 0xFF
      parts.push(bytes.subarray(at, at + 1));
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return null;
    const end = at + 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    if (end > bytes.length || end < at + 4) return null;
    const isExif = marker === 0xe1 && ascii(at + 4, 6) === 'Exif\0\0';
    if (isExif) {
      const segment = bytes.slice(at, end);
      if (!clearExifGps(segment, 10)) return null;
      parts.push(segment);
    } else if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) {
      parts.push(bytes.subarray(at, end));
    }
    at = end;
  }
  return concat(parts);
}

// Vacía el directorio GPS de un bloque EXIF (TIFF desde `tiff`) y pone a cero los datos a los que apuntaba.
function clearExifGps(segment: Uint8Array, tiff: number): boolean {
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  if (tiff + 8 > segment.length) return false;
  const little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  if (!little && !(segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d)) return false;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > segment.length) return false;
  const entries = u16(ifd0);
  if (ifd0 + 2 + entries * 12 > segment.length) return false;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd0 + 2 + index * 12;
    if (u16(entry) !== 0x8825) continue;
    const gps = tiff + u32(entry + 8);
    if (gps + 2 > segment.length) return false;
    const count = u16(gps);
    if (gps + 2 + count * 12 > segment.length) return false;
    const unit: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    for (let item = 0; item < count; item += 1) {
      const field = gps + 2 + item * 12;
      const total = (unit[u16(field + 2)] ?? 1) * u32(field + 4);
      const data = tiff + u32(field + 8);
      if (total > 4 && data + total <= segment.length) segment.fill(0, data, data + total);
    }
    segment.fill(0, gps, gps + 2 + count * 12 + 4);
  }
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function validImage(bytes: Uint8Array): { type: ImageType; width: number; height: number } | null {
  const type = detectImageType(bytes);
  const size = type && readImageSize(bytes, type);
  if (!type || !size || ![size.width, size.height].every(side => side >= MIN_IMAGE_SIDE && side <= MAX_IMAGE_SIDE)) return null;
  return { type, ...size };
}

export function createOfferMediaHandler(deps: OfferMediaDeps): (req: Request) => Promise<Response> {
  const base = deps.publicBaseUrl.replace(/\/+$/, '');
  const recent = new Map<string, number[]>();
  const inFlight = new Map<string, number>();

  // Reserva un hueco para el usuario o dice por qué no: demasiadas en la ventana o demasiadas a la vez.
  function admit(user: string): 'ok' | 'rate' | 'busy' {
    const since = deps.now() - UPLOAD_WINDOW_MS;
    const times = (recent.get(user) ?? []).filter(time => time > since);
    if (times.length >= UPLOADS_PER_WINDOW) return 'rate';
    if ((inFlight.get(user) ?? 0) >= MAX_CONCURRENT_UPLOADS) return 'busy';
    recent.set(user, [...times, deps.now()]);
    inFlight.set(user, (inFlight.get(user) ?? 0) + 1);
    return 'ok';
  }
  function release(user: string) {
    const left = (inFlight.get(user) ?? 1) - 1;
    if (left > 0) inFlight.set(user, left);
    else inFlight.delete(user);
  }

  async function upload(req: Request, offerId: string, token: string | null) {
    if (!token || sameSecret(token, deps.apiKey)) return json(401, { error: 'authentication_required' });
    const caller = deps.callerFor(token);
    const user = await caller.userId();
    if (!user) return json(401, { error: 'authentication_required' });
    const admitted = admit(user);
    if (admitted !== 'ok') return json(429, { error: admitted === 'rate' ? 'media_rate_limited' : 'upload_in_progress' });
    try {
      return await store(req, offerId, caller);
    } finally {
      release(user);
    }
  }

  async function store(req: Request, offerId: string, caller: Caller) {
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
    const clean = stripImageMetadata(bytes, type);
    if (!clean || validImage(clean)?.type !== type) return json(422, { error: 'image_type_not_allowed' });

    const key = `offers/${offerId}/${deps.newId().toLowerCase()}.${EXTENSIONS[type]}`;
    if (!MEDIA_KEY.test(key)) return json(500, { error: 'invalid_key' });
    try {
      await deps.admin.put(key, clean, type);
    } catch {
      return json(502, { error: 'upload_failed' });
    }
    // Si la base rechaza o no responde, el archivo se borra en el acto; si borrar falla, la limpieza lo recoge.
    let result: CallerResult;
    try {
      result = await caller.rpc('connectical_add_offer_media', {
        p_offer_id: offerId, p_storage_key: key, p_content_type: type, p_byte_size: clean.length,
        p_width: size.width, p_height: size.height, p_alt_text: altText,
      });
    } catch {
      result = { data: null, error: { message: 'database_error' } };
    }
    const { data, error } = result;
    if (error) {
      await deps.admin.remove([key]).catch(() => undefined);
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
    // Solo se sirve lo que sigue siendo una imagen válida del tipo registrado.
    if (!bytes || bytes.length > MAX_IMAGE_BYTES || validImage(bytes)?.type !== row.content_type) {
      return json(404, { error: 'media_not_found' });
    }
    // Copia con ArrayBuffer propio: `deno check` (TypeScript 6) no acepta un Uint8Array<ArrayBufferLike> como cuerpo.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': row.content_type,
        'Content-Length': String(bytes.length),
        // Sin sesión solo se ven fotos aprobadas; con sesión puede ser una pendiente o rechazada. Caché pública corta:
        // si la administración retira una foto, deja de verse en un minuto como mucho.
        'Cache-Control': token ? 'private, no-store' : 'public, max-age=60',
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

// --- Conexión con InsForge: Deno en el despliegue, Node en el laboratorio. Jest no llega aquí. ---------------------
declare const Deno: { env: { get(name: string): string | undefined } };
declare const crypto: { randomUUID(): string };
type SdkClient = {
  auth: { getCurrentUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }> };
  storage: { from(bucket: string): {
    upload(key: string, file: Blob): Promise<{ data: { key?: string } | null; error: { message: string } | null }>;
    download(key: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: { message: string; statusCode?: number } | null }>;
    remove(keys: string[]): Promise<{ error: { message: string } | null }>;
    // Respuesta de GET /api/storage/buckets/<bucket>/objects: { data: [...], pagination } (comprobado en el laboratorio).
    list(options: { limit: number; offset: number }): Promise<{
      data: { data: { key: string; uploadedAt: string }[] } | null; error: { message: string } | null }>;
  } };
  database: {
    rpc(name: string, args: Record<string, unknown>): Promise<CallerResult>;
    from(table: string): { select(columns: string): {
      eq(column: string, value: string): Promise<{ data: { url: string; content_type: string }[] | null; error: unknown }>;
      in(column: string, values: string[]): Promise<{ data: { storage_key: string }[] | null; error: unknown }>;
    } };
  };
};
let deployedHandler: ((req: Request) => Promise<Response>) | null = null;

// https://<app>.<región>.insforge.app → https://<app>.function2.insforge.app/offer-media (como el SDK).
export function functionsBaseUrl(baseUrl: string): string {
  const match = /^https:\/\/([a-z0-9]+)\.[a-z0-9-]+\.insforge\.app\/?$/.exec(baseUrl);
  return match ? `https://${match[1]}.function2.insforge.app/offer-media` : '';
}

export type CreateClient = (config: Record<string, unknown>) => SdkClient;
export type OfferMediaEnv = { baseUrl: string; apiKey: string; anonKey: string; publicBaseUrl: string };

// Conexión real con InsForge a través del SDK. La usa el despliegue (Deno, npm:@insforge/sdk) y el laboratorio
// (scripts/lab/lab-e2e.mjs, Node, @insforge/sdk del proyecto), para que ambos ejecuten el mismo código.
export function sdkDeps(createClient: CreateClient, { baseUrl, apiKey, anonKey, publicBaseUrl }: OfferMediaEnv): OfferMediaDeps {
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
        async userId() {
          if (!token) return null;
          const { data, error } = await client.auth.getCurrentUser();
          return error ? null : data?.user?.id ?? null;
        },
        rpc: (name, args) => client.database.rpc(name, args),
        async visibleMedia(offerId) {
          const { data, error } = await client.database.from('connectical_offer_media').select('url, content_type').eq('offer_id', offerId);
          if (error) throw new Error('media lookup failed');
          return data ?? [];
        },
      };
    },
    admin: {
      // `as never`: los tipos de React Native exigen lastModified en Blob y los de Deno lo rechazan.
      async put(key, bytes, contentType) {
        const { data, error } = await bucket.upload(key, new Blob([bytes as unknown as Blob], { type: contentType } as never));
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
          objects.push(...data.data.map(({ key, uploadedAt }) => ({ key, uploadedAt })));
          if (data.data.length < 1000) return objects;
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

async function deployedDeps(): Promise<OfferMediaDeps> {
  // Especificador literal: Deno Deploy solo incluye los módulos que puede analizar sin ejecutar. Jest y el laboratorio
  // no llegan aquí; para tsc del proyecto está declarado en src/types/deno-modules.d.ts.
  const { createClient } = (await import('npm:@insforge/sdk@1.5.2')) as unknown as { createClient: CreateClient };
  const baseUrl = Deno.env.get('INSFORGE_BASE_URL') ?? '';
  return sdkDeps(createClient, {
    baseUrl,
    apiKey: Deno.env.get('API_KEY') ?? '',
    anonKey: Deno.env.get('ANON_KEY') ?? '',
    publicBaseUrl: Deno.env.get('OFFER_MEDIA_PUBLIC_BASE_URL') ?? functionsBaseUrl(baseUrl),
  });
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
