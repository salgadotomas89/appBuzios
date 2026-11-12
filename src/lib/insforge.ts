import { createClient } from '@insforge/sdk';
import { INSFORGE_ANON_KEY, INSFORGE_URL } from '@env';

// La conexión y Auth de InsForge están disponibles; las reservas compartidas
// requieren aplicar el esquema y las políticas RLS antes de habilitarse allí.
export function isInsforgeConfigured(): boolean {
  return Boolean(INSFORGE_URL && INSFORGE_ANON_KEY);
}

export const insforge = isInsforgeConfigured()
  ? createClient({
      baseUrl: INSFORGE_URL,
      anonKey: INSFORGE_ANON_KEY,
    })
  : null;

export async function checkInsforgeConnection(): Promise<boolean> {
  if (!insforge) {
    return false;
  }

  const { error } = await insforge.auth.getPublicAuthConfig();
  return !error;
}
