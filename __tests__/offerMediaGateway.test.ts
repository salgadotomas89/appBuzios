import {
  createOfferMediaGateway,
  OfferMediaGatewayError,
  xhrTransport,
  type TransportOptions,
  type TransportRequest,
  type XhrLike,
} from '../src/media/offerMediaGateway';

declare const TextEncoder: { new (): { encode(text: string): Uint8Array } };

const OFFER = '11111111-1111-4111-8111-111111111111';
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const photo = { bytes: pngBytes, width: 1200, height: 800, altText: ' Piscina com vista ' };

function gateway(status: number, body: unknown = {}, token: string | null = 'user-jwt') {
  const transport = jest.fn(async (_request: TransportRequest, _options: TransportOptions) => ({ status, json: async () => body }));
  return { transport, api: createOfferMediaGateway({ functionUrl: 'https://app.function2.insforge.app/offer-media/', getAccessToken: async () => token, transport }) };
}

it('uploads the bytes with the user token, the detected type and the encoded description', async () => {
  const uploaded = { id: 'm1', key: `offers/${OFFER}/x.png`, url: 'https://…', contentType: 'image/png', width: 1200, height: 800 };
  const { transport, api } = gateway(201, uploaded);
  await expect(api.upload(OFFER, photo)).resolves.toEqual(uploaded);
  expect(transport).toHaveBeenCalledWith({
    method: 'POST',
    url: `https://app.function2.insforge.app/offer-media/offers/${OFFER}`,
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'image/png', 'X-Alt-Text': 'Piscina%20com%20vista' },
    body: pngBytes,
  }, {});
});

it('checks the image before sending and maps the function answers to app errors', async () => {
  const { transport, api } = gateway(201);
  await expect(api.upload(OFFER, { ...photo, bytes: new TextEncoder().encode('<svg/>') })).rejects.toEqual(new OfferMediaGatewayError('image_type_not_allowed'));
  expect(transport).not.toHaveBeenCalled();
  await expect(gateway(201, {}, null).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'not_signed_in' });
  await expect(gateway(403).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'not_allowed' });
  await expect(gateway(409).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'limit_reached' });
  await expect(gateway(429).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'rate_limited' });
  await expect(gateway(503).api.remove('m1')).rejects.toMatchObject({ code: 'storage_not_configured' });
  await expect(gateway(422).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'rejected' });
  await expect(gateway(413).api.upload(OFFER, photo)).rejects.toMatchObject({ code: 'image_too_large' });
  const offline = createOfferMediaGateway({ functionUrl: 'https://x', getAccessToken: async () => 't', transport: async () => { throw new Error('offline'); } });
  await expect(offline.remove('m1')).rejects.toMatchObject({ code: 'network' });
});

// XMLHttpRequest simulado: registra lo enviado y deja disparar progreso, respuesta o cancelación.
function fakeXhr() {
  const sent: { method?: string; url?: string; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const xhr: XhrLike = {
    status: 0, responseText: '', timeout: 0, upload: { onprogress: null },
    onload: null, onerror: null, onabort: null, ontimeout: null,
    open(method, url) { sent.method = method; sent.url = url; },
    setRequestHeader(name, value) { sent.headers[name] = value; },
    send(body) { sent.body = body; },
    abort() { xhr.onabort?.(); },
  };
  return { xhr, sent };
}
function abortSignal() {
  const listeners: (() => void)[] = [];
  const signal = { aborted: false, addEventListener: (_type: 'abort', listener: () => void) => { listeners.push(listener); } };
  return { signal, abort: () => { signal.aborted = true; listeners.forEach(listener => listener()); } };
}

it('sends the bytes with XMLHttpRequest, reports upload progress and parses the answer', async () => {
  const { xhr, sent } = fakeXhr();
  const progress: number[] = [];
  const api = createOfferMediaGateway({ functionUrl: 'https://f/offer-media', getAccessToken: async () => 'jwt', transport: xhrTransport(() => xhr) });
  const pending = api.upload(OFFER, photo, { onProgress: value => progress.push(value) });
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  expect([sent.method, sent.url, sent.headers.Authorization, sent.body]).toEqual(['POST', `https://f/offer-media/offers/${OFFER}`, 'Bearer jwt', pngBytes]);
  xhr.upload?.onprogress?.({ loaded: 6, total: 12, lengthComputable: true });
  xhr.upload?.onprogress?.({ loaded: 12, total: 12, lengthComputable: true });
  xhr.status = 201;
  xhr.responseText = JSON.stringify({ id: 'm1' });
  xhr.onload?.();
  await expect(pending).resolves.toEqual({ id: 'm1' });
  expect(progress).toEqual([0.5, 1]);
});

it('cancels an upload in flight and never starts one that was already cancelled', async () => {
  const { xhr } = fakeXhr();
  const api = createOfferMediaGateway({ functionUrl: 'https://f/offer-media', getAccessToken: async () => 'jwt', transport: xhrTransport(() => xhr) });
  const running = abortSignal();
  const pending = api.upload(OFFER, photo, { signal: running.signal });
  await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
  running.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });

  const create = jest.fn(() => fakeXhr().xhr);
  const before = abortSignal();
  before.abort();
  const idle = createOfferMediaGateway({ functionUrl: 'https://f/offer-media', getAccessToken: async () => 'jwt', transport: xhrTransport(create) });
  await expect(idle.upload(OFFER, photo, { signal: before.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(create).not.toHaveBeenCalled();
});
