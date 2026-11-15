import { accessTokenExpiry, createSessionManager, SessionError, type MobileAuthApi } from '../src/auth/sessionManager';
import type { SessionStore, StoredSession } from '../src/auth/secureSessionStore';

// El proyecto no incluye tipos de Node; Jest corre en Node y Buffer existe.
declare const Buffer: { from(value: string): { toString(encoding: 'base64url'): string } };

function jwt(expSeconds: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: 'u1', exp: expSeconds })}.signature`;
}

function memoryStore(initial: StoredSession | null = null) {
  let value = initial;
  const store: SessionStore & { value: () => StoredSession | null } = {
    load: jest.fn(async () => value),
    save: jest.fn(async (session: StoredSession) => {
      value = session;
    }),
    clear: jest.fn(async () => {
      value = null;
    }),
    value: () => value,
  };
  return store;
}

const NOW = Date.parse('2026-11-15T12:00:00Z');
const inMinutes = (minutes: number) => Math.floor((NOW + minutes * 60_000) / 1000);

function fakeAuth(overrides: Partial<MobileAuthApi> = {}) {
  const auth: jest.Mocked<MobileAuthApi> = {
    signInWithPassword: jest.fn(async () => ({
      data: { accessToken: jwt(inMinutes(15)), refreshToken: 'refresh-1', user: { id: 'u1' } },
      error: null,
    })),
    refreshSession: jest.fn(async () => ({
      data: { accessToken: jwt(inMinutes(15)), refreshToken: 'refresh-2', user: { id: 'u1' } },
      error: null,
    })),
    signOut: jest.fn(async () => ({ error: null })),
    ...overrides,
  } as jest.Mocked<MobileAuthApi>;
  return auth;
}

it('reads the expiry from the access token and rejects malformed tokens', () => {
  expect(accessTokenExpiry(jwt(1_800_000_000))).toBe(1_800_000_000_000);
  expect(accessTokenExpiry('not-a-jwt')).toBeNull();
  expect(accessTokenExpiry('a.@@@.c')).toBeNull();
});

it('persists only the refresh token and user after signing in', async () => {
  const store = memoryStore();
  const manager = createSessionManager({ auth: fakeAuth(), store, now: () => NOW });
  await expect(manager.signIn('a@b.c', 'secret123')).resolves.toEqual({ status: 'signed_in', userId: 'u1', persisted: true });
  expect(store.value()).toEqual({ userId: 'u1', refreshToken: 'refresh-1' });
  expect(JSON.stringify(store.value())).not.toContain('eyJ');
});

it('restores a stored session on app start and keeps the rotated refresh token', async () => {
  const store = memoryStore({ userId: 'u1', refreshToken: 'refresh-1' });
  const auth = fakeAuth();
  const manager = createSessionManager({ auth, store, now: () => NOW });
  const [first, second] = await Promise.all([manager.restore(), manager.restore()]);
  expect([first, second]).toEqual(['restored', 'restored']);
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(auth.refreshSession).toHaveBeenCalledWith({ refreshToken: 'refresh-1' });
  expect(manager.getState()).toEqual({ status: 'signed_in', userId: 'u1', persisted: true });
  expect(store.value()?.refreshToken).toBe('refresh-2');
});

it('reports no session when nothing is stored', async () => {
  const auth = fakeAuth();
  const manager = createSessionManager({ auth, store: memoryStore(), now: () => NOW });
  await expect(manager.restore()).resolves.toBe('none');
  expect(auth.refreshSession).not.toHaveBeenCalled();
});

it('clears an expired session that the server rejects', async () => {
  const store = memoryStore({ userId: 'u1', refreshToken: 'old' });
  const auth = fakeAuth({ refreshSession: jest.fn(async () => ({ data: null, error: { message: 'expired', statusCode: 401, error: 'AUTH_UNAUTHORIZED' } })) });
  const manager = createSessionManager({ auth, store, now: () => NOW });
  await expect(manager.restore()).resolves.toBe('expired');
  expect(store.value()).toBeNull();
  expect(auth.signOut).toHaveBeenCalled();
  expect(manager.getState()).toEqual({ status: 'signed_out', reason: 'expired' });
});

it('keeps the stored session when the server cannot be reached', async () => {
  for (const error of [{ message: 'network' }, { message: 'down', statusCode: 503 }, { message: 'slow', statusCode: 429 }]) {
    const store = memoryStore({ userId: 'u1', refreshToken: 'keep' });
    const manager = createSessionManager({ auth: fakeAuth({ refreshSession: jest.fn(async () => ({ data: null, error })) }), store, now: () => NOW });
    await expect(manager.restore()).resolves.toBe('unavailable');
    expect(store.value()).toEqual({ userId: 'u1', refreshToken: 'keep' });
  }
});

it('reports unavailable when the secure store cannot be read', async () => {
  const store = memoryStore();
  store.load = jest.fn(async () => {
    throw new Error('keychain locked');
  });
  const manager = createSessionManager({ auth: fakeAuth(), store, now: () => NOW });
  await expect(manager.restore()).resolves.toBe('unavailable');
});

it('refreshes once, shortly before the access token expires', async () => {
  let clock = NOW;
  const auth = fakeAuth();
  const manager = createSessionManager({ auth, store: memoryStore(), now: () => clock });
  await manager.signIn('a@b.c', 'secret123');
  await manager.ensureFresh();
  expect(auth.refreshSession).not.toHaveBeenCalled();
  clock = NOW + 14.5 * 60_000; // quedan 30 s
  await Promise.all([manager.ensureFresh(), manager.ensureFresh(), manager.ensureFresh()]);
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(auth.refreshSession).toHaveBeenCalledWith({ refreshToken: 'refresh-1' });
});

it('signs out locally on a rejected refresh and surfaces a session-expired error', async () => {
  let clock = NOW;
  const store = memoryStore();
  const auth = fakeAuth({ refreshSession: jest.fn(async () => ({ data: null, error: { message: 'revoked', statusCode: 401 } })) });
  const manager = createSessionManager({ auth, store, now: () => clock });
  await manager.signIn('a@b.c', 'secret123');
  clock = NOW + 20 * 60_000;
  await expect(manager.ensureFresh()).rejects.toMatchObject({ code: 'session_expired' });
  expect(store.value()).toBeNull();
  expect(manager.getState()).toEqual({ status: 'signed_out', reason: 'expired' });
});

it('clears the stored session on sign-out even if the server call fails', async () => {
  const store = memoryStore();
  const auth = fakeAuth({ signOut: jest.fn(async () => { throw new Error('offline'); }) });
  const manager = createSessionManager({ auth, store, now: () => NOW });
  await manager.signIn('a@b.c', 'secret123');
  await manager.signOut();
  expect(store.value()).toBeNull();
  expect(manager.getState()).toEqual({ status: 'signed_out', reason: 'signed_out' });
});

it('keeps an in-memory session but reports it unpersisted when the secure store fails', async () => {
  const store = memoryStore();
  store.save = jest.fn(async () => {
    throw new Error('keystore unavailable');
  });
  const manager = createSessionManager({ auth: fakeAuth(), store, now: () => NOW });
  await expect(manager.signIn('a@b.c', 'secret123')).resolves.toEqual({ status: 'signed_in', userId: 'u1', persisted: false });
});

it('rejects failed or incomplete sign-ins without storing anything', async () => {
  const store = memoryStore();
  const bad = createSessionManager({ auth: fakeAuth({ signInWithPassword: jest.fn(async () => ({ data: null, error: { message: 'Invalid credentials', statusCode: 401 } })) }), store, now: () => NOW });
  await expect(bad.signIn('a@b.c', 'wrong')).rejects.toBeInstanceOf(SessionError);
  const partial = createSessionManager({ auth: fakeAuth({ signInWithPassword: jest.fn(async () => ({ data: { accessToken: jwt(inMinutes(15)) }, error: null })) }), store, now: () => NOW });
  await expect(partial.signIn('a@b.c', 'secret123')).rejects.toMatchObject({ code: 'sign_in_failed' });
  expect(store.save).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

it('does not bring the session back when signing out during an in-flight refresh', async () => {
  let clock = NOW;
  const store = memoryStore();
  const pending = deferred<{ data: { accessToken: string; refreshToken: string; user: { id: string } }; error: null }>();
  const auth = fakeAuth({ refreshSession: jest.fn(() => pending.promise) });
  const manager = createSessionManager({ auth, store, now: () => clock });
  await manager.signIn('a@b.c', 'secret123');
  clock = NOW + 14.5 * 60_000;
  const refresh = manager.ensureFresh().catch(error => error);
  const signOut = manager.signOut();
  // La renovación lenta termina después de pedir el cierre de sesión.
  pending.resolve({ data: { accessToken: jwt(inMinutes(30)), refreshToken: 'resurrected', user: { id: 'u1' } }, error: null });
  await signOut;
  await refresh;
  expect(manager.getState()).toEqual({ status: 'signed_out', reason: 'signed_out' });
  expect(store.value()).toBeNull();
  // El token que el SDK volvió a poner se quita con un signOut posterior a la respuesta tardía.
  expect(auth.signOut.mock.calls.length).toBeGreaterThanOrEqual(1);
  await manager.ensureFresh();
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});

it('signing in as someone else waits for the previous restore and keeps the new user', async () => {
  const store = memoryStore({ userId: 'old-user', refreshToken: 'old-refresh' });
  const pending = deferred<{ data: { accessToken: string; refreshToken: string; user: { id: string } }; error: null }>();
  const auth = fakeAuth({
    refreshSession: jest.fn(() => pending.promise),
    signInWithPassword: jest.fn(async () => ({
      data: { accessToken: jwt(inMinutes(15)), refreshToken: 'new-refresh', user: { id: 'new-user' } },
      error: null,
    })),
  });
  const manager = createSessionManager({ auth, store, now: () => NOW });
  const restore = manager.restore();
  const signIn = manager.signIn('b@c.d', 'secret123');
  pending.resolve({ data: { accessToken: jwt(inMinutes(15)), refreshToken: 'old-rotated', user: { id: 'old-user' } }, error: null });
  await expect(restore).resolves.toBe('none');
  await expect(signIn).resolves.toEqual({ status: 'signed_in', userId: 'new-user', persisted: true });
  expect(store.value()).toEqual({ userId: 'new-user', refreshToken: 'new-refresh' });
  // La respuesta de la restauración llegó antes de que empezara el nuevo inicio de sesión.
  expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
});

it('marks the device as signed out when the keychain refuses to clear, and warns if even that fails', async () => {
  const store = memoryStore();
  const auth = fakeAuth();
  const manager = createSessionManager({ auth, store, now: () => NOW });
  await manager.signIn('a@b.c', 'secret123');
  store.clear = jest.fn(async () => {
    throw new Error('keychain locked');
  });
  await manager.signOut();
  expect(store.value()).toEqual({ userId: 'signed-out', refreshToken: 'signed-out' });
  // Al reabrir, la marca no se restaura como sesión.
  const reopened = createSessionManager({ auth, store, now: () => NOW });
  await expect(reopened.restore()).resolves.toBe('none');
  expect(auth.refreshSession).not.toHaveBeenCalled();

  const broken = memoryStore();
  const third = createSessionManager({ auth, store: broken, now: () => NOW });
  await third.signIn('a@b.c', 'secret123');
  broken.clear = jest.fn(async () => {
    throw new Error('locked');
  });
  broken.save = jest.fn(async () => {
    throw new Error('locked');
  });
  await expect(third.signOut()).rejects.toMatchObject({ code: 'sign_out_incomplete' });
  expect(third.getState()).toEqual({ status: 'signed_out', reason: 'signed_out' });
});

it('starts and stores a session from an email verification code', async () => {
  const store = memoryStore();
  const auth = fakeAuth();
  auth.verifyEmail = jest.fn(async (_request: { email: string; otp: string }) => ({
    data: { accessToken: jwt(inMinutes(15)), refreshToken: 'verified-refresh', user: { id: 'u-new' } },
    error: null,
  }));
  const manager = createSessionManager({ auth, store, now: () => NOW });
  await expect(manager.verifyEmail('new@b.c', '123456')).resolves.toEqual({ status: 'signed_in', userId: 'u-new', persisted: true });
  expect(auth.verifyEmail).toHaveBeenCalledWith({ email: 'new@b.c', otp: '123456' });
  expect(store.value()).toEqual({ userId: 'u-new', refreshToken: 'verified-refresh' });

  auth.verifyEmail = jest.fn(async (_request: { email: string; otp: string }) => ({ data: null, error: { message: 'Invalid code', statusCode: 400 } }));
  const other = createSessionManager({ auth, store: memoryStore(), now: () => NOW });
  await expect(other.verifyEmail('new@b.c', '000000')).rejects.toMatchObject({ code: 'sign_in_failed' });
  expect(other.getState().status).toBe('signed_out');
});

it('hands out the current access token from memory, refreshed when close to expiry, and forgets it on sign-out', async () => {
  let now = NOW;
  const store = memoryStore();
  const first = jwt(inMinutes(15));
  const second = jwt(inMinutes(40));
  const auth = fakeAuth({
    signInWithPassword: jest.fn(async () => ({ data: { accessToken: first, refreshToken: 'refresh-1', user: { id: 'u1' } }, error: null })),
    refreshSession: jest.fn(async () => ({ data: { accessToken: second, refreshToken: 'refresh-2', user: { id: 'u1' } }, error: null })),
  });
  const manager = createSessionManager({ auth, store, now: () => now });
  await expect(manager.currentAccessToken()).resolves.toBeNull();
  await manager.signIn('a@b.c', 'secret123');
  await expect(manager.currentAccessToken()).resolves.toBe(first);
  now = NOW + 14 * 60_000;
  await expect(manager.currentAccessToken()).resolves.toBe(second);
  expect(JSON.stringify(store.value())).not.toContain('eyJ');
  await manager.signOut();
  await expect(manager.currentAccessToken()).resolves.toBeNull();
});
