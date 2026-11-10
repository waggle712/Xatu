import { QueryClient } from '@tanstack/react-query';
import { cacheBuster, queryClient, shouldPersist } from './queryClient';

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
  // Query caches keep garbage-collection timers; clear them so Jest can exit.
  afterAll(() => {
    client.clear();
    queryClient.clear();
  });
  const queryFor = (key: unknown[]) => {
    client.setQueryData(key, { ok: true });
    return client.getQueryCache().find({ queryKey: key })!;
  };

  it('keeps only the feed and categories on the phone', () => {
    expect(shouldPersist(queryFor(['feed', 10.81, 78.69, null]))).toBe(true);
    expect(shouldPersist(queryFor(['categories']))).toBe(true);
  });

  it('keeps the feed after a failed offline refresh, and skips queries with no data', async () => {
    const key = ['feed', 1, 2, null];
    client.setQueryData(key, { pages: [] });
    await client
      .fetchQuery({
        queryKey: key,
        queryFn: () => Promise.reject(new Error('offline')),
        retry: false,
      })
      .catch(() => undefined);
    const query = client.getQueryCache().find({ queryKey: key })!;
    expect(query.state.status).toBe('error');
    expect(shouldPersist(query)).toBe(true);

    const empty = ['feed', 3, 4, null];
    await client
      .fetchQuery({ queryKey: empty, queryFn: () => Promise.reject(new Error('x')), retry: false })
      .catch(() => undefined);
    expect(shouldPersist(client.getQueryCache().find({ queryKey: empty })!)).toBe(false);
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
