import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from '../data/homeMock';

// Idioma inicial: el que el turista eligió antes en este teléfono o, si no eligió, el del dispositivo (portugués,
// inglés; cualquier otro, español). Si el almacenamiento falla, la app sigue con el del dispositivo.
const LANGUAGE_KEY = '@buzios-flow/language-v1';
const LANGUAGES: Language[] = ['es', 'pt', 'en'];

export function languageFromLocale(locale: string | undefined | null): Language {
  const code = (locale ?? '').toLowerCase().slice(0, 2);
  return code === 'pt' ? 'pt' : code === 'en' ? 'en' : 'es';
}

export function deviceLanguage(): Language {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'es';
  }
}

export async function loadLanguage(): Promise<Language | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    return LANGUAGES.includes(stored as Language) ? (stored as Language) : null;
  } catch {
    return null;
  }
}

export async function saveLanguage(language: Language): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}
