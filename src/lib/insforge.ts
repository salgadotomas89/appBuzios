import { createClient } from '@insforge/sdk';
import { INSFORGE_ANON_KEY, INSFORGE_URL } from '@env';

// Cliente de InsForge para toda la app. Usa la anon key (pública);
// el acceso a datos queda controlado por las políticas RLS de la base.
export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY,
});

export async function checkInsforgeConnection(): Promise<boolean> {
  const { error } = await insforge.auth.getPublicAuthConfig();
  return !error;
}
