import { normaliseQuery } from '@xatu/shared';
import { fileStorage } from '../../lib/queryClient';

const KEY = 'recent-searches';
const MAX = 8;

/** Recent searches stay on this phone only (never sent anywhere) and are cleared at sign-out. */
export async function readRecent(): Promise<string[]> {
  try {
    const raw = await fileStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function addRecent(q: string): Promise<string[]> {
  const term = normaliseQuery(q);
  const next = [term, ...(await readRecent()).filter((t) => t !== term)].slice(0, MAX);
  await fileStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function clearRecent(): Promise<void> {
  await fileStorage.removeItem(KEY);
}
