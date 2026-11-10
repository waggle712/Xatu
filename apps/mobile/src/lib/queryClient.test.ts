import { QueryClient } from '@tanstack/react-query';
import { cacheBuster, shouldPersist } from './queryClient';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
}));

describe('offline cache', () => {
  const client = new QueryClient();
  const queryFor = (key: unknown[]) => {
    client.setQueryData(key, { ok: true });
    return client.getQueryCache().find({ queryKey: key })!;
  };

  it('keeps only the feed and categories on the phone', () => {
    expect(shouldPersist(queryFor(['feed', 10.81, 78.69, null]))).toBe(true);
    expect(shouldPersist(queryFor(['categories']))).toBe(true);
  });

  it('never writes personal or seller data to disk', () => {
    for (const key of [
      ['me'],
      ['shop', 'mine'],
      ['catalog', 'own', 'p1'],
      ['catalog', 'mine', false],
      ['search', 'x', null, null],
    ]) {
      expect(shouldPersist(queryFor(key))).toBe(false);
    }
  });

  it('drops the cache when the person or app version changes', () => {
    expect(cacheBuster('user-a')).not.toBe(cacheBuster('user-b'));
    expect(cacheBuster(null)).toContain('signed-out');
  });
});
