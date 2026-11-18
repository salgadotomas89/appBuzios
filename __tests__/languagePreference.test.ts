import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});

const actual = jest.requireActual('../src/lib/languagePreference') as typeof import('../src/lib/languagePreference');

it('maps the device locale to Portuguese, English or Spanish', () => {
  expect(actual.languageFromLocale('pt-BR')).toBe('pt');
  expect(actual.languageFromLocale('pt_PT')).toBe('pt');
  expect(actual.languageFromLocale('en-US')).toBe('en');
  expect(actual.languageFromLocale('es-AR')).toBe('es');
  expect(actual.languageFromLocale('fr-FR')).toBe('es');
  expect(actual.languageFromLocale(undefined)).toBe('es');
});

it('reads the device locale through Intl', () => {
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ locale: 'pt-BR' }) } as never);
  expect(actual.deviceLanguage()).toBe('pt');
  spy.mockRestore();
});

it('remembers the chosen language and ignores unknown stored values', async () => {
  expect(await actual.loadLanguage()).toBeNull();
  await actual.saveLanguage('en');
  expect(await actual.loadLanguage()).toBe('en');
  await AsyncStorage.setItem('@buzios-flow/language-v1', 'fr');
  expect(await actual.loadLanguage()).toBeNull();
});
