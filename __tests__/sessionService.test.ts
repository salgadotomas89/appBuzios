// Integración del servicio de reservas con el gestor de sesión (sin red ni Keychain real).
const mockRpc = jest.fn();
const mockFrom = jest.fn();
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
    auth: { signUp: jest.fn(), signOut: jest.fn() },
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
