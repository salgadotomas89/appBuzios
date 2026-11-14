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
import {
  createSharedQuote,
  getSharedRole,
  restoreSharedSession,
  signOutSharedAccount,
} from '../src/lib/reservationService';

beforeEach(() => {
  jest.clearAllMocks();
  mockManager.ensureFresh.mockResolvedValue(undefined);
});

type ProfileQuery = { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };
function profileQuery(role: string | null): ProfileQuery {
  const query: ProfileQuery = {
    select: jest.fn((): ProfileQuery => query),
    eq: jest.fn((): ProfileQuery => query),
    maybeSingle: jest.fn(async () => ({ data: role ? { role } : null, error: null })),
  };
  return query;
}

it('maps restore results to notices for the portal', async () => {
  mockManager.restore.mockResolvedValueOnce('expired');
  await expect(restoreSharedSession()).resolves.toBe('expired');
  mockManager.restore.mockResolvedValueOnce('unavailable');
  await expect(restoreSharedSession()).resolves.toBe('unavailable');
  mockManager.restore.mockResolvedValueOnce('restored');
  mockManager.getState.mockReturnValueOnce({ status: 'signed_in', userId: 'u1', persisted: false });
  await expect(restoreSharedSession()).resolves.toBe('not_persisted');
});

it('reads the role of the user the session manager knows, after refreshing the token', async () => {
  mockManager.getState.mockReturnValue({ status: 'signed_in', userId: 'u1', persisted: true });
  const query = profileQuery('provider');
  mockFrom.mockReturnValue(query);
  await expect(getSharedRole()).resolves.toBe('provider');
  expect(mockManager.ensureFresh).toHaveBeenCalled();
  expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');

  mockManager.getState.mockReturnValue({ status: 'signed_out', reason: 'none' });
  await expect(getSharedRole()).resolves.toBeNull();
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
