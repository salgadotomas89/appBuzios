// Clasifica los rechazos de InsForge en el registro, la verificación por código y el inicio de sesión, para que la
// pantalla los muestre en el idioma elegido. Solo se distinguen los casos que el estado HTTP identifica sin
// ambigüedad (401 en el inicio de sesión comprobado contra buziosflow el 15-11-2026); el resto queda como
// 'unknown' y la pantalla añade el mensaje original del servidor.

export type AuthAction = 'sign_in' | 'sign_up' | 'verify' | 'resend';
export type AuthFailureKind = 'invalid_credentials' | 'invalid_code' | 'email_in_use' | 'rate_limited' | 'network' | 'unknown';

export class AuthFlowError extends Error {
  constructor(
    readonly kind: AuthFailureKind,
    readonly serverMessage: string,
  ) {
    super(serverMessage);
    this.name = 'AuthFlowError';
  }
}

export function classifyAuthFailure(action: AuthAction, status: number | undefined): AuthFailureKind {
  if (status === undefined || status === 0) return 'network';
  if (status === 429) return 'rate_limited';
  if (action === 'sign_in' && status === 401) return 'invalid_credentials';
  if (action === 'verify' && (status === 400 || status === 401)) return 'invalid_code';
  if (action === 'sign_up' && status === 409) return 'email_in_use';
  return 'unknown';
}

export function toAuthFlowError(action: AuthAction, error: { message?: string; statusCode?: number } | unknown): AuthFlowError {
  const details = (typeof error === 'object' && error !== null ? error : {}) as { message?: unknown; statusCode?: unknown; status?: unknown };
  const status = typeof details.statusCode === 'number' ? details.statusCode : typeof details.status === 'number' ? details.status : undefined;
  const message = typeof details.message === 'string' ? details.message : String(error);
  return new AuthFlowError(classifyAuthFailure(action, status), message);
}
