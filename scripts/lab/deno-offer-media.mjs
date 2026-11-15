// Pruebas de functions/offer-media.ts en Deno, el runtime de InsForge Functions (sh scripts/lab/deno-check.sh).
// Complementan las de Jest (Node): aquí corren el mismo manejador con Request, Response y streams de Deno, detrás de
// una copia del router que InsForge genera (deno-subhosting.provider.ts, v2.3.5: quita el slug y rehace la petición
// con `new Request(url, req)`), y la entrada del despliegue (export default) con el SDK real de npm contra un
// servidor de InsForge simulado en 127.0.0.1. No usa la red salvo para descargar el SDK la primera vez.
import offerMedia, { createOfferMediaHandler, MAX_IMAGE_BYTES } from '../../functions/offer-media.ts';

const OFFER = '11111111-1111-4111-8111-111111111111';

function assertEquals(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// PNG con estructura válida (IHDR, IDAT de `extra` bytes, IEND; CRC sin calcular: la función no los comprueba).
function png(width, height, extra = 0) {
  const bytes = new Uint8Array(33 + 12 + extra + 12);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(33, extra);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  for (let i = 0; i < extra; i += 1) bytes[41 + i] = i % 251;
  bytes.set([0x49, 0x45, 0x4e, 0x44], 33 + 12 + extra + 4);
  return bytes;
}

// Copia del despacho del router de InsForge para la ruta /<slug>/<subruta>.
function insforgeRouter(slug, handler) {
  return async req => {
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== slug) return new Response('{"error":"Function not found"}', { status: 404 });
    const subpath = parts.slice(1).join('/');
    let funcReq = req;
    if (subpath) {
      const url = new URL(req.url);
      url.pathname = '/' + subpath;
      funcReq = new Request(url.toString(), req);
    }
    return handler(funcReq);
  };
}

function fakeDeps() {
  const files = new Map();
  const media = [];
  return {
    files,
    media,
    deps: {
      apiKey: 'ik_test',
      publicBaseUrl: 'https://app.function2.insforge.app/offer-media',
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
      callerFor: token => ({
        userId: async () => (token === 'owner' ? 'user-owner' : null),
        rpc: async (name, args) => {
          if (name !== 'connectical_add_offer_media') return { data: null, error: { message: 'media_not_found' } };
          media.push({ offer_id: args.p_offer_id, url: `https://app.function2.insforge.app/offer-media/${args.p_storage_key}`, content_type: args.p_content_type });
          return { data: `media-${media.length}`, error: null };
        },
        visibleMedia: async offerId => media.filter(row => row.offer_id === offerId),
      }),
      admin: {
        put: async (key, bytes) => { files.set(key, bytes); },
        get: async key => files.get(key) ?? null,
        remove: async keys => keys.forEach(key => files.delete(key)),
        list: async () => [],
        registeredKeys: async () => new Set(),
      },
    },
  };
}

Deno.test('binary uploads survive the InsForge router and are served byte for byte', async () => {
  const world = fakeDeps();
  const route = insforgeRouter('offer-media', createOfferMediaHandler(world.deps));
  const photo = png(1200, 800, 4096);
  const upload = await route(new Request(`https://app.function2.insforge.app/offer-media/offers/${OFFER}`, {
    method: 'POST', body: photo, headers: { Authorization: 'Bearer owner', 'X-Alt-Text': encodeURIComponent('Varanda com vista, açaí & pôr do sol') },
  }));
  const body = await upload.json();
  assertEquals(upload.status, 201, 'upload status');
  assertEquals([...world.files.get(body.key)], [...photo], 'stored bytes');
  const served = await route(new Request(`https://app.function2.insforge.app/offer-media/${body.key}`));
  assertEquals([served.status, served.headers.get('content-type'), served.headers.get('x-content-type-options')], [200, 'image/png', 'nosniff'], 'served headers');
  assertEquals([...new Uint8Array(await served.arrayBuffer())], [...photo], 'served bytes');
});

Deno.test('a streamed body over 5 MB is cut off before it is all read', async () => {
  const world = fakeDeps();
  const route = insforgeRouter('offer-media', createOfferMediaHandler(world.deps));
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 40) controller.close();
      else controller.enqueue(pulled === 1 ? png(1200, 800) : new Uint8Array(1024 * 1024));
    },
  });
  const response = await route(new Request(`https://app.function2.insforge.app/offer-media/offers/${OFFER}`, {
    method: 'POST', body: stream, headers: { Authorization: 'Bearer owner', 'X-Alt-Text': 'x' },
  }));
  assertEquals([response.status, (await response.json()).error], [413, 'image_too_large'], 'oversized stream');
  if (pulled > Math.ceil(MAX_IMAGE_BYTES / (1024 * 1024)) + 3) throw new Error(`read ${pulled} chunks`);
  assertEquals(world.files.size, 0, 'nothing stored');
});

Deno.test('the deployed entry point loads the real SDK from npm and cleans up through InsForge storage', async () => {
  // Servidor de InsForge simulado: listado del bucket (forma { data, pagination } de 2.3.5), consulta de fotos
  // registradas y borrado. Registra lo que recibe para comprobar las llamadas del SDK.
  const calls = [];
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async req => {
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}${req.headers.get('authorization') === 'Bearer ik_test' ? ' [api key]' : ''}`);
    if (req.method === 'GET' && url.pathname === '/api/storage/buckets/offer-media/objects') {
      return Response.json({ data: [
        { key: `offers/${OFFER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`, uploadedAt: old, size: 1, bucket: 'offer-media', url: '' },
        { key: 'notas/directa.txt', uploadedAt: old, size: 1, bucket: 'offer-media', url: '' },
      ], pagination: { offset: 0, limit: 1000, total: 2 } });
    }
    if (req.method === 'GET' && url.pathname === '/api/database/records/connectical_offer_media') {
      return Response.json([{ storage_key: `offers/${OFFER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png` }]);
    }
    if (req.method === 'DELETE' && url.pathname === '/api/storage/buckets/offer-media/objects') {
      calls.push(`deleted ${JSON.stringify((await req.json()).keys)}`);
      return Response.json({ deleted: 1 });
    }
    return Response.json({ error: 'unexpected' }, { status: 500 });
  });
  try {
    Deno.env.set('INSFORGE_BASE_URL', `http://127.0.0.1:${server.addr.port}`);
    Deno.env.set('API_KEY', 'ik_test');
    Deno.env.set('ANON_KEY', 'anon_test');
    Deno.env.set('OFFER_MEDIA_PUBLIC_BASE_URL', 'https://app.function2.insforge.app/offer-media');
    const route = insforgeRouter('offer-media', offerMedia);
    assertEquals((await route(new Request(`https://x/offer-media/offers/${OFFER}`, { method: 'OPTIONS' }))).status, 204, 'preflight');
    const denied = await route(new Request('https://x/offer-media/maintenance/cleanup', { method: 'POST', headers: { Authorization: 'Bearer not-the-key' } }));
    assertEquals(denied.status, 401, 'cleanup without the key');
    const cleanup = await route(new Request('https://x/offer-media/maintenance/cleanup', { method: 'POST', headers: { Authorization: 'Bearer ik_test' } }));
    assertEquals([cleanup.status, await cleanup.json()], [200, { checked: 2, removed: 1 }], 'cleanup result');
    assertEquals(calls.filter(call => call.startsWith('deleted')), ['deleted ["notas/directa.txt"]'], 'only the orphan is deleted');
    if (!calls.every(call => call.startsWith('deleted') || call.endsWith('[api key]'))) throw new Error(`calls without the API key: ${calls}`);
  } finally {
    await server.shutdown();
  }
});
