import type { SessionStore } from './secureSessionStore';

// Sesión móvil sobre el SDK de InsForge 1.5.2 sin modificarlo.
//
// El SDK guarda la sesión solo en memoria y, en navegador, la renueva con cookies que React Native
// no tiene. Su flujo móvil documentado (client_type=mobile, activado con `isServerMode`) devuelve un
// refreshToken al iniciar sesión y acepta `auth.refreshSession({ refreshToken })`. En ese modo el SDK
// no renueva solo ni rellena `getCurrentUser`, así que este gestor:
//   * guarda en el almacén seguro únicamente { userId, refreshToken };
//   * restaura al abrir la app con refreshSession y conserva el usuario de la respuesta;
//   * renueva el token de acceso antes de que caduque (una sola renovación a la vez);
//   * distingue sesión caducada (borra el token) de servidor inalcanzable (lo conserva).
// Nunca registra ni devuelve tokens fuera de las llamadas al SDK.

type SdkError = { message: string; statusCode?: number; error?: string } | null;
export type SessionPayload = {
  accessToken?: string | null;
  refreshToken?: string | null;
  user?: { id: string } | null;
};
export interface MobileAuthApi {
  signInWithPassword(request: { email: string; password: string }): Promise<{ data: SessionPayload | null; error: SdkError }>;
  // Verificación de correo por código (tenant con verifyEmailMethod = code); en el flujo móvil devuelve sesión.
  verifyEmail(request: { email: string; otp: string }): Promise<{ data: SessionPayload | null; error: SdkError }>;
  refreshSession(options: { refreshToken: string }): Promise<{ data: SessionPayload | null; error: SdkError }>;
  signOut(): Promise<{ error: SdkError }>;
}

export type RestoreResult = 'restored' | 'none' | 'expired' | 'unavailable';
export type SessionState =
  | { status: 'signed_out'; reason: 'none' | 'expired' | 'signed_out' }
  | { status: 'signed_in'; userId: string; persisted: boolean };

export class SessionError extends Error {
  constructor(
    readonly code: 'sign_in_failed' | 'session_expired' | 'session_unavailable' | 'not_signed_in' | 'sign_out_incomplete',
    message: string,
    // Estado HTTP del rechazo de InsForge, cuando lo hubo (0 = sin conexión).
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

// Renueva si al token le queda menos que esto.
const REFRESH_LEEWAY_MS = 60_000;

// Lee `exp` del JWT para saber cuándo renovar. No verifica la firma: eso lo hace el servidor.
export function accessTokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[=]+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('invalid_base64');
    value = (value << 6) | index; // eslint-disable-line no-bitwise
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff); // eslint-disable-line no-bitwise
    }
  }
  return decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''));
}

// 4xx (salvo 408 y 429) = el servidor rechazó el token; sin código, 408, 429 o 5xx = no se pudo comprobar.
function isRejection(error: NonNullable<SdkError>): boolean {
  const status = error.statusCode;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// Si el almacén no deja borrar al cerrar sesión, se sobrescribe con esta marca para que el siguiente
// arranque no restaure la sesión anterior.
const SIGNED_OUT_MARKER = 'signed-out';

export function createSessionManager(deps: { auth: MobileAuthApi; store: SessionStore; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let state: SessionState = { status: 'signed_out', reason: 'none' };
  let refreshToken: string | null = null;
  let expiresAt: number | null = null;
  let refreshing: Promise<void> | null = null;
  let restoring: Promise<RestoreResult> | null = null;
  // Cambia en cada inicio o cierre de sesión. Una respuesta que llega con otra época pertenece a una
  // sesión anterior y se descarta, aunque el SDK ya haya puesto su token en el cliente HTTP.
  let epoch = 0;

  async function persist(userId: string, token: string): Promise<boolean> {
    try {
      await deps.store.save({ userId, refreshToken: token });
      return true;
    } catch {
      return false;
    }
  }

  // Devuelve false si la sesión pudo quedar guardada en el dispositivo.
  async function wipeStore(): Promise<boolean> {
    try {
      await deps.store.clear();
      return true;
    } catch {
      try {
        await deps.store.save({ userId: SIGNED_OUT_MARKER, refreshToken: SIGNED_OUT_MARKER });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function forget(reason: 'expired' | 'signed_out'): Promise<boolean> {
    epoch += 1;
    state = { status: 'signed_out', reason };
    refreshToken = null;
    expiresAt = null;
    // El SDK borra su token de acceso en signOut aunque la red falle.
    await deps.auth.signOut().catch(() => undefined);
    return wipeStore();
  }

  // Una respuesta de una época anterior: el SDK ya puso ese token en el cliente HTTP, así que se quita.
  async function discardStale(): Promise<void> {
    if (state.status !== 'signed_in') await deps.auth.signOut().catch(() => undefined);
  }

  // Espera a que terminen renovaciones o restauraciones en curso antes de cambiar de sesión, para que
  // ninguna respuesta tardía de la sesión anterior pise a la nueva.
  async function settlePending(): Promise<void> {
    await Promise.allSettled([refreshing, restoring].filter((pending): pending is Promise<never> => pending !== null));
  }

  // Aplica una respuesta de inicio de sesión o renovación; devuelve el usuario o null si viene incompleta.
  async function apply(payload: SessionPayload | null, fallbackUserId?: string): Promise<string | null> {
    const userId = payload?.user?.id ?? fallbackUserId;
    if (!payload?.accessToken || !userId) return null;
    expiresAt = accessTokenExpiry(payload.accessToken);
    if (payload.refreshToken) refreshToken = payload.refreshToken;
    const persisted = refreshToken ? await persist(userId, refreshToken) : false;
    state = { status: 'signed_in', userId, persisted };
    return userId;
  }

  async function refreshNow(): Promise<void> {
    if (!refreshToken || state.status !== 'signed_in') {
      throw new SessionError('not_signed_in', 'No hay una sesión para renovar.');
    }
    const startedIn = epoch;
    const userId = state.userId;
    const { data, error } = await deps.auth.refreshSession({ refreshToken });
    if (startedIn !== epoch) {
      await discardStale();
      throw new SessionError('not_signed_in', 'La sesión cambió durante la renovación.');
    }
    if (error) {
      if (isRejection(error)) {
        await forget('expired');
        throw new SessionError('session_expired', 'La sesión expiró.');
      }
      throw new SessionError('session_unavailable', 'No se pudo renovar la sesión.');
    }
    if (!(await apply(data, userId))) {
      await forget('expired');
      throw new SessionError('session_expired', 'La sesión expiró.');
    }
  }

  // Inicio de sesión por contraseña o por código: invalida lo anterior, espera lo pendiente y descarta
  // la respuesta si otra operación cambió la sesión mientras tanto.
  async function startSession(
    request: () => Promise<{ data: SessionPayload | null; error: SdkError }>,
  ): Promise<SessionState> {
    epoch += 1;
    state = { status: 'signed_out', reason: 'none' };
    await settlePending();
    const startedIn = epoch;
    const { data, error } = await request();
    if (startedIn !== epoch) {
      await discardStale();
      throw new SessionError('sign_in_failed', 'La sesión cambió durante el inicio de sesión.');
    }
    if (error) throw new SessionError('sign_in_failed', error.message, error.statusCode);
    refreshToken = null;
    if (!(await apply(data))) throw new SessionError('sign_in_failed', 'Respuesta de inicio de sesión incompleta.');
    return state;
  }

  return {
    getState(): SessionState {
      return state;
    },

    signIn(email: string, password: string): Promise<SessionState> {
      return startSession(() => deps.auth.signInWithPassword({ email, password }));
    },

    // Tras registrarse, el código del correo inicia la sesión igual que una contraseña.
    verifyEmail(email: string, code: string): Promise<SessionState> {
      return startSession(() => deps.auth.verifyEmail({ email, otp: code }));
    },

    // Una sola restauración aunque varias pantallas la pidan a la vez.
    restore(): Promise<RestoreResult> {
      if (state.status === 'signed_in') return Promise.resolve('restored');
      restoring ??= (async (): Promise<RestoreResult> => {
        const startedIn = epoch;
        let stored;
        try {
          stored = await deps.store.load();
        } catch {
          return 'unavailable';
        }
        if (!stored || stored.refreshToken === SIGNED_OUT_MARKER) {
          if (stored) await deps.store.clear().catch(() => undefined);
          return 'none';
        }
        const { data, error } = await deps.auth.refreshSession({ refreshToken: stored.refreshToken });
        if (startedIn !== epoch) {
          await discardStale();
          return 'none';
        }
        if (error) {
          if (isRejection(error)) {
            await forget('expired');
            return 'expired';
          }
          return 'unavailable';
        }
        refreshToken = stored.refreshToken;
        if (!(await apply(data, stored.userId))) {
          await forget('expired');
          return 'expired';
        }
        return 'restored';
      })().finally(() => {
        restoring = null;
      });
      return restoring;
    },

    // Llamar antes de cada petición autenticada.
    async ensureFresh(): Promise<void> {
      if (state.status !== 'signed_in' || expiresAt === null) return;
      if (expiresAt - now() > REFRESH_LEEWAY_MS) return;
      refreshing ??= refreshNow().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    // El token local se borra aunque el servidor no responda. Si el dispositivo no dejó borrar ni
    // marcar la sesión, avisa: al reabrir la app podría seguir iniciada.
    async signOut(): Promise<void> {
      epoch += 1;
      state = { status: 'signed_out', reason: 'signed_out' };
      await settlePending();
      if (!(await forget('signed_out'))) {
        throw new SessionError('sign_out_incomplete', 'No se pudo borrar la sesión del dispositivo.');
      }
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
