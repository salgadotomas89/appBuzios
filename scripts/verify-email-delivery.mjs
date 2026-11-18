// Diagnóstico de los códigos de verificación de buziosflow con un correo real del equipo. Lo ejecuta una persona:
//
//   node scripts/verify-email-delivery.mjs correo@equipo.com
//
// Pide la contraseña sin mostrarla ni guardarla, registra la cuenta como lo hace la app (SDK y clave anónima de
// .env), comprueba con el CLI si el servidor generó un código (solo recuentos y fechas de auth.email_otps, nunca
// el hash) y pide el código recibido. Con el código, verifica el correo y cierra la sesión. Sin código, permite un
// reenvío y concluye si el fallo es de generación o de entrega. Después inicia sesión con la misma contraseña y
// crea el perfil de turista: la cuenta queda lista para scripts/promote-admin.sh. Procedimiento completo en
// docs/alta-primer-usuario.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@insforge/sdk';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(email)) {
  console.error('Usage: node scripts/verify-email-delivery.mjs <email>');
  process.exit(2);
}

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map(line => line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
);
if (!env.INSFORGE_URL?.includes('ykfv5j3m.')) {
  console.error('.env does not point to buziosflow (ykfv5j3m)');
  process.exit(1);
}

function cli(args) {
  return execFileSync('npx', ['-y', '@insforge/cli', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const linked = cli(['current']).match(/Project:\s+(\S+)/)?.[1];
if (linked !== 'buziosflow') {
  console.error(`Linked project is '${linked}', expected buziosflow`);
  process.exit(1);
}

function otpState() {
  const sql =
    'select count(*) as codes, max(created_at) as last_created, count(consumed_at) as consumed, ' +
    `coalesce(max(attempts_count), 0) as attempts from auth.email_otps where lower(email) = '${email}'`;
  return JSON.parse(cli(['db', 'query', sql, '--json'])).rows[0];
}

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = text => (text.startsWith(question) ? process.stdout.write(question) : undefined);
  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    }),
  );
}

const client = createClient({ baseUrl: env.INSFORGE_URL, anonKey: env.INSFORGE_ANON_KEY, isServerMode: true });
const before = otpState();
console.log(`Codes on record for ${email} before sign-up: ${before.codes}`);

// La app exige 8 caracteres (ReservationPortal) aunque el servidor acepte 6: se aplica la regla de la app.
const password = await ask('Password for the new account (min 8, not shown): ', { hidden: true });
if (password.length < 8) {
  console.log('RESULT nothing sent: the password needs at least 8 characters, as in the app');
  process.exit(2);
}
const name = (await ask('Display name: ')) || 'Equipo Búzios Flow';
const signUp = await client.auth.signUp({ email, password, name });
if (signUp.error) {
  console.log(`RESULT sign-up refused: ${signUp.error.message}`);
  process.exit(1);
}
console.log(`Sign-up accepted; requireEmailVerification=${signUp.data?.requireEmailVerification}`);

let after = otpState();
const generated = Number(after.codes) > Number(before.codes);
console.log(generated ? `Server generated a code at ${after.last_created}` : 'Server did NOT record a new code');

let code = await ask('6-digit code from the email (leave empty if nothing arrived after 5 minutes): ');
if (!code) {
  const again = await ask('Request one resend? (y/N): ');
  if (again.toLowerCase() === 'y') {
    const resend = await client.auth.resendVerificationEmail({ email });
    console.log(resend.error ? `Resend refused: ${resend.error.message}` : 'Resend accepted');
    code = await ask('6-digit code from the resent email (empty if nothing arrived): ');
  }
}
if (!code) {
  after = otpState();
  console.log(
    generated || Number(after.codes) > Number(before.codes)
      ? 'RESULT codes are generated but not delivered: configure SMTP ([auth.smtp]) or check spam'
      : 'RESULT no code generated: check auth configuration before SMTP',
  );
  process.exit(1);
}

const verified = await client.auth.verifyEmail({ email, otp: code });
if (verified.error) {
  console.log(`RESULT code delivered but verification failed: ${verified.error.message}`);
  process.exit(1);
}
console.log(`RESULT delivered and verified; emailVerified=${verified.data?.user?.emailVerified}`);
await client.auth.signOut();

// Inicio de sesión con la contraseña elegida, como la app: crea el perfil de turista (connectical_ensure_profile),
// que es lo que exige promote-admin.sh. No se imprime ningún token.
const signIn = await client.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data?.accessToken) {
  console.log(`RESULT verified but sign-in failed: ${signIn.error?.message ?? 'no session returned'}`);
  process.exit(1);
}
const session = createClient({ baseUrl: env.INSFORGE_URL, anonKey: env.INSFORGE_ANON_KEY, isServerMode: true, accessToken: signIn.data.accessToken });
const profile = await session.database.rpc('connectical_ensure_profile', {});
if (profile.error) {
  console.log(`RESULT signed in but the profile could not be created: ${profile.error.message}`);
  process.exit(1);
}
console.log(`RESULT sign-in works; profile role=${profile.data}`);
await session.auth.signOut();
console.log(`Signed out. Next: sh scripts/promote-admin.sh ${email}   (dry run, then --apply after confirming identity)`);
