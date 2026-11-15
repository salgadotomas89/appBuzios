// Adaptador de fotos sobre el SDK real de InsForge 1.5.2; solo la red es simulada. Comprueba los endpoints de
// subida directa y de borrado que usará el bucket offer-media, y que se rechaza una clave distinta de la pedida.
import { createClient } from '@insforge/sdk';
import { createInsforgeMediaStorage, MediaUploadError, OFFER_MEDIA_BUCKET } from '../src/media/storageAdapter';

const BASE = 'https://lab.example';
const KEY = 'offers/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

type Call = { method: string; path: string; body: unknown };

function storageWith(objectKey: string) {
  const calls: Call[] = [];
  const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path: url.pathname, body });
    let json: unknown = { error: 'NOT_FOUND' };
    let status = 404;
    if (url.pathname.endsWith('/upload-strategy')) {
      [status, json] = [200, { method: 'direct' }];
    } else if (url.pathname.includes('/objects/') && (method === 'PUT' || method === 'DELETE')) {
      const objectUrl = `${BASE}/api/storage/buckets/${OFFER_MEDIA_BUCKET}/objects/${encodeURIComponent(objectKey)}`;
      [status, json] = [200, method === 'PUT' ? { key: objectKey, bucket: OFFER_MEDIA_BUCKET, url: objectUrl } : { message: 'deleted' }];
    }
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createClient({ baseUrl: BASE, anonKey: 'anon', isServerMode: true, fetch: fetch as unknown as typeof globalThis.fetch, retryCount: 0 });
  return { storage: createInsforgeMediaStorage(async () => client.storage), calls };
}

it('uploads through the direct strategy with the offer key and returns url and key', async () => {
  const { storage, calls } = storageWith(KEY);
  const stored = await storage.upload(KEY, JPEG, 'image/jpeg');
  expect(stored).toEqual({ key: KEY, url: `${BASE}/api/storage/buckets/offer-media/objects/${encodeURIComponent(KEY)}` });
  expect(calls[0]).toEqual({
    method: 'POST',
    path: '/api/storage/buckets/offer-media/upload-strategy',
    body: { filename: KEY, contentType: 'image/jpeg', size: JPEG.byteLength },
  });
  expect(calls[1].method).toBe('PUT');
  expect(decodeURIComponent(calls[1].path)).toBe(`/api/storage/buckets/offer-media/objects/${KEY}`);
});

it('rejects and deletes an object stored under a different key', async () => {
  const { storage, calls } = storageWith('offers/other.jpg');
  await expect(storage.upload(KEY, JPEG, 'image/jpeg')).rejects.toEqual(new MediaUploadError('upload_failed'));
  expect(calls.at(-1)?.method).toBe('DELETE');
  expect(decodeURIComponent(calls.at(-1)?.path ?? '')).toBe('/api/storage/buckets/offer-media/objects/offers/other.jpg');
});

it('deletes by key and reports storage refusals as typed errors', async () => {
  const { storage, calls } = storageWith(KEY);
  await storage.remove(KEY);
  expect(calls.at(-1)?.method).toBe('DELETE');
  const failing = createInsforgeMediaStorage(async () => ({
    from: () => ({
      upload: async () => ({ data: null, error: { message: 'row-level security' } }),
      remove: async () => ({ data: null, error: { message: 'row-level security' } }),
    }),
  }));
  await expect(failing.upload(KEY, JPEG, 'image/jpeg')).rejects.toEqual(new MediaUploadError('upload_failed'));
  await expect(failing.remove(KEY)).rejects.toEqual(new MediaUploadError('remove_failed'));
});
