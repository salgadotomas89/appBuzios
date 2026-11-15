// Recorrido completo contra el laboratorio de InsForge 2.3.5 (scripts/lab/insforge-lab.sh up), con cuentas de
// laboratorio (@lab.buziosflow.test) y correo capturado por Mailpit. No usa el tenant ni sus claves.
//
//   sh scripts/lab/insforge-lab.sh up && node --no-warnings scripts/lab/lab-e2e.mjs
//
// 1. Alta, verificación de correo, inicio de sesión y recuperación de contraseña, como la app (SDK 1.5.2).
// 2. Primer administrador con scripts/promote-admin.sh (SQL como project_admin).
// 3. Proveedor: solicitud, aprobación, oferta, inventario y moderación.
// 4. Fotos: intentos de saltarse la función offer-media por /api/storage y por RPC, la función real (sdkDeps) y la
//    limpieza; después aplica 202611160004 con el CLI como project_admin y repite los intentos.
// 5. Reservas: cotización, retención, vencimiento, pago simulado, cancelación, reembolso e incidencia.
// No imprime contraseñas, códigos ni tokens.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@insforge/sdk';
import { createOfferMediaHandler, sdkDeps } from '../../functions/offer-media.ts';
import { portalCopy } from '../../src/i18n/portalCopy.ts';

const lab = join(homedir(), 'LaboratorioBuziosFlow');
const env = Object.fromEntries(
  readFileSync(join(lab, 'lab.env'), 'utf8').trim().split('\n').map(line => line.split(/=(.*)/s).slice(0, 2)),
);
const repo = process.cwd();
const run = randomBytes(3).toString('hex');
const failures = [];
const seenErrors = new Set();

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}
function sql(query) {
  return execFileSync('docker', ['exec', '-i', 'buziosflow-lab-postgres', 'psql', '-U', 'postgres', '-d', 'insforge', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8' }).trim();
}
const anonClient = () => createClient({ baseUrl: env.LAB_URL, anonKey: env.LAB_ANON_KEY, isServerMode: true });
const sessionClient = token => createClient({ baseUrl: env.LAB_URL, anonKey: env.LAB_ANON_KEY, isServerMode: true, accessToken: token });
const errorCode = error => {
  const code = /([a-z]+(?:_[a-z]+)+)/.exec(error?.message ?? '')?.[1] ?? null;
  if (code) seenErrors.add(code);
  return code;
};

// --- Correo (Mailpit) -------------------------------------------------------------------------------------------
async function mailCount(to) {
  const res = await fetch(`${env.LAB_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return (await res.json()).messages_count ?? 0;
}
async function nextCode(to, before) {
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${env.LAB_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = await res.json();
    if ((body.messages_count ?? 0) > before) {
      const message = await (await fetch(`${env.LAB_MAILPIT}/api/v1/message/${body.messages[0].ID}`)).json();
      return { subject: message.Subject, code: /\b(\d{6})\b/.exec(message.Text ?? '')?.[1] ?? null };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { subject: null, code: null };
}

// --- 1. Cuentas -------------------------------------------------------------------------------------------------
async function account(role) {
  const email = `${role}-${run}@lab.buziosflow.test`;
  const password = randomBytes(12).toString('base64url');
  const client = anonClient();
  const before = await mailCount(email);
  const signUp = await client.auth.signUp({ email, password, name: `Lab ${role}` });
  if (signUp.error) throw new Error(`sign-up ${role}: ${signUp.error.message}`);
  const mail = await nextCode(email, before);
  const verified = await client.auth.verifyEmail({ email, otp: mail.code ?? '' });
  if (verified.error) throw new Error(`verify ${role}: ${verified.error.message}`);
  const signIn = await anonClient().auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign-in ${role}: ${signIn.error.message}`);
  const session = sessionClient(signIn.data.accessToken);
  const profile = await session.database.rpc('connectical_ensure_profile', {});
  return { email, password, token: signIn.data.accessToken, id: signIn.data.user.id, db: session.database, storage: session.storage, profile: profile.data };
}

async function authFlow() {
  const email = `turista-${run}@lab.buziosflow.test`;
  const password = randomBytes(12).toString('base64url');
  const client = anonClient();
  let before = await mailCount(email);
  const signUp = await client.auth.signUp({ email, password, name: 'Ana Lab' });
  check('sign-up asks for email verification', !signUp.error && signUp.data?.requireEmailVerification === true, signUp.error?.message);
  const mail = await nextCode(email, before);
  check('verification email arrives with a 6-digit code', mail.subject !== null && mail.code !== null, `subject=${mail.subject}`);
  const early = await anonClient().auth.signInWithPassword({ email, password });
  check('sign-in is refused before verifying the email', Boolean(early.error), 'signed in without verification');
  const wrong = await client.auth.verifyEmail({ email, otp: mail.code === '000000' ? '111111' : '000000' });
  check('a wrong code does not verify', Boolean(wrong.error));
  const verified = await client.auth.verifyEmail({ email, otp: mail.code ?? '' });
  check('the code from the email verifies the account', !verified.error && verified.data?.user?.emailVerified === true, verified.error?.message);
  const signIn = await anonClient().auth.signInWithPassword({ email, password });
  check('sign-in works after verification', !signIn.error && Boolean(signIn.data?.accessToken), signIn.error?.message);
  const profile = await sessionClient(signIn.data?.accessToken).database.rpc('connectical_ensure_profile', {});
  check('first sign-in creates a traveler profile', profile.data === 'traveler', profile.error?.message ?? String(profile.data));

  // Recuperación con código, como ReservationPortal: pedir, canjear el código y fijar la nueva contraseña.
  before = await mailCount(email);
  const request = await anonClient().auth.sendResetPasswordEmail({ email });
  const resetMail = await nextCode(email, before);
  check('password reset email arrives with a 6-digit code', !request.error && resetMail.code !== null, request.error?.message);
  const unknownBefore = await mailCount(`nadie-${run}@lab.buziosflow.test`);
  const unknown = await anonClient().auth.sendResetPasswordEmail({ email: `nadie-${run}@lab.buziosflow.test` });
  await new Promise(resolve => setTimeout(resolve, 1500));
  check('reset for an unknown email answers the same and sends nothing', !unknown.error && (await mailCount(`nadie-${run}@lab.buziosflow.test`)) === unknownBefore, unknown.error?.message);
  const badExchange = await anonClient().auth.exchangeResetPasswordToken({ email, code: resetMail.code === '000000' ? '111111' : '000000' });
  check('a wrong reset code is refused', Boolean(badExchange.error));
  const exchange = await anonClient().auth.exchangeResetPasswordToken({ email, code: resetMail.code ?? '' });
  const newPassword = randomBytes(12).toString('base64url');
  const reset = exchange.error ? exchange : await anonClient().auth.resetPassword({ newPassword, otp: exchange.data.token });
  check('the reset code sets a new password', !reset.error, reset.error?.message);
  const oldLogin = await anonClient().auth.signInWithPassword({ email, password });
  const newLogin = await anonClient().auth.signInWithPassword({ email, password: newPassword });
  check('the old password stops working and the new one signs in', Boolean(oldLogin.error) && !newLogin.error, newLogin.error?.message);
}

// --- Imagen PNG real de 800×800 ----------------------------------------------------------------------------------
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
  header[8] = 8; // 8 bits, escala de grises
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) rows.fill((y * 7) % 256, y * (width + 1) + 1, (y + 1) * (width + 1));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

async function main() {
  const health = await (await fetch(`${env.LAB_URL}/api/health`)).json();
  check(`lab runs InsForge ${health.version}`, health.version === '2.3.5', JSON.stringify(health));
  if (sql("select count(*) from pg_policies where schemaname = 'storage' and policyname like 'connectical_offer_media_%'") !== '0') {
    throw new Error('202611160004 is already applied: recreate the lab with scripts/lab/insforge-lab.sh up');
  }

  console.log('\n# 1. Alta, verificación y recuperación de contraseña');
  await authFlow();

  console.log('\n# 2. Primer administrador');
  const admin = await account('admin');
  const promote = flags => execFileSync('sh', ['-c', `{ echo 'set role project_admin;'; sh scripts/promote-admin.sh '${admin.email}' --print-sql ${flags}; } | docker exec -i buziosflow-lab-postgres psql -U postgres -d insforge -qAt -v ON_ERROR_STOP=1`], { encoding: 'utf8' }).trim().split('\n').pop();
  check('promote-admin dry run says would_promote', promote('') === 'would_promote');
  check('promote-admin --apply promotes the verified account', promote('--apply') === 'promoted');
  const roleChange = await admin.db.rpc('connectical_admin_list_audit_log', { p_limit: 20 });
  check('the role change is in the admin audit log', (roleChange.data ?? []).some(row => row.action === 'role_changed'), roleChange.error?.message);

  console.log('\n# 3. Proveedor, oferta y moderación');
  const provider = await account('pousada');
  const traveler = await account('viajante');
  const application = await provider.db.rpc('connectical_submit_provider_application', {
    p_business_name: 'Pousada Lab', p_category: 'pousadas', p_contact_name: 'Marta Lab', p_contact_phone: '+55 22 98888-0000',
    p_contact_email: provider.email, p_location: 'Geribá', p_description: 'Cinco quartos a 100 m da praia',
  });
  check('a traveler submits a provider application', !application.error, application.error?.message);
  const notYet = await provider.db.rpc('connectical_provider_upsert_offer', { p_offer_id: null, p_category: 'pousadas', p_title: 'Antes', p_base_price_cents: 30000, p_price_mode: 'night', p_published: true });
  check('cannot publish offers before approval', Boolean(notYet.error)); errorCode(notYet.error);
  const travelerReview = await traveler.db.rpc('connectical_admin_review_provider_application', { p_application_id: application.data, p_decision: 'approved', p_note: 'x', p_commission_rate_bps: 1000 });
  check('a traveler cannot approve applications', Boolean(travelerReview.error)); errorCode(travelerReview.error);
  const review = await admin.db.rpc('connectical_admin_review_provider_application', { p_application_id: application.data, p_decision: 'approved', p_note: 'Alvará conferido', p_commission_rate_bps: 1000 });
  check('the admin approves the application', !review.error, review.error?.message);
  // Como en el piloto (docs/piloto-cerrado.md): cada oferta nueva espera aprobación.
  sql("update public.connectical_settings set value = 'true' where key = 'offer_moderation_required'");
  const offerRow = await provider.db.rpc('connectical_provider_upsert_offer', { p_offer_id: null, p_category: 'pousadas', p_title: 'Quarto vista mar', p_base_price_cents: 40000, p_price_mode: 'night', p_published: true });
  const offer = offerRow.data?.id;
  check('the provider creates and publishes an offer', Boolean(offer), offerRow.error?.message);
  await provider.db.rpc('connectical_provider_set_offer_details', { p_offer_id: offer, p_description: 'Quarto duplo com varanda', p_location: 'Geribá', p_meeting_point: 'Recepção', p_schedule: 'Check-in 14h', p_min_quantity: 1, p_max_quantity: 2 });
  const from = sql('select current_date + 20');
  const inventory = await provider.db.rpc('connectical_provider_publish_inventory_range', { p_offer_id: offer, p_from_date: from, p_nights: 5, p_total_units: 1 });
  check('the provider publishes 5 nights of inventory', !inventory.error, inventory.error?.message);
  const moderation = sql("select value from public.connectical_settings where key = 'offer_moderation_required'");
  const hidden = await anonClient().database.from('connectical_offers').select('id').eq('id', offer);
  check('a pending offer is hidden from visitors', moderation === 'true' && (hidden.data ?? []).length === 0, hidden.error?.message);
  const approve = await admin.db.rpc('connectical_admin_set_offer_moderation', { p_offer_id: offer, p_status: 'approved', p_note: '' });
  check('the admin approves the offer', !approve.error, approve.error?.message);
  const visible = await anonClient().database.from('connectical_offers').select('id').eq('id', offer);
  check('visitors without a session see the approved offer', (visible.data ?? []).length === 1, visible.error?.message);

  console.log('\n# 4. Fotos: intentos de saltarse offer-media, función real y limpieza');
  const adminApi = (method, path, body) => fetch(`${env.LAB_URL}${path}`, { method, headers: { Authorization: `Bearer ${env.LAB_API_KEY}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  check('private bucket offer-media created with the API key', (await adminApi('POST', '/api/storage/buckets', { bucketName: 'offer-media', isPublic: false })).ok);
  check('another private bucket for comparison', (await adminApi('POST', '/api/storage/buckets', { bucketName: 'lab-otro', isPublic: false })).ok);
  const publicBase = 'https://lab.function.test/offer-media';
  sql(`insert into public.connectical_settings (key, value) values ('media_public_base_url', '"${publicBase}"') on conflict (key) do update set value = excluded.value`);

  const html = new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' });
  const directKey = `offers/${offer}/${randomUUID()}.png`;
  const direct = await provider.storage.from('offer-media').upload(directKey, html);
  console.log(`INFO  before 202611160004, InsForge ${direct.error ? 'refuses' : 'accepts'} a provider's direct upload to offer-media (default owner policies)`);
  const byRpc = await provider.db.rpc('connectical_add_offer_media', { p_offer_id: offer, p_storage_key: directKey, p_content_type: 'image/png', p_byte_size: 38, p_width: 1200, p_height: 900, p_alt_text: 'Falsa' });
  check('a file uploaded straight to the bucket cannot be registered by RPC (202611160003)', errorCode(byRpc.error) === 'invalid_media', byRpc.error?.message ?? 'registered');
  const travelerDirect = await traveler.storage.from('offer-media').upload(`notas/${randomUUID()}.txt`, new Blob(['x'], { type: 'text/plain' }));
  const providerList = await provider.storage.from('offer-media').list({ limit: 100, offset: 0 });
  check('a user only lists their own objects in the private bucket', !(providerList.data?.objects ?? []).some(o => o.key.startsWith('notas/')), providerList.error?.message);
  const anonDownload = await fetch(`${env.LAB_URL}/api/storage/buckets/offer-media/objects/${directKey}`);
  check('anonymous download from the private bucket is refused', anonDownload.status === 401 || anonDownload.status === 404, String(anonDownload.status));

  const deps = sdkDeps(createClient, { baseUrl: env.LAB_URL, apiKey: env.LAB_API_KEY, anonKey: env.LAB_ANON_KEY, publicBaseUrl: publicBase });
  let clock = Date.now();
  const handle = createOfferMediaHandler({ ...deps, now: () => clock });
  // El router de funciones de InsForge entrega al manejador solo la subruta (sin /offer-media).
  const call = (method, path, token, body, headers = {}) => handle(new Request(`https://lab.function.test/${path}`, {
    method, body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  }));
  const photo = png(800, 800);
  const forged = await call('POST', `offers/${offer}`, 'forged.token.value', photo, { 'X-Alt-Text': 'Varanda' });
  check('the function refuses a forged token before storing anything', forged.status === 401, String(forged.status));
  const travelerUpload = await call('POST', `offers/${offer}`, traveler.token, photo, { 'X-Alt-Text': 'Varanda' });
  check('the function refuses a traveler (not the owner) and leaves no file', travelerUpload.status === 403, String(travelerUpload.status));
  const svg = await call('POST', `offers/${offer}`, provider.token, new TextEncoder().encode('<svg onload="alert(1)"/>'), { 'X-Alt-Text': 'Varanda' });
  check('the function refuses an SVG disguised as a photo', svg.status === 422, String(svg.status));
  const uploaded = await call('POST', `offers/${offer}`, provider.token, photo, { 'X-Alt-Text': encodeURIComponent('Varanda com vista para o mar') });
  const uploadedBody = await uploaded.json();
  check('the owner uploads a real 800×800 PNG through the function', uploaded.status === 201, JSON.stringify(uploadedBody));
  const stored = sql(`select coalesce(uploaded_by, 'api-key') || '|' || size || '|' || mime_type from storage.objects where bucket = 'offer-media' and key = '${uploadedBody.key}'`);
  check('InsForge stored it with the API key (uploaded_by empty), real size and detected type', stored === `api-key|${photo.length}|image/png`, stored);
  const served = await call('GET', uploadedBody.key, null);
  const servedBytes = new Uint8Array(await served.arrayBuffer());
  check('visitors get the photo of the approved offer, byte for byte', served.status === 200 && servedBytes.length === photo.length && served.headers.get('Content-Type') === 'image/png', String(served.status));
  const listed = await anonClient().database.from('connectical_offer_media').select('url, alt_text').eq('offer_id', offer);
  check('the catalog lists the photo with the server-built URL', (listed.data ?? []).some(row => row.url === `${publicBase}/${uploadedBody.key}`), listed.error?.message);
  const travelerDelete = await call('DELETE', `media/${uploadedBody.id}`, traveler.token);
  check('a traveler cannot delete the photo', travelerDelete.status === 403, String(travelerDelete.status));

  clock += 2 * 60 * 60 * 1000;
  const cleanup = await call('POST', 'maintenance/cleanup', env.LAB_API_KEY);
  const cleanupBody = await cleanup.json();
  const leftovers = sql("select string_agg(key, ',' order by key) from storage.objects where bucket = 'offer-media'");
  check('cleanup removes the direct uploads and keeps the registered photo', cleanup.status === 200 && leftovers === uploadedBody.key, `${JSON.stringify(cleanupBody)} left=${leftovers}`);
  console.log(`INFO  traveler direct upload before 202611160004: ${travelerDirect.error ? 'refused' : 'accepted (then cleaned up)'}`);

  console.log('\n# 4b. Aplicar 202611160004 con el CLI como project_admin (método oficial) y repetir');
  const cliMigrations = join(lab, 'cli', 'migrations');
  const storageMigration = '20261116000004_offer-media-storage.sql';
  copyFileSync(join(repo, 'migrations', storageMigration), join(cliMigrations, storageMigration));
  let applied = '';
  try {
    applied = execFileSync('npx', ['-y', '@insforge/cli', 'db', 'migrations', 'up', '--all'], { cwd: join(lab, 'cli'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    applied = String(error.stderr ?? error.message);
  } finally {
    if (existsSync(join(cliMigrations, storageMigration))) rmSync(join(cliMigrations, storageMigration));
  }
  check('the CLI applies the storage policies as project_admin (insforge_pg_utils)', /Applied 1 migration/.test(applied), applied.trim().split('\n').pop());
  check('the four restrictive policies exist', sql("select count(*) from pg_policies where schemaname = 'storage' and policyname like 'connectical_offer_media_%' and permissive = 'RESTRICTIVE'") === '4');
  const after = await provider.storage.from('offer-media').upload(`offers/${offer}/${randomUUID()}.png`, new Blob([photo], { type: 'image/png' }));
  check('after 202611160004 the owner cannot upload straight to offer-media', Boolean(after.error), 'direct upload accepted');
  const afterTraveler = await traveler.storage.from('offer-media').upload(`notas/${randomUUID()}.txt`, new Blob(['x'], { type: 'text/plain' }));
  check('after 202611160004 a traveler cannot upload to offer-media', Boolean(afterTraveler.error), 'direct upload accepted');
  const other = await traveler.storage.from('lab-otro').upload(`${traveler.id}/nota.txt`, new Blob(['x'], { type: 'text/plain' }));
  check('other buckets keep InsForge rules (own uploads allowed)', !other.error, other.error?.message);
  const second = await call('POST', `offers/${offer}`, provider.token, photo, { 'X-Alt-Text': 'Piscina' });
  check('the function still uploads with the API key after 202611160004', second.status === 201, String(second.status));
  const removeSecond = await call('DELETE', `media/${(await second.json()).id}`, provider.token);
  check('the owner deletes a photo through the function (row and file)', removeSecond.status === 200 && sql("select count(*) from storage.objects where bucket = 'offer-media'") === '1', String(removeSecond.status));

  console.log('\n# 5. Reservas, vencimiento, pago simulado, cancelación, reembolso e incidencia');
  const quote = await traveler.db.rpc('connectical_create_quote', { p_offer_id: offer, p_service_date: from, p_quantity: 1, p_nights: 2, p_service_fee_rate_bps: 600 });
  check('a traveler gets a quote for 2 nights', Boolean(quote.data?.id), quote.error?.message);
  const hold = await traveler.db.rpc('connectical_create_reservation_hold', { p_quote_id: quote.data?.id, p_idempotency_key: randomUUID() });
  check('the traveler holds the room', hold.data?.status === 'held', hold.error?.message);
  const competitor = await account('rival');
  const rivalQuote = await competitor.db.rpc('connectical_create_quote', { p_offer_id: offer, p_service_date: from, p_quantity: 1, p_nights: 2, p_service_fee_rate_bps: 600 });
  const rivalHold = rivalQuote.error ? rivalQuote : await competitor.db.rpc('connectical_create_reservation_hold', { p_quote_id: rivalQuote.data?.id, p_idempotency_key: randomUUID() });
  check('another traveler cannot hold the same nights while it is held', Boolean(rivalHold.error)); errorCode(rivalHold.error);
  sql(`update public.connectical_reservations set hold_expires_at = now() - interval '1 minute' where id = '${hold.data?.id}'`);
  const expire = await traveler.db.rpc('connectical_expire_holds', {});
  const mine = await traveler.db.rpc('connectical_list_reservations', {});
  check('an expired hold is released when holds are swept', (mine.data ?? []).find(r => r.id === hold.data?.id)?.status === 'expired', expire.error?.message);
  const retryQuote = await competitor.db.rpc('connectical_create_quote', { p_offer_id: offer, p_service_date: from, p_quantity: 1, p_nights: 2, p_service_fee_rate_bps: 600 });
  const retry = await competitor.db.rpc('connectical_create_reservation_hold', { p_quote_id: retryQuote.data?.id, p_idempotency_key: randomUUID() });
  check('the released nights can be held again', retry.data?.status === 'held', retry.error?.message);
  const pending = await competitor.db.rpc('connectical_simulate_payment', { p_reservation_id: retry.data?.id, p_outcome: 'approved', p_method: 'pix', p_reference: `LAB-${run}` });
  check('simulated Pix payment confirms the reservation (no real payment)', pending.data?.status === 'confirmed', pending.error?.message);
  const commission = await provider.db.rpc('connectical_list_reservations', {});
  const travelerView = await competitor.db.rpc('connectical_list_reservations', {});
  check('the provider sees the commission and the traveler does not',
    (commission.data ?? []).find(r => r.id === retry.data?.id)?.provider_commission_cents === 8000 &&
    (travelerView.data ?? []).find(r => r.id === retry.data?.id)?.provider_commission_cents == null);
  const cancel = await competitor.db.rpc('connectical_cancel_reservation', { p_reservation_id: retry.data?.id, p_reason: 'traveler_request' });
  check('the traveler cancels the paid reservation', !cancel.error, cancel.error?.message);
  const amount = Number(sql(`select amount_cents from public.connectical_reservations where id = '${retry.data?.id}'`));
  const refund = await admin.db.rpc('connectical_admin_record_refund', { p_reservation_id: retry.data?.id, p_amount_cents: amount, p_reason: 'Cancelamento com 20 dias', p_idempotency_key: randomUUID() });
  check('the admin records the full simulated refund', refund.data?.status === 'refunded', refund.error?.message);
  const incident = await competitor.db.rpc('connectical_report_incident', { p_reservation_id: retry.data?.id, p_category: 'payment', p_description: 'Prazo do estorno?' });
  const resolved = incident.error ? incident : await admin.db.rpc('connectical_admin_update_incident', { p_incident_id: incident.data, p_status: 'resolved', p_note: 'Estorno registrado.' });
  check('an incident is reported and resolved by the admin', !resolved.error, resolved.error?.message);
  const users = await traveler.db.rpc('connectical_admin_list_users', { p_role: null });
  check('admin operations are refused to travelers', Boolean(users.error)); errorCode(users.error);
  const kpis = await admin.db.rpc('connectical_admin_kpis', { p_from: sql('select current_date - 1'), p_to: sql('select current_date + 1') });
  check('the admin reads the KPIs', !kpis.error, kpis.error?.message);

  console.log('\n# 6. Traducciones de los errores vistos en el laboratorio');
  const missing = [...seenErrors].filter(code => ['es', 'pt', 'en'].some(language => !(code in portalCopy[language].errors)));
  check(`every database error seen here has ES/PT/EN text (${[...seenErrors].sort().join(', ')})`, missing.length === 0, missing.join(', '));

  console.log('\n# 7. Invariantes de la base (supabase/checks/verify_migrations.sql)');
  const verify = sql(readFileSync(join(repo, 'supabase/checks/verify_migrations.sql'), 'utf8')).split('\n').filter(line => !line.endsWith('|t'));
  check('verify_migrations.sql reports every invariant as ok on the lab', verify.length === 0, verify.join('; '));
}

try {
  await main();
} catch (error) {
  check('lab run finished', false, error.message);
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nLab end-to-end passed');
process.exit(failures.length ? 1 : 0);
