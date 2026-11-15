// Contrato con @insforge/sdk 1.5.2 en el flujo móvil (`isServerMode`, marcado obsoleto por InsForge).
// Usa el SDK real y el gestor de sesión real; solo la red es simulada. Si una actualización del SDK
// cambia endpoints, cuerpos o el manejo del token, esta prueba falla antes de llegar a un teléfono.
import { createClient } from '@insforge/sdk';
import { createSessionManager } from '../src/auth/sessionManager';
import type { SessionStore, StoredSession } from '../src/auth/secureSessionStore';

declare const Buffer: { from(value: string): { toString(encoding: 'base64url'): string } };

const BASE = 'https://lab.example';
const ANON = 'anon-key';
const jwt = (sub: string, expSeconds: number) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub, exp: expSeconds })}.sig`;
};
const inMinutes = (minutes: number) => Math.floor(Date.now() / 1000) + minutes * 60;

type Call = { method: string; path: string; auth: string | null; body: unknown };

function fakeNetwork(routes: Record<string, (body: unknown) => { status: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = `${url.pathname}${url.search}`;
    calls.push({ method: init?.method ?? 'GET', path, auth: headers.get('Authorization'), body });
    const route = Object.keys(routes).find(key => path.startsWith(key));
    const { status, json } = route ? routes[route](body) : { status: 404, json: { error: 'NOT_FOUND', message: path } };
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch, calls };
}

function memoryStore(): SessionStore & { value: () => StoredSession | null } {
  let value: StoredSession | null = null;
  return {
    load: async () => value,
    save: async session => {
      value = session;
    },
    clear: async () => {
      value = null;
    },
    value: () => value,
  };
}

it('signs in, refreshes with rotation and signs out through the mobile endpoints', async () => {
  const first = jwt('u1', inMinutes(15));
  const rotated = jwt('u1', inMinutes(30));
  const net = fakeNetwork({
    '/api/auth/sessions?client_type=mobile': () => ({ status: 200, json: { accessToken: first, refreshToken: 'r1', user: { id: 'u1', email: 'a@b.c' } } }),
    '/api/auth/refresh?client_type=mobile': () => ({ status: 200, json: { accessToken: rotated, refreshToken: 'r2', user: { id: 'u1', email: 'a@b.c' } } }),
    '/api/auth/logout?client_type=mobile': () => ({ status: 200, json: { success: true } }),
    '/api/database/rpc/connectical_today': () => ({ status: 200, json: '2099-01-01' }),
  });
  const client = createClient({ baseUrl: BASE, anonKey: ANON, isServerMode: true, fetch: net.fetch as unknown as typeof fetch, retryCount: 0 });
  const store = memoryStore();
  const manager = createSessionManager({ auth: client.auth, store });

  await manager.signIn('a@b.c', 'secret123');
  expect(net.calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/sessions?client_type=mobile', body: { email: 'a@b.c', password: 'secret123' } });
  expect(store.value()).toEqual({ userId: 'u1', refreshToken: 'r1' });
  await client.database.rpc('connectical_today');
  expect(net.calls.at(-1)?.auth).toBe(`Bearer ${first}`);

  // Restaurar desde el almacén en una app nueva: refresh en el cuerpo y token rotado adoptado.
  const reopenedClient = createClient({ baseUrl: BASE, anonKey: ANON, isServerMode: true, fetch: net.fetch as unknown as typeof fetch, retryCount: 0 });
  const reopened = createSessionManager({ auth: reopenedClient.auth, store });
  await expect(reopened.restore()).resolves.toBe('restored');
  const refreshCall = net.calls.find(call => call.path === '/api/auth/refresh?client_type=mobile');
  expect(refreshCall).toMatchObject({ method: 'POST', body: { refresh_token: 'r1' } });
  expect(store.value()).toEqual({ userId: 'u1', refreshToken: 'r2' });
  await reopenedClient.database.rpc('connectical_today');
  expect(net.calls.at(-1)?.auth).toBe(`Bearer ${rotated}`);

  await reopened.signOut();
  expect(net.calls.some(call => call.path === '/api/auth/logout?client_type=mobile')).toBe(true);
  expect(store.value()).toBeNull();
  await reopenedClient.database.rpc('connectical_today');
  expect(net.calls.at(-1)?.auth).toBe(`Bearer ${ANON}`);
});

it('treats a revoked refresh token as an expired session and falls back to the anon key', async () => {
  const net = fakeNetwork({
    '/api/auth/refresh?client_type=mobile': () => ({ status: 401, json: { error: 'AUTH_UNAUTHORIZED', message: 'Refresh token revoked', statusCode: 401 } }),
    '/api/auth/logout?client_type=mobile': () => ({ status: 200, json: { success: true } }),
    '/api/database/rpc/connectical_today': () => ({ status: 200, json: '2099-01-01' }),
  });
  const client = createClient({ baseUrl: BASE, anonKey: ANON, isServerMode: true, fetch: net.fetch as unknown as typeof fetch, retryCount: 0 });
  const store = memoryStore();
  await store.save({ userId: 'u1', refreshToken: 'revoked' });
  const manager = createSessionManager({ auth: client.auth, store });
  await expect(manager.restore()).resolves.toBe('expired');
  expect(store.value()).toBeNull();
  await client.database.rpc('connectical_today');
  expect(net.calls.at(-1)?.auth).toBe(`Bearer ${ANON}`);
});

it('verifies an emailed code through the mobile endpoint and stores the session', async () => {
  const token = jwt('u9', inMinutes(15));
  const net = fakeNetwork({
    '/api/auth/email/verify?client_type=mobile': () => ({ status: 200, json: { accessToken: token, refreshToken: 'rv', user: { id: 'u9', email: 'n@b.c', emailVerified: true, createdAt: '', updatedAt: '' } } }),
  });
  const client = createClient({ baseUrl: BASE, anonKey: ANON, isServerMode: true, fetch: net.fetch as unknown as typeof fetch, retryCount: 0 });
  const store = memoryStore();
  await createSessionManager({ auth: client.auth, store }).verifyEmail('n@b.c', '123456');
  expect(net.calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/email/verify?client_type=mobile', body: { email: 'n@b.c', otp: '123456' } });
  expect(store.value()).toEqual({ userId: 'u9', refreshToken: 'rv' });
});

it('resets a password by code through the email endpoints with the anon key, without creating a session', async () => {
  const net = fakeNetwork({
    '/api/auth/email/send-reset-password': () => ({ status: 200, json: { success: true, message: 'sent' } }),
    '/api/auth/email/exchange-reset-password-token': () => ({ status: 200, json: { token: 'reset-token', expiresAt: '2099-01-01T00:00:00Z' } }),
    '/api/auth/email/reset-password': () => ({ status: 200, json: { message: 'Password reset successfully. Please login with your new password.' } }),
  });
  const client = createClient({ baseUrl: BASE, anonKey: ANON, isServerMode: true, fetch: net.fetch as unknown as typeof fetch, retryCount: 0 });
  expect((await client.auth.sendResetPasswordEmail({ email: 'n@b.c' })).error).toBeNull();
  const exchanged = await client.auth.exchangeResetPasswordToken({ email: 'n@b.c', code: '123456' });
  expect(exchanged.data?.token).toBe('reset-token');
  expect((await client.auth.resetPassword({ newPassword: 'nueva-clave-1', otp: 'reset-token' })).error).toBeNull();
  expect(net.calls.map(call => [call.method, call.path, call.body])).toEqual([
    ['POST', '/api/auth/email/send-reset-password', { email: 'n@b.c' }],
    ['POST', '/api/auth/email/exchange-reset-password-token', { email: 'n@b.c', code: '123456' }],
    ['POST', '/api/auth/email/reset-password', { newPassword: 'nueva-clave-1', otp: 'reset-token' }],
  ]);
  expect(net.calls.every(call => call.auth === `Bearer ${ANON}`)).toBe(true);
});
