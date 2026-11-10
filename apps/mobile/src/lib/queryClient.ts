import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, type Query, QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 24 * 60 * 60 * 1000 } },
});

/** Only buyer-facing, non-personal lists are kept on the phone for offline use. */
const PERSISTED_ROOTS = new Set(['feed', 'categories']);

export function shouldPersist(query: Query): boolean {
  return (
    PERSISTED_ROOTS.has(String(query.queryKey[0])) && defaultShouldDehydrateQuery(query) // successful queries only
  );
}

/** A tiny key-value store in one JSON file per key (no native module needed). */
const dir = `${documentDirectory ?? ''}query-cache/`;
const fileFor = (key: string) => `${dir}${encodeURIComponent(key)}.json`;
export const fileStorage = {
  async getItem(key: string): Promise<string | null> {
    const file = fileFor(key);
    return (await getInfoAsync(file)).exists ? readAsStringAsync(file) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!(await getInfoAsync(dir)).exists) {
      const { makeDirectoryAsync } = await import('expo-file-system/legacy');
      await makeDirectoryAsync(dir, { intermediates: true });
    }
    await writeAsStringAsync(fileFor(key), value);
  },
  async removeItem(key: string): Promise<void> {
    await deleteAsync(fileFor(key), { idempotent: true });
  },
};

export const persister = createAsyncStoragePersister({
  storage: fileStorage,
  key: 'xatu-query-cache',
  throttleTime: 2_000,
});

export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

/** Changes when the app version or the signed-in person changes, so old caches are dropped. */
export function cacheBuster(userId: string | null | undefined): string {
  return `${Constants.expoConfig?.version ?? '0'}:${userId ?? 'signed-out'}`;
}

/** Sign-out: nothing from this person stays in memory or on disk. */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
  await fileStorage.removeItem('recent-searches');
}
