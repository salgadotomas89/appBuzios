/* eslint-disable no-bitwise -- construir cabeceras binarias de prueba */
// Función offer-media (functions/offer-media.ts) con almacén y base simulados: las reglas de permiso de las RPC y de
// RLS se imitan aquí; las reales están probadas en PostgreSQL (test:shared-reservations y test:insforge-compat).
import {
  createOfferMediaHandler,
  detectImageType,
  functionsBaseUrl,
  readImageSize,
  MAX_IMAGE_BYTES,
  type OfferMediaDeps,
} from '../functions/offer-media';
import { detectImageType as appDetectImageType } from '../src/media/imagePolicy';

declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };

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
  // SOI, APP0 de 16 bytes, SOF0 con alto y ancho.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0]);
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
  return { files, media, approved, rpc, deps, handle: createOfferMediaHandler(deps), advance: (ms: number) => { now += ms; } };
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
  expect(visitor.headers.get('Cache-Control')).toBe('public, max-age=300');
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
