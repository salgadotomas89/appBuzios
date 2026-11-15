import { checkImage, detectImageType, offerImageKey } from '../src/media/imagePolicy';
import { createMemoryMediaStorage, disabledMediaStorage, MediaUploadError, uploadOfferImage } from '../src/media/storageAdapter';
import { addOfferPhoto, removeOfferPhoto } from '../src/lib/platformService';
import { createOfferMediaGateway } from '../src/media/offerMediaGateway';
import * as reservationService from '../src/lib/reservationService';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));
jest.mock('../src/lib/reservationService', () => ({ ...jest.requireActual('../src/lib/reservationService'), callRpc: jest.fn() }));
const callRpc = reservationService.callRpc as jest.Mock;

// Cabeceras mínimas: solo importan los primeros bytes, como en un archivo real.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const OFFER = '5a000000-0000-4000-8000-000000000001';
const UNIQUE = '6b000000-0000-4000-8000-000000000002';

it('detects the real image type from the file header, not the name', () => {
  expect(detectImageType(JPEG)).toBe('image/jpeg');
  expect(detectImageType(PNG)).toBe('image/png');
  expect(detectImageType(WEBP)).toBe('image/webp');
  expect(detectImageType(GIF)).toBeNull();
  expect(detectImageType(new Uint8Array([0xff]))).toBeNull();
});

it('checks size, type, dimensions and alt text', () => {
  const ok = { bytes: JPEG, width: 1200, height: 900, altText: ' Quarto ' };
  expect(checkImage(ok)).toEqual({ ok: true, image: { type: 'image/jpeg', extension: 'jpg', byteSize: 6, width: 1200, height: 900, altText: 'Quarto' } });
  expect(checkImage({ ...ok, bytes: new Uint8Array() })).toEqual({ ok: false, error: 'image_empty' });
  expect(checkImage({ ...ok, bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).toEqual({ ok: false, error: 'image_too_large' });
  expect(checkImage({ ...ok, bytes: GIF })).toEqual({ ok: false, error: 'image_type_not_allowed' });
  expect(checkImage({ ...ok, width: 599 })).toEqual({ ok: false, error: 'image_dimensions' });
  expect(checkImage({ ...ok, height: 6001 })).toEqual({ ok: false, error: 'image_dimensions' });
  expect(checkImage({ ...ok, altText: '  ' })).toEqual({ ok: false, error: 'image_alt_required' });
});

it('builds storage keys only from ids, never from user file names', () => {
  expect(offerImageKey(OFFER, UNIQUE, 'jpg')).toBe(`offers/${OFFER}/${UNIQUE}.jpg`);
  expect(() => offerImageKey('../other', UNIQUE, 'jpg')).toThrow('invalid_image_key');
  expect(() => offerImageKey(OFFER, UNIQUE, 'exe')).toThrow('invalid_image_key');
});

it('refuses uploads while no bucket is configured', async () => {
  await expect(uploadOfferImage(disabledMediaStorage, OFFER, { bytes: JPEG, width: 1200, height: 900, altText: 'Quarto' }))
    .rejects.toMatchObject({ code: 'storage_not_configured' });
});

it('uploads valid images and keeps both url and key', async () => {
  const storage = createMemoryMediaStorage();
  const result = await uploadOfferImage(storage, OFFER, { bytes: PNG, width: 1000, height: 1000, altText: 'Piscina' }, UNIQUE);
  expect(result).toMatchObject({ key: `offers/${OFFER}/${UNIQUE}.png`, url: `memory://offer-media/offers/${OFFER}/${UNIQUE}.png`, type: 'image/png' });
  expect(storage.objects.has(result.key)).toBe(true);
  await expect(uploadOfferImage(storage, OFFER, { bytes: GIF, width: 1000, height: 1000, altText: 'x' }))
    .rejects.toBeInstanceOf(MediaUploadError);
});

it('adds and removes photos only through the offer-media function, never registering by RPC from the app', async () => {
  const fetch = jest.fn(async (_url: string, init: { method: string }) =>
    ({ status: init.method === 'POST' ? 201 : 200, json: async () => ({ id: 'media-1' }) }));
  const gateway = createOfferMediaGateway({ functionUrl: 'https://app.function2.insforge.app/offer-media', getAccessToken: async () => 'jwt', fetch });
  await expect(addOfferPhoto(gateway, OFFER, { bytes: JPEG, width: 1200, height: 900, altText: 'Quarto' })).resolves.toBe('media-1');
  await removeOfferPhoto(gateway, 'media-1');
  expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
    `POST https://app.function2.insforge.app/offer-media/offers/${OFFER}`,
    'DELETE https://app.function2.insforge.app/offer-media/media/media-1',
  ]);
  expect(callRpc).not.toHaveBeenCalled();
});
