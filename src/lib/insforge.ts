import { createClient } from '@insforge/sdk';
import { INSFORGE_ANON_KEY, INSFORGE_URL } from '@env';
import { keychainSessionStore } from '../auth/secureSessionStore';
import { createSessionManager } from '../auth/sessionManager';

// La conexión y Auth de InsForge están disponibles; las reservas compartidas
// requieren aplicar el esquema y las políticas RLS antes de habilitarse allí.
export function isInsforgeConfigured(): boolean {
  return Boolean(INSFORGE_URL && INSFORGE_ANON_KEY);
}

// `isServerMode` activa el flujo móvil del SDK (client_type=mobile): el inicio de sesión devuelve un
// refreshToken y refreshSession lo acepta en el cuerpo. Es la única vía documentada sin cookies de
// navegador; el SDK la marca como obsoleta pensando en SSR y no ofrece un modo específico para
// React Native. Ver docs/autenticacion-oauth.md antes de actualizar el SDK.
export const insforge = isInsforgeConfigured()
  ? createClient({
      baseUrl: INSFORGE_URL,
      anonKey: INSFORGE_ANON_KEY,
      isServerMode: true,
    })
  : null;

// Persistencia de sesión en Keychain (iOS) / Keystore (Android); ver src/auth/sessionManager.ts.
export const sessionManager = insforge
  ? createSessionManager({ auth: insforge.auth, store: keychainSessionStore })
  : null;

export async function checkInsforgeConnection(): Promise<boolean> {
  if (!insforge) {
    return false;
  }

  const { error } = await insforge.auth.getPublicAuthConfig();
  return !error;
}
