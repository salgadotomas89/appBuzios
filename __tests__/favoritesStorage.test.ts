import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadFavorites, saveFavorites, toggleFavorite } from '../src/lib/favoritesStorage';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));

beforeEach(() => mockStore.clear());

it('toggles and round-trips favorite ids', async () => {
  const ids = toggleFavorite(toggleFavorite([], 'a'), 'b');
  expect(ids).toEqual(['a', 'b']);
  expect(toggleFavorite(ids, 'a')).toEqual(['b']);
  await saveFavorites(ids);
  await expect(loadFavorites()).resolves.toEqual(['a', 'b']);
});

it('ignores corrupt or hostile stored values', async () => {
  mockStore.set('@buzios-flow/favorites-v1', 'not json');
  await expect(loadFavorites()).resolves.toEqual([]);
  mockStore.set('@buzios-flow/favorites-v1', JSON.stringify(['ok', 42, 'x'.repeat(200), null]));
  await expect(loadFavorites()).resolves.toEqual(['ok']);
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
  await expect(loadFavorites()).resolves.toEqual([]);
});
