/* global jest */
// react-native-keychain llama a un módulo nativo al importarse. En Jest se sustituye por un
// almacén en memoria; las pruebas del gestor de sesión usan sus propios dobles.
jest.mock('react-native-keychain', () => {
  const entries = new Map();
  return {
    ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly' },
    STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
    setGenericPassword: jest.fn(async (username, password, options = {}) => {
      entries.set(options.service, { username, password, service: options.service, storage: options.storage });
      return { service: options.service, storage: options.storage };
    }),
    getGenericPassword: jest.fn(async (options = {}) => entries.get(options.service) ?? false),
    resetGenericPassword: jest.fn(async (options = {}) => entries.delete(options.service)),
  };
});
