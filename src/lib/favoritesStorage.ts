import AsyncStorage from '@react-native-async-storage/async-storage';

// Favoritos locales: ids de ofertas, sin datos personales. Si el almacenamiento falla, la app sigue
// funcionando con favoritos solo en memoria.
const FAVORITES_KEY = '@buzios-flow/favorites-v1';
const MAX_FAVORITES = 200;

export async function loadFavorites(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(FAVORITES_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.length <= 80).slice(0, MAX_FAVORITES)
      : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(ids.slice(0, MAX_FAVORITES)));
}

export function toggleFavorite(ids: string[], offerId: string): string[] {
  return ids.includes(offerId) ? ids.filter(id => id !== offerId) : [...ids, offerId].slice(-MAX_FAVORITES);
}
