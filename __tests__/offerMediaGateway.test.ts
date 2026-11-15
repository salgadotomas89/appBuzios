import { createOfferMediaGateway, OfferMediaGatewayError } from '../src/media/offerMediaGateway';

declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };

const OFFER = '11111111-1111-4111-8111-111111111111';
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const photo = { bytes: pngBytes, width: 1200, height: 800, altText: ' Piscina com vista ' };

function gateway(status: number, body: unknown = {}, token: string | null = 'user-jwt') {
  const fetch = jest.fn(async () => ({ status, json: async () => body }));
  return { fetch, api: createOfferMediaGateway({ functionUrl: 'https://app.function2.insforge.app/offer-media/', getAccessToken: async () => token, fetch }) };
}

it('uploads the bytes with the user token, the detected type and the encoded description', async () => {
  const uploaded = { id: 'm1', key: `offers/${OFFER}/x.png`, url: 'https://…', contentType: 'image/png', width: 1200, height: 800 };
  const { fetch, api } = gateway(201, uploaded);
  await expect(api.upload(OFFER, photo)).resolves.toEqual(uploaded);
  expect(fetch).toHaveBeenCalledWith(`https://app.function2.insforge.app/offer-media/offers/${OFFER}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'image/png', 'X-Alt-Text': 'Piscina%20com%20vista' },
    body: pngBytes,
  });
});

it('checks the image before sending and maps the function answers to app errors', async () => {
  const { fetch, api } = gateway(201);
  await expect(api.upload(OFFER, { ...photo, bytes: new TextEncoder().encode('<svg/>') })).rejects.toEqual(new OfferMediaGatewayError('image_type_not_allowed'));
  expect(fetch).not.toHaveBeenCalled();
  await expect(gateway(201, {}, null).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(gateway(403).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'not_allowed' });
  await expect(gateway(409).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'limit_reached' });
  await expect(gateway(429).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'rate_limited' });
  await expect(gateway(503).api.remove('m1')).rejects.toMatchObject({ code: 'storage_not_configured' });
  await expect(gateway(422).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'rejected' });
  const offline = createOfferMediaGateway({ functionUrl: 'https://x', getAccessToken: async () => 't', fetch: async () => { throw new Error('offline'); } });
  await expect(offline.remove('m1')).rejects.toMatchObject({ code: 'network' });
});
