// Comprobación de las fotos de ofertas DESPUÉS de desplegarlas en buziosflow (docs/despliegue-fotos.md, paso 8). La
// ejecuta una persona del equipo con cuentas de prueba del equipo; no crea ofertas ni usuarios. Pide las contraseñas
// sin mostrarlas y no imprime tokens, claves ni correos.
//
//   node scripts/verify-offer-media.mjs --traveler turista@equipo.com
//   node scripts/verify-offer-media.mjs --traveler turista@equipo.com --provider pousada@equipo.com --offer <uuid>
//
// Sin sesión y como turista solo intenta cosas que deben fallar (no deja nada). Con --provider y --offer (una oferta
// de prueba de esa cuenta) sube una foto de 800×800 generada aquí por la función, la ve, comprueba quién más la ve y
// la borra al final, también si algo falla.
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { createClient } from '@insforge/sdk';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(part => part.trim().split(/\s+/)));
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map(line => line.match(/^\s*([A-Z_]+)\s*=\s*['"]?(.*?)['"]?\s*$/)).filter(Boolean).map(([, key, value]) => [key, value]));
const baseUrl = env.INSFORGE_URL ?? '';
const match = /^https:\/\/([a-z0-9]+)\.[a-z0-9-]+\.insforge\.app\/?$/.exec(baseUrl);
if (!match || match[1] !== 'ykfv5j3m' || !args.traveler?.[0]) {
  console.error('Usage: node scripts/verify-offer-media.mjs --traveler <email> [--provider <email> --offer <uuid>] (with .env pointing to buziosflow)');
  process.exit(2);
}
const fn = `https://${match[1]}.function2.insforge.app/offer-media`;
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};
const anon = () => createClient({ baseUrl, anonKey: env.INSFORGE_ANON_KEY, isServerMode: true });
const withToken = token => createClient({ baseUrl, anonKey: env.INSFORGE_ANON_KEY, isServerMode: true, accessToken: token });

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = text => (text.startsWith(question) ? process.stdout.write(question) : undefined);
  return new Promise(resolve => rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); }));
}
async function signIn(role, email) {
  const { data, error } = await anon().auth.signInWithPassword({ email, password: await ask(`Password for the ${role} account (not shown): `) });
  if (error || !data?.accessToken) throw new Error(`${role} sign-in failed: ${error?.message ?? 'no session'}`);
  return data.accessToken;
}
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const rows = Buffer.alloc((width + 1) * height, 128);
  for (let y = 0; y < height; y += 1) rows[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const call = (method, path, token, body, headers = {}) =>
  fetch(`${fn}/${path}`, { method, body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });

const someOffer = args.offer?.[0] ?? randomUUID();

console.log('# Sin sesión');
check('preflight answers CORS', (await call('OPTIONS', `offers/${someOffer}`)).status === 204);
check('upload without a session is refused', (await call('POST', `offers/${someOffer}`, null, png(800, 800), { 'X-Alt-Text': 'x' })).status === 401);
check('cleanup without the API key is refused', (await call('POST', 'maintenance/cleanup')).status === 401);
check('an unknown photo is not served', (await call('GET', `offers/${someOffer}/${randomUUID()}.png`)).status === 404);
const anonDirect = await anon().storage.from('offer-media').upload(`offers/${someOffer}/${randomUUID()}.png`, new Blob([png(800, 800)], { type: 'image/png' }));
check('anonymous direct upload to the bucket is refused', Boolean(anonDirect.error));

console.log('\n# Turista');
const travelerToken = await signIn('traveler', args.traveler[0]);
const traveler = withToken(travelerToken);
check('a traveler cannot upload photos to an offer through the function',
  [403, 404].includes((await call('POST', `offers/${someOffer}`, travelerToken, png(800, 800), { 'X-Alt-Text': 'x' })).status));
const direct = await traveler.storage.from('offer-media').upload(`offers/${someOffer}/${randomUUID()}.png`, new Blob([png(800, 800)], { type: 'image/png' }));
check('a traveler cannot upload straight to offer-media (202611160004)', Boolean(direct.error), 'direct upload accepted');
const listed = await traveler.storage.from('offer-media').list({ limit: 10, offset: 0 });
check('a traveler cannot list offer-media', Boolean(listed.error) || (listed.data?.data ?? []).length === 0);
const byRpc = await traveler.database.rpc('connectical_add_offer_media', {
  p_offer_id: someOffer, p_storage_key: `offers/${someOffer}/${randomUUID()}.png`, p_content_type: 'image/png',
  p_byte_size: 1000, p_width: 800, p_height: 800, p_alt_text: 'x',
});
check('a traveler cannot register photos by RPC', Boolean(byRpc.error));

console.log('\n# Catálogo sin sesión: solo fotos de ofertas publicadas y aprobadas');
const media = await anon().database.from('connectical_offer_media').select('offer_id, url').limit(200);
const offerIds = [...new Set((media.data ?? []).map(row => row.offer_id))];
const visible = offerIds.length ? await anon().database.from('connectical_offers').select('id, published, moderation_status').in('id', offerIds) : { data: [] };
const approved = new Set((visible.data ?? []).filter(row => row.published && row.moderation_status === 'approved').map(row => row.id));
check(`every photo visible without a session belongs to a published, approved offer (${(media.data ?? []).length})`,
  !media.error && (media.data ?? []).every(row => approved.has(row.offer_id)), media.error?.message);
for (const row of (media.data ?? []).slice(0, 5)) {
  const response = await fetch(row.url);
  check(`a catalog photo is served without a session as an image (${new URL(row.url).pathname.split('/').pop()})`,
    response.status === 200 && /^image\/(jpeg|png|webp)$/.test(response.headers.get('content-type') ?? ''), String(response.status));
}

if (args.provider?.[0] && args.offer?.[0]) {
  console.log('\n# Proveedor (oferta de prueba propia)');
  const providerToken = await signIn('provider', args.provider[0]);
  const offer = await withToken(providerToken).database.from('connectical_offers').select('id, published, moderation_status').eq('id', args.offer[0]);
  const isPublic = Boolean(offer.data?.[0]?.published && offer.data?.[0]?.moderation_status === 'approved');
  let uploaded = null;
  try {
    const svg = await call('POST', `offers/${args.offer[0]}`, providerToken, Buffer.from('<svg onload="alert(1)"/>'), { 'X-Alt-Text': 'x' });
    check('an SVG disguised as a photo is refused', svg.status === 422, String(svg.status));
    const response = await call('POST', `offers/${args.offer[0]}`, providerToken, png(800, 800), { 'X-Alt-Text': encodeURIComponent('Foto de prueba del despliegue') });
    uploaded = response.status === 201 ? await response.json() : null;
    check('the owner uploads a real PNG through the function', Boolean(uploaded), `${response.status} ${uploaded ? '' : await response.text()}`);
    if (uploaded) {
      check('the owner sees the photo with the session', (await call('GET', uploaded.key, providerToken)).status === 200);
      check(`without a session it is served only if the offer is published and approved (${isPublic ? 'approved' : 'not approved'})`,
        (await call('GET', uploaded.key, null)).status === (isPublic ? 200 : 404));
      check('a traveler cannot delete it', (await call('DELETE', `media/${uploaded.id}`, travelerToken)).status === 403);
    }
  } finally {
    if (uploaded) {
      const removed = await call('DELETE', `media/${uploaded.id}`, providerToken);
      check('the owner deletes the test photo (row and file)', removed.status === 200 && (await removed.json()).fileRemoved === true, String(removed.status));
      check('after deleting it is no longer served', (await call('GET', uploaded.key, providerToken)).status === 404);
    }
  }
}

console.log(failures.length ? `\n${failures.length} check(s) failed: keep OFFER_PHOTOS_ENABLED off and see the recovery steps` : '\nOffer photos verified');
process.exit(failures.length ? 1 : 0);
