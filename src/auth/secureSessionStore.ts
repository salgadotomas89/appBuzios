import * as Keychain from 'react-native-keychain';

// Lo único que se persiste de una sesión: el token de renovación y el usuario al que pertenece.
// El token de acceso dura poco y vive solo en memoria. Nada de esto va a AsyncStorage, archivos ni logs.
export type StoredSession = { userId: string; refreshToken: string };

export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

// El mensaje nunca incluye el token: solo la operación que falló.
export class SecureStoreError extends Error {
  constructor(readonly operation: 'load' | 'save' | 'clear') {
    super(`secure_store_${operation}_failed`);
    this.name = 'SecureStoreError';
  }
}

const SERVICE = 'buziosflow.session';

// Keychain (iOS) / Keystore (Android) mediante react-native-keychain:
// - iOS: accesible tras el primer desbloqueo y solo en este dispositivo; sin iCloud.
// - Android: cifrado AES-GCM con clave del Keystore.
const SET_OPTIONS: Keychain.SetOptions = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  cloudSync: false,
  storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
};

export const keychainSessionStore: SessionStore = {
  async load() {
    let credentials: false | Keychain.UserCredentials;
    try {
      credentials = await Keychain.getGenericPassword({ service: SERVICE });
    } catch {
      throw new SecureStoreError('load');
    }
    if (!credentials || !credentials.username || !credentials.password) return null;
    return { userId: credentials.username, refreshToken: credentials.password };
  },
  async save(session) {
    let result: false | Keychain.Result;
    try {
      result = await Keychain.setGenericPassword(session.userId, session.refreshToken, SET_OPTIONS);
    } catch {
      throw new SecureStoreError('save');
    }
    if (!result) throw new SecureStoreError('save');
  },
  async clear() {
    try {
      await Keychain.resetGenericPassword({ service: SERVICE });
    } catch {
      throw new SecureStoreError('clear');
    }
  },
};
