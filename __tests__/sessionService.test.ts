// Integración del servicio de reservas con el gestor de sesión (sin red ni Keychain real).
const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockAuth = {
  signUp: jest.fn(),
  signOut: jest.fn(),
  sendResetPasswordEmail: jest.fn(),
  exchangeResetPasswordToken: jest.fn(),
  resetPassword: jest.fn(),
};
const mockManager = {
  getState: jest.fn(),
  restore: jest.fn(),
  ensureFresh: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
};

jest.mock('../src/lib/insforge', () => ({
  insforge: {
    database: { rpc: (...args: unknown[]) => mockRpc(...args), from: (...args: unknown[]) => mockFrom(...args) },
    get auth() {
      return mockAuth;
    },
  },
  // Getter: la fábrica corre antes de que exista mockManager (las importaciones se elevan).
  get sessionManager() {
    return mockManager;
  },
}));

import { SessionError } from '../src/auth/sessionManager';
import { AuthFlowError } from '../src/auth/authErrors';
import {
  createSharedQuote,
  getSharedRole,
  requestPasswordReset,
  resetAccountPassword,
  restoreSharedSession,
  signInSharedAccount,
  signOutSharedAccount,
} from '../src/lib/reservationService';

beforeEach(() => {
  jest.clearAllMocks();
  mockManager.ensureFresh.mockResolvedValue(undefined);
});


it('maps restore results to notices for the portal', async () => {
  mockManager.restore.mockResolvedValueOnce('expired');
  await expect(restoreSharedSession()).resolves.toBe('expired');
  mockManager.restore.mockResolvedValueOnce('unavailable');
  await expect(restoreSharedSession()).resolves.toBe('unavailable');
  mockManager.restore.mockResolvedValueOnce('restored');
  mockManager.getState.mockReturnValueOnce({ status: 'signed_in', userId: 'u1', persisted: false });
  await expect(restoreSharedSession()).resolves.toBe('not_persisted');
});

it('gets the role through ensure_profile for the signed-in user, after refreshing the token', async () => {
  mockManager.getState.mockReturnValue({ status: 'signed_in', userId: 'u1', persisted: true });
  mockRpc.mockResolvedValueOnce({ data: 'provider', error: null });
  await expect(getSharedRole()).resolves.toBe('provider');
  expect(mockManager.ensureFresh).toHaveBeenCalled();
  expect(mockRpc).toHaveBeenCalledWith('connectical_ensure_profile', {});

  // Primer inicio de sesión: la función crea el perfil y devuelve 'traveler'.
  mockRpc.mockResolvedValueOnce({ data: 'traveler', error: null });
  await expect(getSharedRole()).resolves.toBe('traveler');

  mockManager.getState.mockReturnValue({ status: 'signed_out', reason: 'none' });
  mockRpc.mockClear();
  await expect(getSharedRole()).resolves.toBeNull();
  expect(mockRpc).not.toHaveBeenCalled();
});

it('turns an expired session into a sign-in-again error before calling the database', async () => {
  mockManager.ensureFresh.mockRejectedValueOnce(new SessionError('session_expired', 'expired'));
  const error = await createSharedQuote({ offerId: 'o', serviceDate: '2099-01-01', quantity: 1, nights: 1, serviceFeeRateBps: 600 }).catch(e => e);
  expect(error.code).toBe('authentication_required');
  expect(mockRpc).not.toHaveBeenCalled();

  mockManager.ensureFresh.mockRejectedValueOnce(new SessionError('session_unavailable', 'offline'));
  const offline = await createSharedQuote({ offerId: 'o', serviceDate: '2099-01-01', quantity: 1, nights: 1, serviceFeeRateBps: 600 }).catch(e => e);
  expect(offline.code).toBe('session_unavailable');
});

it('signs out through the session manager', async () => {
  await signOutSharedAccount();
  expect(mockManager.signOut).toHaveBeenCalled();
});

it('turns InsForge sign-in rejections into classified errors and keeps other failures as they were', async () => {
  mockManager.signIn.mockRejectedValueOnce(new SessionError('sign_in_failed', 'Invalid credentials', 401));
  await expect(signInSharedAccount('ana@example.com', 'wrong')).rejects.toEqual(new AuthFlowError('invalid_credentials', 'Invalid credentials'));
  mockManager.signIn.mockRejectedValueOnce(new SessionError('sign_in_failed', 'Network request failed: offline', 0));
  await expect(signInSharedAccount('ana@example.com', 'secret123')).rejects.toMatchObject({ kind: 'network' });
  mockManager.signIn.mockRejectedValueOnce(new SessionError('sign_in_failed', 'La sesión cambió durante el inicio de sesión.'));
  await expect(signInSharedAccount('ana@example.com', 'secret123')).rejects.toThrow(
    'No se pudo iniciar sesión: La sesión cambió durante el inicio de sesión.');
});

it('requests a reset code and changes the password with the exchanged one-time token', async () => {
  mockAuth.sendResetPasswordEmail.mockResolvedValueOnce({ data: { success: true, message: 'sent' }, error: null });
  await requestPasswordReset('ana@example.com');
  expect(mockAuth.sendResetPasswordEmail).toHaveBeenCalledWith({ email: 'ana@example.com' });

  mockAuth.exchangeResetPasswordToken.mockResolvedValueOnce({ data: { token: 'reset-token', expiresAt: '2099-01-01T00:00:00Z' }, error: null });
  mockAuth.resetPassword.mockResolvedValueOnce({ data: { message: 'ok' }, error: null });
  await resetAccountPassword('ana@example.com', '123456', 'nueva-clave-1');
  expect(mockAuth.exchangeResetPasswordToken).toHaveBeenCalledWith({ email: 'ana@example.com', code: '123456' });
  expect(mockAuth.resetPassword).toHaveBeenCalledWith({ newPassword: 'nueva-clave-1', otp: 'reset-token' });
  expect(mockManager.signIn).not.toHaveBeenCalled();
});

it('classifies reset rejections and never sets a password after a refused code', async () => {
  mockAuth.sendResetPasswordEmail.mockResolvedValueOnce({ data: null, error: { message: 'Too many requests', statusCode: 429 } });
  await expect(requestPasswordReset('ana@example.com')).rejects.toMatchObject({ kind: 'rate_limited' });

  mockAuth.exchangeResetPasswordToken.mockResolvedValueOnce({ data: null, error: { message: 'Invalid or expired code', statusCode: 400 } });
  await expect(resetAccountPassword('ana@example.com', '000000', 'nueva-clave-1')).rejects.toEqual(
    new AuthFlowError('invalid_code', 'Invalid or expired code'));
  expect(mockAuth.resetPassword).not.toHaveBeenCalled();

  mockAuth.exchangeResetPasswordToken.mockResolvedValueOnce({ data: { token: 'reset-token', expiresAt: '2099-01-01T00:00:00Z' }, error: null });
  mockAuth.resetPassword.mockResolvedValueOnce({ data: null, error: { message: 'Password must be at least 6 characters', statusCode: 400 } });
  await expect(resetAccountPassword('ana@example.com', '123456', 'x')).rejects.toMatchObject({
    kind: 'unknown', serverMessage: 'Password must be at least 6 characters' });
});
