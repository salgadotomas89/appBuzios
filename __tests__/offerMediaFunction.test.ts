/* eslint-disable no-bitwise -- construir cabeceras binarias de prueba */
// Función offer-media (functions/offer-media.ts) con almacén y base simulados: las reglas de permiso de las RPC y de
// RLS se imitan aquí; las reales están probadas en PostgreSQL (test:shared-reservations y test:insforge-compat).
import {
  createOfferMediaHandler,
  detectImageType,
  functionsBaseUrl,
  readImageSize,
  stripImageMetadata,
  MAX_IMAGE_BYTES,
  UPLOADS_PER_WINDOW,
  UPLOAD_WINDOW_MS,
  type OfferMediaDeps,
} from '../functions/offer-media';
import { detectImageType as appDetectImageType } from '../src/media/imagePolicy';

declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };
declare const ReadableStream: new (source: { pull(controller: { enqueue(chunk: Uint8Array): void; close(): void }): void }) => unknown;

const BASE = 'https://ykfv5j3m.function2.insforge.app/offer-media';
const API_KEY = 'ik_admin_key';
const OFFER = '11111111-1111-4111-8111-111111111111';
const OTHER_OFFER = '22222222-2222-4222-8222-222222222222';

function png(width: number, height: number, extra = 0): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}
function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0 de 16 bytes, SOF0 completo (17 bytes con alto, ancho y tres componentes) y EOI.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height);
  view.setUint16(27, width);
  return bytes;
}
function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([...'RIFF'].map(c => c.charCodeAt(0)), 0);
  bytes.set([...'WEBP'].map(c => c.charCodeAt(0)), 8);
  bytes.set([...chunk].map(c => c.charCodeAt(0)), 12);
  const view = new DataView(bytes.buffer);
  if (chunk === 'VP8 ') {
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else if (chunk === 'VP8L') {
    view.setUint32(21, ((width - 1) | ((height - 1) << 14)) >>> 0, true);
  } else {
    view.setUint16(24, (width - 1) & 0xffff, true);
    bytes[26] = (width - 1) >> 16;
    view.setUint16(27, (height - 1) & 0xffff, true);
    bytes[29] = (height - 1) >> 16;
  }
  return bytes;
}

type Media = { id: string; offer_id: string; storage_key: string; url: string; content_type: string };

function world() {
  const files = new Map<string, { bytes: Uint8Array; uploadedAt: string }>();
  const media: Media[] = [];
  const approved = new Set<string>();
  // Tokens de usuario → quién gestiona qué oferta (como connectical_can_manage_offer).
  const manages: Record<string, string[]> = { owner: [OFFER], other: [OTHER_OFFER], admin: [OFFER, OTHER_OFFER], traveler: [] };
  let now = Date.parse('2026-11-16T12:00:00Z');
  let ids = 0;
  const rpc = jest.fn(async (token: string | null, name: string, args: Record<string, unknown>) => {
    if (!token) return { data: null, error: { message: 'authentication_required' } };
    if (name === 'connectical_add_offer_media') {
      if (!manages[token]?.includes(args.p_offer_id as string)) return { data: null, error: { message: 'offer_not_owned' } };
      const row = { id: `media-${media.length + 1}`, offer_id: args.p_offer_id as string, storage_key: args.p_storage_key as string,
        url: `${BASE}/${args.p_storage_key}`, content_type: args.p_content_type as string };
      media.push(row);
      return { data: row.id, error: null };
    }
    const index = media.findIndex(row => row.id === args.p_media_id);
    if (index < 0) return { data: null, error: { message: 'media_not_found' } };
    if (!manages[token]?.includes(media[index].offer_id)) return { data: null, error: { message: 'offer_not_owned' } };
    return { data: media.splice(index, 1)[0].storage_key, error: null };
  });
  const deps: OfferMediaDeps = {
    apiKey: API_KEY,
    publicBaseUrl: `${BASE}/`,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++ids).padStart(12, '0')}`,
    now: () => now,
    callerFor: token => ({
      userId: async () => (token && token in manages ? `user-${token}` : null),
      rpc: (name, args) => rpc(token, name, args),
      visibleMedia: async offerId => media.filter(row => row.offer_id === offerId &&
        (approved.has(offerId) || (token !== null && manages[token]?.includes(offerId)))),
    }),
    admin: {
      put: jest.fn(async (key: string, bytes: Uint8Array) => {
        files.set(key, { bytes, uploadedAt: new Date(now).toISOString() });
      }),
      get: async key => files.get(key)?.bytes ?? null,
      remove: jest.fn(async (keys: string[]) => keys.forEach(key => files.delete(key))),
      list: async () => [...files].map(([key, file]) => ({ key, uploadedAt: file.uploadedAt })),
      registeredKeys: async keys => new Set(media.map(row => row.storage_key).filter(key => keys.includes(key))),
    },
  };
  return { files, media, approved, rpc, deps, manages, handle: createOfferMediaHandler(deps), advance: (ms: number) => { now += ms; } };
}

function post(path: string, body: Uint8Array, token: string | null, altText = 'Vista de la piscina') {
  const headers: Record<string, string> = { 'X-Alt-Text': encodeURIComponent(altText) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`${BASE}/${path}`.replace('/offer-media/', '/'), { method: 'POST', body: body as unknown as string, headers });
}
function request(method: string, path: string, token: string | null) {
  return new Request(`https://ykfv5j3m.function2.insforge.app/${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

it('reads type and dimensions from the bytes of JPEG, PNG and the three WebP variants', () => {
  expect(readImageSize(png(1200, 800), 'image/png')).toEqual({ width: 1200, height: 800 });
  expect(readImageSize(jpeg(1600, 900), 'image/jpeg')).toEqual({ width: 1600, height: 900 });
  for (const chunk of ['VP8 ', 'VP8L', 'VP8X'] as const) {
    expect(readImageSize(webp(chunk, 1024, 768), 'image/webp')).toEqual({ width: 1024, height: 768 });
  }
  const samples = [png(10, 10), jpeg(10, 10), webp('VP8X', 10, 10), new TextEncoder().encode('<svg onload=alert(1)>'), new Uint8Array()];
  expect(samples.map(detectImageType)).toEqual(samples.map(appDetectImageType));
  expect(functionsBaseUrl('https://ykfv5j3m.us-east.insforge.app')).toBe(BASE);
  expect(functionsBaseUrl('https://evil.example/ykfv5j3m.us-east.insforge.app')).toBe('');
});

it('stores a valid photo for the owner of the offer and registers it with the dimensions read from the file', async () => {
  const w = world();
  const response = await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.key).toMatch(new RegExp(`^offers/${OFFER}/aaaaaaaa-aaaa-4aaa-8aaa-000000000001\\.png$`));
  expect(body.url).toBe(`${BASE}/${body.key}`);
  expect(w.rpc).toHaveBeenCalledWith('owner', 'connectical_add_offer_media', expect.objectContaining({
    p_offer_id: OFFER, p_storage_key: body.key, p_content_type: 'image/png', p_width: 1200, p_height: 800, p_alt_text: 'Vista de la piscina',
  }));
  expect(w.files.has(body.key)).toBe(true);
});

it('rejects uploads from travelers, other providers, anonymous callers and the API key, leaving no file behind', async () => {
  const w = world();
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'traveler'))).status).toBe(403);
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'other'))).status).toBe(403);
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), null))).status).toBe(401);
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), API_KEY))).status).toBe(401);
  expect(w.files.size).toBe(0);
  expect(w.media).toHaveLength(0);
});

it('rejects disguised files, wrong sizes, oversized bodies and missing descriptions before storing anything', async () => {
  const w = world();
  const cases: [Uint8Array, string, number, string][] = [
    [new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'Foto', 422, 'image_type_not_allowed'],
    [png(400, 800), 'Foto', 422, 'image_dimensions'],
    [png(7000, 800), 'Foto', 422, 'image_dimensions'],
    [png(1200, 800, MAX_IMAGE_BYTES), 'Foto', 413, 'image_too_large'],
    [png(1200, 800), '   ', 422, 'image_alt_required'],
    [png(1200, 800), 'x'.repeat(161), 422, 'image_alt_required'],
    [new Uint8Array(), 'Foto', 422, 'image_empty'],
  ];
  for (const [bytes, alt, status, error] of cases) {
    const response = await w.handle(post(`offers/${OFFER}`, bytes, 'owner', alt));
    expect([response.status, (await response.json()).error]).toEqual([status, error]);
  }
  expect(w.deps.admin.put).not.toHaveBeenCalled();
});

it('serves a photo to visitors only once the offer is published and approved; the owner sees it before', async () => {
  const w = world();
  const { key } = await (await w.handle(post(`offers/${OFFER}`, jpeg(1600, 900), 'owner'))).json();
  expect((await w.handle(request('GET', key, null))).status).toBe(404);
  expect((await w.handle(request('GET', key, 'traveler'))).status).toBe(404);
  const own = await w.handle(request('GET', key, 'owner'));
  expect([own.status, own.headers.get('Cache-Control')]).toEqual([200, 'private, no-store']);

  w.approved.add(OFFER);
  const visitor = await w.handle(request('GET', key, null));
  expect(visitor.status).toBe(200);
  expect(visitor.headers.get('Content-Type')).toBe('image/jpeg');
  expect(visitor.headers.get('Cache-Control')).toBe('public, max-age=60');
  expect(visitor.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(new Uint8Array(await visitor.arrayBuffer())).toEqual(jpeg(1600, 900));
  // Un archivo que nadie registró no se sirve aunque exista en el bucket.
  w.files.set(`offers/${OFFER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`, { bytes: png(800, 800), uploadedAt: '' });
  expect((await w.handle(request('GET', `offers/${OFFER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`, null))).status).toBe(404);
});

it('deletes a photo only for whoever manages the offer, removing the row and the file', async () => {
  const w = world();
  const { id, key } = await (await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).json();
  const mediaId = id.replace('media-', '00000000-0000-4000-8000-00000000000');
  w.media[0].id = mediaId;
  expect((await w.handle(request('DELETE', `media/${mediaId}`, 'other'))).status).toBe(403);
  expect((await w.handle(request('DELETE', `media/${mediaId}`, null))).status).toBe(401);
  expect(w.files.has(key)).toBe(true);
  const removed = await w.handle(request('DELETE', `media/${mediaId}`, 'owner'));
  expect([removed.status, await removed.json()]).toEqual([200, { removed: true, fileRemoved: true }]);
  expect(w.files.has(key)).toBe(false);
  expect(w.media).toHaveLength(0);
});

it('cleans up only unregistered files older than an hour, and only with the API key', async () => {
  const w = world();
  const { key } = await (await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).json();
  w.files.set('random/upload-by-a-user.html', { bytes: new Uint8Array([1]), uploadedAt: new Date(Date.parse('2026-11-16T11:30:00Z')).toISOString() });
  w.files.set(`offers/${OFFER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`, { bytes: png(800, 800), uploadedAt: '2026-11-16T11:30:00.000Z' });
  expect((await w.handle(request('POST', 'maintenance/cleanup', 'owner'))).status).toBe(401);
  expect(await (await w.handle(request('POST', 'maintenance/cleanup', API_KEY))).json()).toEqual({ checked: 0, removed: 0 });

  w.advance(61 * 60 * 1000);
  w.files.set(`offers/${OFFER}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`, { bytes: png(800, 800), uploadedAt: new Date(Date.parse('2026-11-16T13:00:00Z')).toISOString() });
  expect(await (await w.handle(request('POST', 'maintenance/cleanup', API_KEY))).json()).toEqual({ checked: 3, removed: 2 });
  expect([...w.files.keys()].sort()).toEqual([key, `offers/${OFFER}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`].sort());
});

it('answers CORS preflight and unknown routes without touching storage', async () => {
  const w = world();
  expect((await w.handle(request('OPTIONS', `offers/${OFFER}`, null))).status).toBe(204);
  expect((await w.handle(request('GET', '../../etc/passwd', null))).status).toBe(404);
  expect((await w.handle(request('PUT', `offers/${OFFER}`, 'owner'))).status).toBe(404);
  expect(w.deps.admin.put).not.toHaveBeenCalled();
});

it('checks the session with InsForge before storing anything and limits uploads per user', async () => {
  const w = world();
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'forged-token'))).status).toBe(401);
  expect(w.deps.admin.put).not.toHaveBeenCalled();

  for (let i = 0; i < UPLOADS_PER_WINDOW; i += 1) {
    expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).status).toBe(201);
  }
  const limited = await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  expect([limited.status, (await limited.json()).error]).toEqual([429, 'media_rate_limited']);
  // Otro usuario no comparte el cupo; pasada la ventana, el dueño vuelve a poder subir.
  expect((await w.handle(post(`offers/${OTHER_OFFER}`, png(1200, 800), 'other'))).status).toBe(201);
  w.advance(UPLOAD_WINDOW_MS + 1);
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).status).toBe(201);
  // El límite de la base (30 por hora en todas las instancias) llega como 429 y no deja el archivo.
  w.rpc.mockResolvedValueOnce({ data: null, error: { message: 'media_rate_limited' } });
  const before = w.files.size;
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).status).toBe(429);
  expect(w.files.size).toBe(before);
});

it('allows two uploads at a time per user and frees the slot when one finishes', async () => {
  const w = world();
  const pending: (() => void)[] = [];
  (w.deps.admin.put as jest.Mock).mockImplementation(() => new Promise<void>(resolve => pending.push(() => resolve())));
  const first = w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  const second = w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  const third = await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  expect([third.status, (await third.json()).error]).toEqual([429, 'upload_in_progress']);
  pending.forEach(resolve => resolve());
  expect([(await first).status, (await second).status]).toEqual([201, 201]);
  (w.deps.admin.put as jest.Mock).mockImplementation(async () => undefined);
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).status).toBe(201);
});

it('stops reading a body sent in chunks as soon as it passes the limit', async () => {
  const w = world();
  let sent = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream({
    pull(controller) {
      sent += 1;
      if (sent > 50) controller.close();
      else controller.enqueue(sent === 1 ? png(1200, 800) : chunk);
    },
  });
  const req = new Request(`https://ykfv5j3m.function2.insforge.app/offers/${OFFER}`, {
    method: 'POST', body: body as string, headers: { Authorization: 'Bearer owner', 'X-Alt-Text': 'Foto' }, duplex: 'half',
  } as RequestInit);
  const response = await w.handle(req);
  expect([response.status, (await response.json()).error]).toEqual([413, 'image_too_large']);
  expect(sent).toBeLessThan(10);
  expect(w.deps.admin.put).not.toHaveBeenCalled();
});

it('does not serve files uploaded straight to the bucket even if someone registers them by RPC', async () => {
  // Defensa por si la migración 202611160003 aún no está aplicada: la base registraría cualquier clave.
  const w = world();
  w.approved.add(OFFER);
  const html = `offers/${OFFER}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png`;
  const small = `offers/${OFFER}/ffffffff-ffff-4fff-8fff-ffffffffffff.png`;
  const mislabeled = `offers/${OFFER}/abababab-abab-4bab-8bab-abababababab.webp`;
  w.files.set(html, { bytes: new TextEncoder().encode('<html><script>alert(1)</script></html>'), uploadedAt: '' });
  w.files.set(small, { bytes: png(10, 10), uploadedAt: '' });
  w.files.set(mislabeled, { bytes: png(1200, 800), uploadedAt: '' });
  for (const [key, type] of [[html, 'image/png'], [small, 'image/png'], [mislabeled, 'image/webp']]) {
    w.media.push({ id: key, offer_id: OFFER, storage_key: key, url: `${BASE}/${key}`, content_type: type });
    expect((await w.handle(request('GET', key, null))).status).toBe(404);
  }
});

it('cannot be pushed past the per-user limits by firing requests at the same time', async () => {
  const w = world();
  // 25 subidas a la vez: como mucho 2 en curso; el resto recibe 429 y no escribe nada.
  const pending: (() => void)[] = [];
  (w.deps.admin.put as jest.Mock).mockImplementation(() => new Promise<void>(resolve => pending.push(() => resolve())));
  const burst = Array.from({ length: 25 }, () => w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner')));
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  expect(pending).toHaveLength(2);
  pending.forEach(resolve => resolve());
  const statuses = (await Promise.all(burst)).map(response => response.status);
  expect(statuses.filter(status => status === 201)).toHaveLength(2);
  expect(statuses.filter(status => status === 429)).toHaveLength(23);
  expect(w.media).toHaveLength(2);

  // Con subidas que terminan enseguida, el tope de la ventana (20) tampoco se supera en ráfagas sucesivas.
  (w.deps.admin.put as jest.Mock).mockImplementation(async (key: string, bytes: Uint8Array) => { w.files.set(key, { bytes, uploadedAt: '' }); });
  const accepted: number[] = [];
  for (let round = 0; round < 15; round += 1) {
    const pair = await Promise.all([w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner')), w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))]);
    accepted.push(...pair.map(response => response.status).filter(status => status === 201));
  }
  expect(accepted.length + 2).toBe(20);
});

it('leaves no file behind when the database rejects, fails or cannot be reached', async () => {
  for (const failure of ['reject', 'throw'] as const) {
    const w = world();
    if (failure === 'reject') w.rpc.mockResolvedValueOnce({ data: null, error: { message: 'media_limit_reached' } });
    else w.rpc.mockRejectedValueOnce(new Error('connection reset'));
    const response = await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
    expect([failure, response.status]).toEqual([failure, failure === 'reject' ? 409 : 502]);
    expect(w.files.size).toBe(0);
    expect(w.media).toHaveLength(0);
  }
  // Si además borrar falla, el archivo queda solo hasta la limpieza, que lo retira pasada una hora.
  const w = world();
  w.rpc.mockRejectedValueOnce(new Error('connection reset'));
  (w.deps.admin.remove as jest.Mock).mockRejectedValueOnce(new Error('storage down'));
  await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'));
  expect(w.files.size).toBe(1);
  w.advance(61 * 60 * 1000);
  expect(await (await w.handle(request('POST', 'maintenance/cleanup', API_KEY))).json()).toEqual({ checked: 1, removed: 1 });
  expect(w.files.size).toBe(0);
  // Si falla la subida al bucket, no se registra nada.
  (w.deps.admin.put as jest.Mock).mockRejectedValueOnce(new Error('storage down'));
  expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).status).toBe(502);
  expect(w.rpc).toHaveBeenCalledTimes(1);
});

it('never deletes registered photos in cleanup, however old, nor uploads still in progress', async () => {
  const w = world();
  const keys: string[] = [];
  for (let i = 0; i < 3; i += 1) keys.push((await (await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).json()).key);
  w.advance(30 * 24 * 60 * 60 * 1000);
  // Un archivo recién escrito todavía sin registrar (la función está a mitad de la subida) también se respeta.
  w.files.set(`offers/${OFFER}/12121212-1212-4212-8212-121212121212.png`, { bytes: png(800, 800), uploadedAt: new Date(Date.parse('2026-11-16T12:00:00Z') + 30 * 24 * 60 * 60 * 1000 - 60 * 1000).toISOString() });
  expect(await (await w.handle(request('POST', 'maintenance/cleanup', API_KEY))).json()).toEqual({ checked: 3, removed: 0 });
  expect([...w.files.keys()].sort()).toEqual([...keys, `offers/${OFFER}/12121212-1212-4212-8212-121212121212.png`].sort());
});

it('does not let a traveler or another provider touch photos of an offer they do not manage', async () => {
  const w = world();
  w.approved.add(OFFER);
  const { id, key } = await (await w.handle(post(`offers/${OFFER}`, png(1200, 800), 'owner'))).json();
  const mediaId = '00000000-0000-4000-8000-000000000001';
  w.media.find(row => row.id === id)!.id = mediaId;
  for (const intruder of ['traveler', 'other']) {
    expect((await w.handle(request('DELETE', `media/${mediaId}`, intruder))).status).toBe(403);
    expect((await w.handle(post(`offers/${OFFER}`, png(1200, 800), intruder))).status).toBe(403);
  }
  // Ni siquiera con la clave de API como token de usuario: las rutas de usuario la rechazan.
  expect((await w.handle(request('DELETE', `media/${mediaId}`, API_KEY))).status).toBe(401);
  expect(w.files.has(key)).toBe(true);
  expect(w.media).toHaveLength(1);
});

// EXIF mínimo (TIFF little-endian): IFD0 con orientación 6 y puntero a un IFD GPS con latitud (3 racionales).
function exifSegment(): number[] {
  const tiff: number[] = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0];
  const le16 = (v: number) => [v & 0xff, v >> 8];
  const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
  // IFD0 en 8: 2 entradas (orientación, GPS) + siguiente IFD = 2 + 24 + 4 = 30 → GPS en 38.
  tiff.push(...le16(2), ...le16(0x0112), ...le16(3), ...le32(1), ...le16(6), 0, 0, ...le16(0x8825), ...le16(4), ...le32(1), ...le32(38), ...le32(0));
  // IFD GPS en 38: 1 entrada (GPSLatitude, RATIONAL x3 en 56) + siguiente = 2 + 12 + 4 = 18 → datos en 56.
  tiff.push(...le16(1), ...le16(0x0002), ...le16(5), ...le32(3), ...le32(56), ...le32(0));
  tiff.push(...le32(22), ...le32(1), ...le32(54), ...le32(1), ...le32(1234), ...le32(100)); // 22° 54' 12,34"
  const payload = [...'Exif'].map(c => c.charCodeAt(0)).concat([0, 0], tiff);
  return [0xff, 0xe1, ...le16(payload.length + 2).reverse(), ...payload];
}
const xmp = (text: string) => { const body = [...`http://ns.adobe.com/xap/1.0/\0${text}`].map(c => c.charCodeAt(0)); return [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]; };
const comment = (text: string) => { const body = [...text].map(c => c.charCodeAt(0)); return [0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]; };
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);
declare const Buffer: { from(bytes: Uint8Array): { includes(value: string | Uint8Array): boolean } };

it('removes location and text metadata from JPEG, PNG and WebP but keeps the picture and its orientation', () => {
  const base = jpeg(1600, 900);
  const dirty = new Uint8Array([...base.subarray(0, 20), ...exifSegment(), ...xmp('<exif:GPSLatitude>22,54</exif:GPSLatitude>'), ...comment('Casa da Ana'), ...base.subarray(20)]);
  const clean = stripImageMetadata(dirty, 'image/jpeg')!;
  expect(readImageSize(clean, 'image/jpeg')).toEqual({ width: 1600, height: 900 });
  expect([has(clean, 'GPSLatitude'), has(clean, 'Casa da Ana'), has(clean, 'Exif')]).toEqual([false, false, true]);
  // La latitud (22/1, 54/1, 1234/100) ya no está en ningún sitio; la orientación (0x0112 = 6) sí.
  expect(Buffer.from(clean).includes(new Uint8Array([22, 0, 0, 0, 1, 0, 0, 0, 54, 0, 0, 0]))).toBe(false);
  expect(Buffer.from(clean).includes(new Uint8Array([0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0]))).toBe(true);

  const crcless = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const pngDirty = new Uint8Array([...png(1200, 800).subarray(0, 33), ...crcless('tEXt', [...'GPS\0-22.9'].map(c => c.charCodeAt(0))), ...crcless('eXIf', [1, 2, 3]), ...crcless('IEND', [])]);
  const pngClean = stripImageMetadata(pngDirty, 'image/png')!;
  expect([readImageSize(pngClean, 'image/png'), has(pngClean, 'tEXt'), has(pngClean, 'eXIf'), has(pngClean, 'IEND')]).toEqual([{ width: 1200, height: 800 }, false, false, true]);

  const chunk = (fourcc: string, data: number[]) => [...[...fourcc].map(c => c.charCodeAt(0)), data.length, 0, 0, 0, ...data, ...(data.length % 2 ? [0] : [])];
  const vp8x = [0x0c, 0, 0, 0, ...[(1024 - 1) & 0xff, (1024 - 1) >> 8, 0], ...[(768 - 1) & 0xff, (768 - 1) >> 8, 0]];
  const body = [...chunk('VP8X', vp8x), ...chunk('VP8 ', new Array(10).fill(0)), ...chunk('EXIF', [9, 9, 9]), ...chunk('XMP ', [7, 7])];
  const webpDirty = new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)), body));
  new DataView(webpDirty.buffer).setUint32(4, webpDirty.length - 8, true);
  const webpClean = stripImageMetadata(webpDirty, 'image/webp')!;
  expect([has(webpClean, 'EXIF'), has(webpClean, 'XMP '), webpClean[20] & 0x0c, new DataView(webpClean.buffer).getUint32(4, true)]).toEqual([false, false, 0, webpClean.length - 8]);
  expect(readImageSize(webpClean, 'image/webp')).toEqual({ width: 1024, height: 768 });

  // Estructuras incoherentes (longitud que sale del archivo) no se guardan.
  expect(stripImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0, 1, 2]), 'image/jpeg')).toBeNull();
});

it('stores the cleaned bytes and registers their real size', async () => {
  const w = world();
  const base = jpeg(1600, 900);
  const dirty = new Uint8Array([...base.subarray(0, 20), ...comment('Rua das Pedras 12'), ...base.subarray(20)]);
  const { key } = await (await w.handle(post(`offers/${OFFER}`, dirty, 'owner'))).json();
  const stored = w.files.get(key)!.bytes;
  expect(has(stored, 'Rua das Pedras')).toBe(false);
  expect(w.rpc).toHaveBeenCalledWith('owner', 'connectical_add_offer_media', expect.objectContaining({ p_byte_size: stored.length }));
  expect(stored.length).toBe(base.length);
});
