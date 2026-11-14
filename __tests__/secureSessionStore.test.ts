import * as Keychain from 'react-native-keychain';
import { keychainSessionStore, SecureStoreError } from '../src/auth/secureSessionStore';

const mocked = Keychain as jest.Mocked<typeof Keychain>;

it('round-trips the session through the keychain with device-only, non-synced storage', async () => {
  await keychainSessionStore.save({ userId: 'u1', refreshToken: 'refresh-secret' });
  expect(mocked.setGenericPassword).toHaveBeenCalledWith('u1', 'refresh-secret', {
    service: 'buziosflow.session',
    accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    cloudSync: false,
    storage: 'KeystoreAESGCM_NoAuth',
  });
  await expect(keychainSessionStore.load()).resolves.toEqual({ userId: 'u1', refreshToken: 'refresh-secret' });
  await keychainSessionStore.clear();
  await expect(keychainSessionStore.load()).resolves.toBeNull();
});

it('reports failures without ever including the token', async () => {
  mocked.setGenericPassword.mockRejectedValueOnce(new Error('keystore broken: refresh-secret'));
  const error = await keychainSessionStore.save({ userId: 'u1', refreshToken: 'refresh-secret' }).catch(e => e);
  expect(error).toBeInstanceOf(SecureStoreError);
  expect(String(error.message)).not.toContain('refresh-secret');
  mocked.setGenericPassword.mockResolvedValueOnce(false);
  await expect(keychainSessionStore.save({ userId: 'u1', refreshToken: 'x' })).rejects.toThrow('secure_store_save_failed');
  mocked.getGenericPassword.mockRejectedValueOnce(new Error('locked'));
  await expect(keychainSessionStore.load()).rejects.toThrow('secure_store_load_failed');
});
